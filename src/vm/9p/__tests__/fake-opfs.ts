/**
 * Minimal in-memory OPFS covering what the 9P server touches. Handles are the
 * entries themselves, so a moved handle keeps pointing at the moved entry and a
 * removed one starts failing with NotFoundError, as in browsers.
 */

const encoder = new TextEncoder();
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

abstract class FakeEntry {
  abstract readonly kind: 'file' | 'directory';
  parent: FakeDirectory | null = null;

  constructor(public name: string) {}

  abstract isLocked(): boolean;

  attached(): boolean {
    if (!this.parent) return this instanceof FakeDirectory && this.isRoot;
    return (
      this.parent.children.get(this.name) === this && this.parent.attached()
    );
  }

  protected assertAttached(): void {
    if (!this.attached()) throw domError('NotFoundError');
  }

  async move(
    destOrName: FakeDirectory | string,
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

class FakeSyncAccessHandle {
  private closed = false;

  constructor(private readonly file: FakeFile) {}

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
    if (end > this.file.data.length) this.resize(end);
    this.file.data.set(input, at);
    this.file.touch();
    return input.length;
  }

  truncate(size: number): void {
    this.assertOpen();
    this.resize(size);
    this.file.touch();
  }

  getSize(): number {
    this.assertOpen();
    return this.file.data.length;
  }

  flush(): void {
    this.assertOpen();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.file.locked = false;
  }

  private resize(size: number): void {
    const next = new Uint8Array(size);
    next.set(this.file.data.subarray(0, size));
    this.file.data = next;
  }

  private assertOpen(): void {
    if (this.closed) throw domError('InvalidStateError');
  }
}

export class FakeFile extends FakeEntry {
  readonly kind = 'file';
  data = new Uint8Array(0);
  lastModified = ++clock;
  locked = false;

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

  async createSyncAccessHandle(): Promise<FakeSyncAccessHandle> {
    this.assertAttached();
    if (this.locked) throw domError('NoModificationAllowedError');
    this.locked = true;
    return new FakeSyncAccessHandle(this);
  }
}

export class FakeDirectory extends FakeEntry {
  readonly kind = 'directory';
  readonly children = new Map<string, FakeEntry>();

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
  ): Promise<FakeDirectory> {
    return this.child(name, FakeDirectory, options?.create);
  }

  async getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FakeFile> {
    return this.child(name, FakeFile, options?.create);
  }

  async removeEntry(
    name: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    this.assertAttached();
    const entry = this.children.get(name);
    if (!entry) throw domError('NotFoundError');
    if (
      entry instanceof FakeDirectory &&
      entry.children.size > 0 &&
      !options?.recursive
    )
      throw domError('InvalidModificationError');
    if (entry.isLocked()) throw domError('NoModificationAllowedError');
    this.children.delete(name);
    entry.parent = null;
  }

  async *entries(): AsyncIterableIterator<[string, FakeEntry]> {
    this.assertAttached();
    yield* [...this.children];
  }

  async *keys(): AsyncIterableIterator<string> {
    this.assertAttached();
    yield* [...this.children.keys()];
  }

  private child<T extends FakeEntry>(
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

export function createFakeRoot(): FakeDirectory {
  return new FakeDirectory('', true);
}

export function asOpfsRoot(root: FakeDirectory): FileSystemDirectoryHandle {
  return root as unknown as FileSystemDirectoryHandle;
}

function fileAt(root: FakeDirectory, path: string[]): FakeFile | undefined {
  let entry: FakeEntry | undefined = root;
  for (const part of path) {
    entry =
      entry instanceof FakeDirectory ? entry.children.get(part) : undefined;
  }
  return entry instanceof FakeFile ? entry : undefined;
}

export function readText(root: FakeDirectory, path: string[]): string | null {
  const file = fileAt(root, path);
  return file ? decoder.decode(file.data) : null;
}

/** Creates or overwrites a file whose parent directories already exist. */
export function writeText(
  root: FakeDirectory,
  path: string[],
  text: string,
): void {
  const parent = path.slice(0, -1).reduce<FakeDirectory>((dir, part) => {
    const next = dir.children.get(part);
    if (!(next instanceof FakeDirectory)) throw new Error(`no dir ${part}`);
    return next;
  }, root);
  const name = path[path.length - 1];
  const existing = parent.children.get(name);
  const file = existing instanceof FakeFile ? existing : new FakeFile(name);
  file.parent = parent;
  parent.children.set(name, file);
  file.data = encoder.encode(text);
  file.touch();
}
