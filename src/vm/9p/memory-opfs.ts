/**
 * Minimal in-memory OPFS covering what the 9P server touches. It backs the
 * playground when real OPFS is locked or unavailable, and the server tests.
 * Handles are the entries themselves, so a moved handle keeps pointing at the
 * moved entry and a removed one starts failing with NotFoundError, as in
 * browsers.
 */

const decoder = new TextDecoder();

let clock = Date.now();

function domError(name: string): DOMException {
  return new DOMException(name, name);
}

function bytesOf(buffer: AllowSharedBufferSource): Uint8Array {
  return ArrayBuffer.isView(buffer)
    ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new Uint8Array(buffer);
}

abstract class MemoryEntry {
  abstract readonly kind: 'file' | 'directory';
  parent: MemoryDirectory | null = null;

  constructor(public name: string) {}

  abstract isLocked(): boolean;

  attached(): boolean {
    if (!this.parent) return this instanceof MemoryDirectory && this.isRoot;
    return (
      this.parent.children.get(this.name) === this && this.parent.attached()
    );
  }

  protected assertAttached(): void {
    if (!this.attached()) throw domError('NotFoundError');
  }

  async move(
    destOrName: MemoryDirectory | string,
    maybeName?: string,
  ): Promise<void> {
    this.assertAttached();
    const dest = typeof destOrName === 'string' ? this.parent! : destOrName;
    const name = typeof destOrName === 'string' ? destOrName : maybeName!;
    if (this.isLocked()) throw domError('NoModificationAllowedError');
    const existing = dest.children.get(name);
    if (existing && existing !== this) {
      if (existing.kind === 'directory' || this.kind === 'directory')
        throw domError('InvalidModificationError');
      if (existing.isLocked()) throw domError('NoModificationAllowedError');
      existing.parent = null;
    }
    this.parent!.children.delete(this.name);
    dest.children.set(name, this);
    this.parent = dest;
    this.name = name;
  }
}

class MemorySyncAccessHandle {
  private closed = false;

  constructor(private readonly file: MemoryFile) {}

  read(buffer: AllowSharedBufferSource, options?: { at?: number }): number {
    this.assertOpen();
    const out = bytesOf(buffer);
    const at = options?.at ?? 0;
    const chunk = this.file.data.subarray(at, at + out.length);
    out.set(chunk);
    return chunk.length;
  }

  write(buffer: AllowSharedBufferSource, options?: { at?: number }): number {
    this.assertOpen();
    const input = bytesOf(buffer);
    const at = options?.at ?? 0;
    const end = at + input.length;
    if (end > this.file.size) this.file.resize(end);
    this.file.data.set(input, at);
    this.file.touch();
    return input.length;
  }

  truncate(size: number): void {
    this.assertOpen();
    this.file.resize(size);
    this.file.touch();
  }

  getSize(): number {
    this.assertOpen();
    return this.file.size;
  }

  flush(): void {
    this.assertOpen();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.file.locked = false;
  }

  private assertOpen(): void {
    if (this.closed) throw domError('InvalidStateError');
  }
}

export class MemoryFile extends MemoryEntry {
  readonly kind = 'file';
  lastModified = ++clock;
  locked = false;
  size = 0;
  // Backing store; only the first `size` bytes are file content.
  private buffer: Uint8Array = new Uint8Array(0);

  get data(): Uint8Array {
    return this.buffer.subarray(0, this.size);
  }

  set data(bytes: Uint8Array) {
    this.buffer = bytes;
    this.size = bytes.length;
  }

  /** Grows geometrically so appending in small writes stays linear overall. */
  resize(size: number): void {
    if (size > this.buffer.length) {
      const next = new Uint8Array(Math.max(size, this.buffer.length * 2));
      next.set(this.data);
      this.buffer = next;
    } else if (size > this.size) {
      this.buffer.fill(0, this.size, size);
    }
    this.size = size;
  }

  isLocked(): boolean {
    return this.locked;
  }

  touch(): void {
    this.lastModified = ++clock;
  }

  async getFile(): Promise<{
    size: number;
    lastModified: number;
    text: () => Promise<string>;
  }> {
    this.assertAttached();
    const data = this.data.slice();
    return {
      size: data.length,
      lastModified: this.lastModified,
      text: async () => decoder.decode(data),
    };
  }

  async createSyncAccessHandle(): Promise<MemorySyncAccessHandle> {
    this.assertAttached();
    if (this.locked) throw domError('NoModificationAllowedError');
    this.locked = true;
    return new MemorySyncAccessHandle(this);
  }
}

export class MemoryDirectory extends MemoryEntry {
  readonly kind = 'directory';
  readonly children = new Map<string, MemoryEntry>();

  constructor(
    name = '',
    readonly isRoot = false,
  ) {
    super(name);
  }

  isLocked(): boolean {
    return [...this.children.values()].some((child) => child.isLocked());
  }

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<MemoryDirectory> {
    return this.child(name, MemoryDirectory, options?.create);
  }

  async getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<MemoryFile> {
    return this.child(name, MemoryFile, options?.create);
  }

  async removeEntry(
    name: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    this.assertAttached();
    const entry = this.children.get(name);
    if (!entry) throw domError('NotFoundError');
    if (
      entry instanceof MemoryDirectory &&
      entry.children.size > 0 &&
      !options?.recursive
    )
      throw domError('InvalidModificationError');
    if (entry.isLocked()) throw domError('NoModificationAllowedError');
    this.children.delete(name);
    entry.parent = null;
  }

  async *entries(): AsyncIterableIterator<[string, MemoryEntry]> {
    this.assertAttached();
    yield* [...this.children];
  }

  async *keys(): AsyncIterableIterator<string> {
    this.assertAttached();
    yield* [...this.children.keys()];
  }

  private child<T extends MemoryEntry>(
    name: string,
    type: new (name: string) => T,
    create = false,
  ): T {
    this.assertAttached();
    const existing = this.children.get(name);
    if (existing instanceof type) return existing;
    if (existing) throw domError('TypeMismatchError');
    if (!create) throw domError('NotFoundError');
    const entry = new type(name);
    entry.parent = this;
    this.children.set(name, entry);
    return entry;
  }
}

export function createMemoryRoot(): MemoryDirectory {
  return new MemoryDirectory('', true);
}

export function asOpfsRoot(root: MemoryDirectory): FileSystemDirectoryHandle {
  return root as unknown as FileSystemDirectoryHandle;
}
