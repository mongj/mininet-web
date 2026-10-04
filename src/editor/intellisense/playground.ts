import { joinPath } from '@/lib/paths';
import type { HostFs } from '@/vm/fs-protocol';

/** Where the server sees the playground, and Mininet as an importable library. */
export const PLAYGROUND_ROOT = '/playground';
export const LIBRARY_ROOT = '/lib';
export const ROOT_URI = `file://${PLAYGROUND_ROOT}`;

const MAX_PYTHON_FILES = 200;
const MAX_DIRECTORIES = 200;
const MAX_DEPTH = 8;
/** Larger files are left out; the editor has its own, higher limit. */
export const MAX_SOURCE_BYTES = 256 * 1024;
const SKIPPED_DIRECTORIES = new Set(['__pycache__', 'node_modules']);
/** The server's file system rejects these in a path, and then fails to start. */
const UNSUPPORTED_CHARACTERS = /[:*?<>|"]/;

export function isPythonFile(path: string): boolean {
  return path.endsWith('.py') || path.endsWith('.pyi');
}

/** Whether the server can hold a file at this playground path. */
export function isServerPath(path: string): boolean {
  return !UNSUPPORTED_CHARACTERS.test(path);
}

export function serverPath(path: string): string {
  return `${PLAYGROUND_ROOT}/${path}`;
}

/** The `file:` URI of a playground file, as the server will echo it back. */
export function toUri(path: string): string {
  return `file://${serverPath(path).split('/').map(encodeURIComponent).join('/')}`;
}

/** The playground path a server URI names, or null when it is not in it. */
export function fromUri(uri: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(uri).pathname);
  } catch {
    return null;
  }
  const prefix = `${PLAYGROUND_ROOT}/`;
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : null;
}

/**
 * The Python files in the playground, breadth first, so that when there are
 * too many it is the deeply nested ones that are left out.
 */
export async function listPythonFiles(
  fs: Pick<HostFs, 'list'>,
): Promise<string[]> {
  const found: string[] = [];
  let level = [''];
  let visited = 0;
  for (let depth = 0; depth <= MAX_DEPTH && level.length > 0; depth++) {
    const next: string[] = [];
    for (const dir of level) {
      if (visited++ >= MAX_DIRECTORIES) return found;
      const entries = await fs.list(dir);
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of entries) {
        if (!isServerPath(entry.name)) continue;
        const path = joinPath(dir, entry.name);
        if (entry.kind === 'file' && isPythonFile(entry.name)) {
          found.push(path);
          if (found.length >= MAX_PYTHON_FILES) return found;
        } else if (
          entry.kind === 'dir' &&
          !entry.name.startsWith('.') &&
          !SKIPPED_DIRECTORIES.has(entry.name)
        ) {
          next.push(path);
        }
      }
    }
    level = next;
  }
  return found;
}

/** The text of a source file, or null when it is too large or not UTF-8. */
export async function readSource(
  fs: Pick<HostFs, 'read'>,
  path: string,
): Promise<string | null> {
  const result = await fs.read(path, MAX_SOURCE_BYTES);
  if (result.tooLarge) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(result.data);
  } catch {
    return null;
  }
}
