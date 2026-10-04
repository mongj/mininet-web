import type { LspDiagnostic, LspServerCapabilities } from './protocol';

const INITIALIZE_TIMEOUT_MS = 60_000;
const REQUEST_CANCELLED = -32800;

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/** What Monaco hands a provider so that it can abandon a request. */
export interface Cancellation {
  isCancellationRequested: boolean;
  onCancellationRequested: (listener: () => void) => { dispose: () => void };
}

export interface ServerOptions {
  workerUrl: string;
  rootUri: string;
  /** The server's whole file system, by absolute path. */
  files: Record<string, string>;
  /** Answers the server's `workspace/configuration` request for a section. */
  configuration: (section: string | undefined) => unknown;
  onDiagnostics: (uri: string, diagnostics: LspDiagnostic[]) => void;
  /** A worker failed after start-up; the server is no longer usable. */
  onCrash: (error: Error) => void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * basedpyright running in web workers, spoken to in JSON-RPC over
 * `postMessage`. The server keeps its files in memory: it is given all of
 * them at start-up and is told about later changes through notifications.
 */
export class PyrightServer {
  capabilities: LspServerCapabilities = {};
  private readonly workers: Worker[] = [];
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private ready = false;
  private disposed = false;

  private constructor(private readonly options: ServerOptions) {}

  static async start(options: ServerOptions): Promise<PyrightServer> {
    const server = new PyrightServer(options);
    try {
      await server.initialize();
    } catch (error) {
      server.dispose();
      throw error;
    }
    return server;
  }

  /** Rejects when the request fails, is cancelled, or the server stops. */
  request<T>(
    method: string,
    params: unknown,
    cancellation?: Cancellation,
  ): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Server stopped.'));
    const id = this.nextId++;
    const subscription = cancellation?.onCancellationRequested(() => {
      this.notify('$/cancelRequest', { id });
    });
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
    }).finally(() => subscription?.dispose()) as Promise<T>;
  }

  notify(method: string, params: unknown): void {
    if (this.disposed) return;
    this.send({ jsonrpc: '2.0', method, params });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const request of pending) request.reject(new Error('Server stopped.'));
  }

  private get foreground(): Worker {
    return this.workers[0];
  }

  private send(message: JsonRpcMessage): void {
    this.foreground.postMessage(message);
  }

  private spawn(name: string): Worker {
    const worker = new Worker(this.options.workerUrl, { name });
    worker.addEventListener('error', (event) => {
      this.crash(new Error(event.message || 'The language server stopped.'));
    });
    this.workers.push(worker);
    return worker;
  }

  private crash(error: Error): void {
    // A failure during start-up is reported by `start` itself.
    if (this.disposed || !this.ready) return;
    this.dispose();
    this.options.onCrash(error);
  }

  private async initialize(): Promise<void> {
    const { rootUri, files } = this.options;
    let onCrash: (error: Error) => void = () => {};
    const crashed = new Promise<never>((_resolve, reject) => {
      onCrash = reject;
    });
    const worker = this.spawn('pyright');
    const failBeforeReady = (event: ErrorEvent) =>
      onCrash(new Error(event.message || 'The language server did not load.'));
    worker.addEventListener('error', failBeforeReady);
    worker.addEventListener('message', (event: MessageEvent) =>
      this.receive(event.data),
    );
    worker.postMessage({ type: 'browser/boot', mode: 'foreground' });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('The language server took too long to start.')),
        INITIALIZE_TIMEOUT_MS,
      );
    });
    try {
      const result = await Promise.race([
        this.request<{ capabilities: LspServerCapabilities }>('initialize', {
          processId: null,
          rootUri,
          workspaceFolders: [{ name: 'playground', uri: rootUri }],
          capabilities: {
            textDocument: {
              synchronization: { didSave: false },
              hover: { contentFormat: ['markdown', 'plaintext'] },
              completion: {
                completionItem: {
                  documentationFormat: ['markdown', 'plaintext'],
                  snippetSupport: true,
                  commitCharactersSupport: true,
                  deprecatedSupport: true,
                  insertReplaceSupport: true,
                  tagSupport: { valueSet: [1] },
                  resolveSupport: {
                    properties: [
                      'documentation',
                      'detail',
                      'additionalTextEdits',
                    ],
                  },
                },
                contextSupport: true,
              },
              signatureHelp: {
                signatureInformation: {
                  documentationFormat: ['markdown', 'plaintext'],
                  parameterInformation: { labelOffsetSupport: true },
                  activeParameterSupport: true,
                },
                contextSupport: true,
              },
              publishDiagnostics: { tagSupport: { valueSet: [1, 2] } },
              semanticTokens: {
                requests: { full: true },
                formats: ['relative'],
                tokenTypes: [],
                tokenModifiers: [],
              },
            },
            workspace: { configuration: true, workspaceFolders: true },
          },
          initializationOptions: { files },
        }),
        crashed,
        timedOut,
      ]);
      this.capabilities = result.capabilities;
      this.ready = true;
      this.notify('initialized', {});
    } finally {
      clearTimeout(timer);
      worker.removeEventListener('error', failBeforeReady);
    }
  }

  private receive(data: unknown): void {
    if (this.disposed || typeof data !== 'object' || data === null) return;
    // The server asks its host to start the workers it analyses files in.
    const boot = data as {
      type?: string;
      initialData?: unknown;
      port?: unknown;
    };
    if (boot.type === 'browser/newWorker' && boot.port instanceof MessagePort) {
      this.spawn(`pyright-background-${this.workers.length}`).postMessage(
        {
          type: 'browser/boot',
          mode: 'background',
          initialData: boot.initialData,
          port: boot.port,
        },
        [boot.port],
      );
      return;
    }

    const message = data as JsonRpcMessage;
    if (message.jsonrpc !== '2.0') return;
    if (message.method === undefined) {
      if (typeof message.id !== 'number') return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) {
        request.reject(
          new Error(
            message.error.code === REQUEST_CANCELLED
              ? 'Request cancelled.'
              : message.error.message,
          ),
        );
      } else request.resolve(message.result);
      return;
    }

    if (message.method === 'textDocument/publishDiagnostics') {
      const params = message.params as {
        uri: string;
        diagnostics: LspDiagnostic[];
      };
      this.options.onDiagnostics(params.uri, params.diagnostics);
    }
    if (message.id === undefined) return;
    // A request from the server: its settings, or something to acknowledge.
    let result: unknown = null;
    if (message.method === 'workspace/configuration') {
      const { items } = message.params as {
        items: Array<{ section?: string }>;
      };
      result = items.map((item) => this.options.configuration(item.section));
    }
    this.send({ jsonrpc: '2.0', id: message.id, result });
  }
}
