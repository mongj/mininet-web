import {
  FsError,
  type FsChange,
  type FsMethod,
  type FsRequest,
  type HostFs,
} from './fs-protocol';
import type { WorkerCommand, WorkerEvent } from './messages';

type FsResultEvent = Extract<WorkerEvent, { type: 'fs-result' }>;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: FsError) => void;
}

/**
 * Main-thread access to the playground files the emulator worker serves.
 * Requests fail with `FsError('unavailable')` while no worker is attached.
 */
export class FileSystemClient implements HostFs {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly listeners = new Set<(change: FsChange) => void>();

  attach(worker: Worker): void {
    this.detach();
    this.worker = worker;
  }

  /** Detaches `worker` (or whichever is attached) and fails its requests. */
  detach(worker?: Worker): void {
    if (worker && this.worker !== worker) return;
    this.worker = null;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const request of pending) request.reject(new FsError('unavailable'));
  }

  handleResult(event: FsResultEvent): void {
    const request = this.pending.get(event.id);
    if (!request) return;
    this.pending.delete(event.id);
    if (event.ok) request.resolve(event.value);
    else request.reject(new FsError(event.code));
  }

  handleChange(change: FsChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }

  onChange(listener: (change: FsChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  list(path: string) {
    return this.call('list', path);
  }

  read(path: string, maxBytes: number) {
    return this.call('read', path, maxBytes);
  }

  write(path: string, data: Uint8Array) {
    return this.call('write', path, data);
  }

  createFile(path: string) {
    return this.call('createFile', path);
  }

  createDir(path: string) {
    return this.call('createDir', path);
  }

  rename(from: string, to: string) {
    return this.call('rename', from, to);
  }

  remove(path: string) {
    return this.call('remove', path);
  }

  private call<M extends FsMethod>(
    method: M,
    ...args: Parameters<HostFs[M]>
  ): ReturnType<HostFs[M]> {
    const worker = this.worker;
    if (!worker) {
      return Promise.reject(new FsError('unavailable')) as ReturnType<
        HostFs[M]
      >;
    }
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        worker.postMessage({
          type: 'fs',
          id,
          request: { method, args } as FsRequest,
        } satisfies WorkerCommand);
      } catch {
        this.pending.delete(id);
        reject(new FsError('io'));
      }
    }) as ReturnType<HostFs[M]>;
  }
}
