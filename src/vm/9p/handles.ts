import { deleteWithin, isPathWithin, remapWithin } from './paths';

export interface OpenHandle {
  access: FileSystemSyncAccessHandle;
  refs: number;
}

/** Anything (e.g. a fid) that may hold a shared handle for `path`. */
export interface HandleHolder {
  path: string;
  handle?: OpenHandle;
}

export function disposeAccess(access: FileSystemSyncAccessHandle): void {
  try {
    access.flush();
  } catch {
    // Best-effort.
  }
  try {
    access.close();
  } catch {
    // Best-effort.
  }
}

/**
 * Ref-counted sync access handles, one per path. OPFS sync handles are
 * exclusive per file, so every open fid on the same file shares one.
 */
export class HandleCache {
  private readonly open = new Map<string, OpenHandle>();

  constructor(
    private readonly getFile: (path: string) => Promise<FileSystemFileHandle>,
  ) {}

  get(path: string): OpenHandle | undefined {
    return this.open.get(path);
  }

  async acquire(path: string): Promise<OpenHandle> {
    const existing = this.open.get(path);
    if (existing) {
      existing.refs += 1;
      return existing;
    }
    const file = await this.getFile(path);
    const access = await file.createSyncAccessHandle();
    const handle: OpenHandle = { access, refs: 1 };
    this.open.set(path, handle);
    return handle;
  }

  release(path: string, handle: OpenHandle): void {
    handle.refs -= 1;
    if (handle.refs > 0) return;
    if (this.open.get(path) === handle) this.open.delete(path);
    disposeAccess(handle.access);
  }

  /**
   * OPFS sync handles are path-bound and exclusive: an unlinked file cannot stay
   * readable. Close handles at or under `root` immediately and detach them from
   * `holders`; later I/O through those holders fails.
   */
  closeWithin(root: string, holders: Iterable<HandleHolder>): void {
    const closed = new Set<OpenHandle>();
    for (const [path, handle] of this.open) {
      if (!isPathWithin(root, path)) continue;
      closed.add(handle);
      disposeAccess(handle.access);
    }
    if (closed.size === 0) return;
    deleteWithin(this.open, root);
    for (const holder of holders) {
      if (holder.handle && closed.has(holder.handle)) holder.handle = undefined;
    }
  }

  /** Reattach handles for `holders` at or under `root` that lost theirs. */
  async reacquire(
    root: string,
    holders: Iterable<HandleHolder>,
  ): Promise<void> {
    for (const holder of holders) {
      if (holder.handle || !isPathWithin(root, holder.path)) continue;
      holder.handle = await this.acquire(holder.path);
    }
  }

  /** Use an existing shared handle, or a short-lived one when no fid holds the file. */
  async withFileAccess<T>(
    path: string,
    preferred: OpenHandle | undefined,
    fn: (access: FileSystemSyncAccessHandle) => T,
  ): Promise<T> {
    const shared = preferred ?? this.open.get(path);
    if (shared) return fn(shared.access);
    const file = await this.getFile(path);
    const access = await file.createSyncAccessHandle();
    try {
      return fn(access);
    } finally {
      disposeAccess(access);
    }
  }

  remap(from: string, to: string): void {
    remapWithin(this.open, from, to);
  }

  closeAll(): void {
    for (const handle of this.open.values()) disposeAccess(handle.access);
    this.open.clear();
  }
}
