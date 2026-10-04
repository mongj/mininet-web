import type {
  IDisposable,
  IRange,
  editor,
  languages,
} from 'monaco-editor/editor/editor.api';
import { errorMessage } from '@/lib/errors';
import { isPathWithin } from '@/lib/paths';
import type { FileSystemClient } from '@/vm/fs-client';
import type { FsChange } from '@/vm/fs-protocol';
import type { DocumentStore } from '../documents';
import { loadMonaco, type Monaco } from '../monaco';
import {
  toCompletionItem,
  toHover,
  toLspPosition,
  toMarkdown,
  toMarker,
  toSignatureHelp,
} from './convert';
import {
  LIBRARY_ROOT,
  ROOT_URI,
  fromUri,
  isServerPath,
  listPythonFiles,
  readSource,
  serverPath,
  toUri,
} from './playground';
import type {
  LspCompletionItem,
  LspCompletionList,
  LspDiagnostic,
  LspHover,
  LspSemanticTokens,
  LspSignatureHelp,
} from './protocol';
import { PyrightServer, type Cancellation } from './server';

export type IntelliSenseStatus = 'off' | 'starting' | 'ready' | 'error';

export interface IntelliSenseSnapshot {
  status: IntelliSenseStatus;
  error: string | null;
}

const OFF: IntelliSenseSnapshot = { status: 'off', error: null };
const STARTING: IntelliSenseSnapshot = { status: 'starting', error: null };
const READY: IntelliSenseSnapshot = { status: 'ready', error: null };

const LANGUAGE = 'python';
const MARKER_OWNER = 'intellisense';
const RESCAN_DELAY_MS = 250;

// The guest's Python and platform, and Mininet where `import mininet` finds it.
// Mininet has no type hints, so anything stricter than `basic` reports noise.
const CONFIG = {
  typeCheckingMode: 'basic',
  typeshedPath: '/typeshed',
  pythonVersion: '3.12',
  pythonPlatform: 'Linux',
  extraPaths: [LIBRARY_ROOT],
  reportMissingImports: 'warning',
  reportMissingModuleSource: 'warning',
};

function assetUrl(name: string): string {
  return new URL(
    `${import.meta.env.BASE_URL}pyright/${name}`,
    window.location.href,
  ).href;
}

/** Mininet's source, by its path under the server's library root. */
async function loadLibrary(): Promise<Record<string, string>> {
  const response = await fetch(assetUrl('mininet.json'));
  if (
    !response.ok ||
    response.headers.get('content-type')?.includes('text/html')
  ) {
    throw new Error('Could not load the Mininet source.');
  }
  const { files } = (await response.json()) as {
    files: Record<string, string>;
  };
  return Object.fromEntries(
    Object.entries(files)
      .filter(([name]) => name.endsWith('.py'))
      .map(([name, text]) => [`${LIBRARY_ROOT}/${name}`, text]),
  );
}

/** The server's settings, which it asks for by section. */
function configuration(section: string | undefined): unknown {
  // Its stubs cover many packages the guest does not have; offering to import
  // from them would suggest code that cannot run.
  return section === 'basedpyright'
    ? { analysis: { autoImportCompletions: false } }
    : null;
}

interface ServerFile {
  version: number;
  text: string;
}

interface TrackedModel {
  model: editor.ITextModel;
  subscription: IDisposable;
}

/**
 * One running language server and what keeps it in step with the editor: the
 * playground's Python files, the open models, and Monaco's providers.
 */
class Session {
  /** What the server has been told, by playground path. */
  private readonly files = new Map<string, ServerFile>();
  /** Python files as they are on disk. An open model's text wins over these. */
  private readonly disk = new Map<string, string>();
  private readonly models = new Map<string, TrackedModel>();
  private readonly diagnostics = new Map<string, LspDiagnostic[]>();
  private readonly disposables: IDisposable[] = [];
  private server!: PyrightServer;
  private disposed = false;
  private filesReady = false;
  private changed = new Set<string>();
  private rescanAll = false;
  private rescanTimer: ReturnType<typeof setTimeout> | undefined;
  private rescanning = false;

  private constructor(
    private readonly monaco: Monaco,
    private readonly fs: FileSystemClient,
    private readonly documents: DocumentStore,
  ) {}

  static async start(
    fs: FileSystemClient,
    documents: DocumentStore,
    filesReady: boolean,
    onCrash: (error: Error) => void,
  ): Promise<Session> {
    const monaco = await loadMonaco();
    const session = new Session(monaco, fs, documents);
    session.filesReady = filesReady;
    const [library] = await Promise.all([
      loadLibrary(),
      filesReady ? session.readDisk(true) : undefined,
    ]);

    const initial = new Map(session.disk);
    for (const [path, model] of session.pythonModels()) {
      initial.set(path, model.getValue());
    }
    const files: Record<string, string> = {
      ...library,
      [serverPath('pyrightconfig.json')]: JSON.stringify(CONFIG),
    };
    for (const [path, text] of initial) files[serverPath(path)] = text;

    session.server = await PyrightServer.start({
      workerUrl: assetUrl('pyright.worker.js'),
      rootUri: ROOT_URI,
      files,
      configuration,
      onDiagnostics: (uri, diagnostics) =>
        session.onDiagnostics(uri, diagnostics),
      onCrash,
    });
    // The server reads a file's content from its open document, so every
    // playground file is opened, not only the ones in an editor.
    for (const [path, text] of initial) session.open(path, text);
    session.attach();
    return session;
  }

  setFilesReady(ready: boolean): void {
    if (this.filesReady === ready) return;
    this.filesReady = ready;
    if (!ready) return;
    this.rescanAll = true;
    this.scheduleRescan();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.rescanTimer);
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
    for (const tracked of this.models.values()) tracked.subscription.dispose();
    this.models.clear();
    this.server?.dispose();
    this.monaco.editor.removeAllMarkers(MARKER_OWNER);
  }

  private pythonModels(): Map<string, editor.ITextModel> {
    const models = new Map<string, editor.ITextModel>();
    for (const { path, model } of this.documents.models()) {
      if (model.getLanguageId() === LANGUAGE && isServerPath(path)) {
        models.set(path, model);
      }
    }
    return models;
  }

  private attach(): void {
    const unsubscribeDocuments = this.documents.subscribe(() =>
      this.syncModels(),
    );
    const unsubscribeFiles = this.fs.onChange((change) =>
      this.onFilesChanged(change),
    );
    this.disposables.push(
      { dispose: unsubscribeDocuments },
      { dispose: unsubscribeFiles },
      ...this.registerProviders(),
    );
    this.syncModels();
  }

  // Server file state

  private open(path: string, text: string): void {
    this.files.set(path, { version: 1, text });
    this.server.notify('textDocument/didOpen', {
      textDocument: {
        uri: toUri(path),
        languageId: LANGUAGE,
        version: 1,
        text,
      },
    });
  }

  /** Tells the server what `path` now holds: its model's text, else the disk's. */
  private reconcile(path: string): void {
    if (this.disposed) return;
    const text = this.models.get(path)?.model.getValue() ?? this.disk.get(path);
    const known = this.files.get(path);
    const uri = toUri(path);
    if (text === undefined) {
      if (!known) return;
      this.files.delete(path);
      this.diagnostics.delete(path);
      this.server.notify('textDocument/didClose', { textDocument: { uri } });
      this.server.notify('pyright/deleteFile', { uri });
    } else if (!known) {
      // Put the file on the server's file system so that imports resolve.
      this.server.notify('pyright/createFile', { uri });
      this.open(path, text);
    } else if (known.text !== text) {
      known.version += 1;
      known.text = text;
      this.server.notify('textDocument/didChange', {
        textDocument: { uri, version: known.version },
        contentChanges: [{ text }],
      });
    }
  }

  // Open editors

  private syncModels(): void {
    if (this.disposed) return;
    const current = this.pythonModels();
    const affected = new Set<string>();
    for (const [path, tracked] of this.models) {
      if (current.get(path) === tracked.model) continue;
      tracked.subscription.dispose();
      this.models.delete(path);
      if (!tracked.model.isDisposed()) {
        this.monaco.editor.setModelMarkers(tracked.model, MARKER_OWNER, []);
      }
      affected.add(path);
      // The disk may hold what the editor saved since it was last read.
      this.changed.add(path);
      this.scheduleRescan();
    }
    for (const [path, model] of current) {
      if (this.models.has(path)) continue;
      const subscription = model.onDidChangeContent(() => this.reconcile(path));
      this.models.set(path, { model, subscription });
      affected.add(path);
    }
    for (const path of affected) {
      this.reconcile(path);
      this.applyMarkers(path);
    }
  }

  // Playground files

  private onFilesChanged(change: FsChange): void {
    if (change.paths.length === 0) return;
    for (const path of change.paths) this.changed.add(path);
    this.scheduleRescan();
  }

  private scheduleRescan(): void {
    if (this.disposed) return;
    clearTimeout(this.rescanTimer);
    this.rescanTimer = setTimeout(() => void this.rescan(), RESCAN_DELAY_MS);
  }

  /** One pass at a time; changes that arrive during a pass get another. */
  private async rescan(): Promise<void> {
    if (this.rescanning || this.disposed || !this.filesReady) return;
    this.rescanning = true;
    try {
      while (
        !this.disposed &&
        this.filesReady &&
        (this.rescanAll || this.changed.size > 0)
      ) {
        const all = this.rescanAll;
        this.rescanAll = false;
        const affected = await this.readDisk(all);
        // Linux stopped serving files; the next change or boot tries again.
        if (affected === null) break;
        for (const path of affected) this.reconcile(path);
      }
    } finally {
      this.rescanning = false;
    }
  }

  /**
   * Brings `disk` up to date and returns the paths whose content changed, or
   * null when the files could not be listed. Reads new files and, unless
   * `all`, only the files a change touched.
   */
  private async readDisk(all: boolean): Promise<Set<string> | null> {
    const changed = [...this.changed];
    this.changed = new Set();
    const affected = new Set<string>();
    let listed: string[];
    try {
      listed = await listPythonFiles(this.fs);
    } catch {
      // Keep what is known, and what there is still to read.
      for (const path of changed) this.changed.add(path);
      this.rescanAll ||= all;
      return null;
    }
    const present = new Set(listed);
    for (const path of [...this.disk.keys()]) {
      if (present.has(path)) continue;
      this.disk.delete(path);
      affected.add(path);
    }
    const stale = listed.filter(
      (path) =>
        all ||
        !this.disk.has(path) ||
        changed.some((each) => isPathWithin(each, path)),
    );
    await Promise.all(
      stale.map(async (path) => {
        let text: string | null;
        try {
          text = await readSource(this.fs, path);
        } catch {
          return;
        }
        if (text === null) {
          if (this.disk.delete(path)) affected.add(path);
        } else if (this.disk.get(path) !== text) {
          this.disk.set(path, text);
          affected.add(path);
        }
      }),
    );
    return affected;
  }

  // Diagnostics

  private onDiagnostics(uri: string, diagnostics: LspDiagnostic[]): void {
    const path = fromUri(uri);
    if (this.disposed || path === null || !this.files.has(path)) return;
    this.diagnostics.set(path, diagnostics);
    this.applyMarkers(path);
  }

  private applyMarkers(path: string): void {
    const model = this.models.get(path)?.model;
    if (!model || model.isDisposed()) return;
    this.monaco.editor.setModelMarkers(
      model,
      MARKER_OWNER,
      (this.diagnostics.get(path) ?? []).map((diagnostic) =>
        toMarker(this.monaco, diagnostic),
      ),
    );
  }

  // Monaco providers

  /** The server's name for `model`, when the server knows the file. */
  private uriOf(model: editor.ITextModel): string | null {
    const path = this.documents.pathOf(model);
    return path !== null && this.files.has(path) ? toUri(path) : null;
  }

  /** Asks about a position in `model`; null when there is no answer. */
  private async ask<T>(
    method: string,
    model: editor.ITextModel,
    position: { lineNumber: number; column: number },
    token: Cancellation,
    extra: object = {},
  ): Promise<T | null> {
    const uri = this.uriOf(model);
    if (uri === null) return null;
    try {
      return await this.server.request<T | null>(
        method,
        { textDocument: { uri }, position: toLspPosition(position), ...extra },
        token,
      );
    } catch {
      // Cancelled, or the server stopped.
      return null;
    }
  }

  private registerProviders(): IDisposable[] {
    const { monaco, server } = this;
    const capabilities = server.capabilities;
    const originals = new WeakMap<
      languages.CompletionItem,
      LspCompletionItem
    >();

    const providers: IDisposable[] = [
      monaco.languages.registerCompletionItemProvider(LANGUAGE, {
        triggerCharacters: capabilities.completionProvider?.triggerCharacters,
        provideCompletionItems: async (model, position, context, token) => {
          const result = await this.ask<
            LspCompletionList | LspCompletionItem[]
          >('textDocument/completion', model, position, token, {
            context: {
              // Monaco counts trigger kinds from 0, the protocol from 1.
              triggerKind: context.triggerKind + 1,
              triggerCharacter: context.triggerCharacter,
            },
          });
          if (!result) return null;
          const items = Array.isArray(result) ? result : result.items;
          const word = model.getWordUntilPosition(position);
          const range: IRange = {
            startLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endLineNumber: position.lineNumber,
            endColumn: word.endColumn,
          };
          return {
            incomplete: !Array.isArray(result) && result.isIncomplete,
            suggestions: items.map((item) => {
              const suggestion = toCompletionItem(monaco, item, range);
              originals.set(suggestion, item);
              return suggestion;
            }),
          };
        },
        // Documentation is fetched for the item that is highlighted.
        resolveCompletionItem: async (item, token) => {
          const original = originals.get(item);
          if (!original) return item;
          try {
            const resolved = await server.request<LspCompletionItem>(
              'completionItem/resolve',
              original,
              token,
            );
            item.detail = resolved.detail ?? item.detail;
            item.documentation =
              toMarkdown(resolved.documentation) ?? item.documentation;
          } catch {
            // Cancelled, or the server stopped: keep the item as it is.
          }
          return item;
        },
      }),

      monaco.languages.registerHoverProvider(LANGUAGE, {
        provideHover: async (model, position, token) => {
          const hover = await this.ask<LspHover>(
            'textDocument/hover',
            model,
            position,
            token,
          );
          return hover ? toHover(hover) : null;
        },
      }),

      monaco.languages.registerSignatureHelpProvider(LANGUAGE, {
        signatureHelpTriggerCharacters:
          capabilities.signatureHelpProvider?.triggerCharacters,
        signatureHelpRetriggerCharacters:
          capabilities.signatureHelpProvider?.retriggerCharacters,
        provideSignatureHelp: async (model, position, token, context) => {
          const help = await this.ask<LspSignatureHelp>(
            'textDocument/signatureHelp',
            model,
            position,
            token,
            {
              context: {
                triggerKind: context.triggerKind,
                triggerCharacter: context.triggerCharacter,
                isRetrigger: context.isRetrigger,
              },
            },
          );
          if (!help || help.signatures.length === 0) return null;
          return { value: toSignatureHelp(help), dispose: () => {} };
        },
      }),
    ];

    const legend = capabilities.semanticTokensProvider?.legend;
    if (legend) {
      providers.push(
        monaco.languages.registerDocumentSemanticTokensProvider(LANGUAGE, {
          getLegend: () => legend,
          provideDocumentSemanticTokens: async (
            model,
            _lastResultId,
            token,
          ) => {
            const uri = this.uriOf(model);
            if (uri === null) return null;
            try {
              const tokens = await server.request<LspSemanticTokens | null>(
                'textDocument/semanticTokens/full',
                { textDocument: { uri } },
                token,
              );
              return tokens ? { data: new Uint32Array(tokens.data) } : null;
            } catch {
              return null;
            }
          },
          releaseDocumentSemanticTokens: () => {},
        }),
      );
    }
    return providers;
  }
}

/**
 * Python completions, hovers, signature help, semantic colouring and error
 * checking for the editor, from a language server that is only downloaded and
 * started on request: it costs a few megabytes and a few hundred of memory.
 */
export class IntelliSense {
  private readonly listeners = new Set<() => void>();
  private snapshot = OFF;
  private session: Session | null = null;
  /** Bumped by every start and stop, so that a stale start gives way. */
  private generation = 0;
  private filesReady = false;

  constructor(
    private readonly fs: FileSystemClient,
    private readonly documents: DocumentStore,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): IntelliSenseSnapshot => this.snapshot;

  /** Starts the server unless it is starting or running. Retries an error. */
  start(): void {
    const { status } = this.snapshot;
    if (status === 'starting' || status === 'ready') return;
    const generation = ++this.generation;
    this.set(STARTING);
    Session.start(this.fs, this.documents, this.filesReady, (error) => {
      if (generation === this.generation) this.fail(error);
    }).then(
      (session) => {
        if (generation !== this.generation) {
          session.dispose();
          return;
        }
        this.session = session;
        session.setFilesReady(this.filesReady);
        this.set(READY);
      },
      (error: unknown) => {
        if (generation === this.generation) this.fail(error);
      },
    );
  }

  stop(): void {
    this.generation += 1;
    this.session?.dispose();
    this.session = null;
    this.set(OFF);
  }

  /** Tells the server whether Linux is serving the playground's files. */
  setFilesReady(ready: boolean): void {
    this.filesReady = ready;
    this.session?.setFilesReady(ready);
  }

  private fail(error: unknown): void {
    console.error(error);
    this.generation += 1;
    this.session?.dispose();
    this.session = null;
    this.set({ status: 'error', error: errorMessage(error) });
  }

  private set(snapshot: IntelliSenseSnapshot): void {
    if (this.snapshot === snapshot) return;
    this.snapshot = snapshot;
    for (const listener of [...this.listeners]) listener();
  }
}
