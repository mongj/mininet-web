import type { NodeKind } from './node-kind';

const COPY_CHUNK_SIZE = 64 * 1024;

interface MovableHandle {
  move: (
    dest: FileSystemDirectoryHandle | string,
    name?: string,
  ) => Promise<void>;
}

type DirectoryListing = FileSystemDirectoryHandle & {
  entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
  keys: () => AsyncIterableIterator<string>;
};

export function listed(dir: FileSystemDirectoryHandle): DirectoryListing {
  return dir as DirectoryListing;
}

export function canMove(
  handle: FileSystemHandle,
): handle is FileSystemHandle & MovableHandle {
  return (
    'move' in handle && typeof (handle as MovableHandle).move === 'function'
  );
}

export async function isDirEmpty(
  dir: FileSystemDirectoryHandle,
): Promise<boolean> {
  return (await listed(dir).keys().next()).done === true;
}

export async function copyFile(
  source: FileSystemFileHandle,
  destParent: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  const dest = await destParent.getFileHandle(name, { create: true });
  const srcAccess = await source.createSyncAccessHandle();
  const destAccess = await dest.createSyncAccessHandle();
  try {
    const size = srcAccess.getSize();
    const buf = new Uint8Array(Math.min(size, COPY_CHUNK_SIZE) || 1);
    destAccess.truncate(0);
    let offset = 0;
    while (offset < size) {
      const n = srcAccess.read(
        buf.subarray(0, Math.min(buf.length, size - offset)),
        { at: offset },
      );
      destAccess.write(buf.subarray(0, n), { at: offset });
      offset += n;
    }
    destAccess.flush();
  } finally {
    srcAccess.close();
    destAccess.close();
  }
}

export async function copyDir(
  source: FileSystemDirectoryHandle,
  destParent: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  const dest = await destParent.getDirectoryHandle(name, { create: true });
  for await (const [childName, handle] of listed(source).entries()) {
    if (handle.kind === 'directory') {
      await copyDir(handle as FileSystemDirectoryHandle, dest, childName);
    } else {
      await copyFile(handle as FileSystemFileHandle, dest, childName);
    }
  }
}

/** Every path under `dir` (including `''` for `dir` itself) with its OPFS kind. */
export async function collectKinds(
  dir: FileSystemDirectoryHandle,
  prefix = '',
  out = new Map<string, NodeKind>(),
): Promise<Map<string, NodeKind>> {
  out.set(prefix, 'dir');
  for await (const [name, handle] of listed(dir).entries()) {
    const path = prefix === '' ? name : `${prefix}/${name}`;
    if (handle.kind === 'directory') {
      await collectKinds(handle as FileSystemDirectoryHandle, path, out);
    } else out.set(path, 'file');
  }
  return out;
}
