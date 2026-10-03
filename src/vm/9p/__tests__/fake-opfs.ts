import { MemoryDirectory, MemoryFile } from '../memory-opfs';

export {
  asOpfsRoot,
  createMemoryRoot as createFakeRoot,
  MemoryDirectory as FakeDirectory,
} from '../memory-opfs';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function fileAt(root: MemoryDirectory, path: string[]): MemoryFile | undefined {
  let entry: unknown = root;
  for (const part of path) {
    entry =
      entry instanceof MemoryDirectory ? entry.children.get(part) : undefined;
  }
  return entry instanceof MemoryFile ? entry : undefined;
}

export function readText(root: MemoryDirectory, path: string[]): string | null {
  const file = fileAt(root, path);
  return file ? decoder.decode(file.data) : null;
}

/** Creates or overwrites a file whose parent directories already exist. */
export function writeText(
  root: MemoryDirectory,
  path: string[],
  text: string,
): void {
  const parent = path.slice(0, -1).reduce<MemoryDirectory>((dir, part) => {
    const next = dir.children.get(part);
    if (!(next instanceof MemoryDirectory)) throw new Error(`no dir ${part}`);
    return next;
  }, root);
  const name = path[path.length - 1];
  const existing = parent.children.get(name);
  const file = existing instanceof MemoryFile ? existing : new MemoryFile(name);
  file.parent = parent;
  parent.children.set(name, file);
  file.data = encoder.encode(text);
  file.touch();
}
