import { EINVAL, ENAMETOOLONG, NAME_MAX } from './constants';
import { P9Error } from './errors';

// Paths are relative to the playground root: '' is the root, 'a/b' a descendant.

const encoder = new TextEncoder();

export function parentPath(path: string): string {
  if (path === '') return '';
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

export function baseName(path: string): string {
  if (path === '') return '';
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

export function joinPath(dir: string, name: string): string {
  if (name === '.' || name === '') return dir;
  if (name === '..') return parentPath(dir);
  return dir === '' ? name : `${dir}/${name}`;
}

/** True when `path` is `root` itself or lies beneath it. */
export function isPathWithin(root: string, path: string): boolean {
  return root === '' || path === root || path.startsWith(`${root}/`);
}

/** Moves `path` from under `from` to under `to`; `path` must be within `from`. */
export function rebasePath(path: string, from: string, to: string): string {
  if (path === from) return to;
  const rest = from === '' ? path : path.slice(from.length + 1);
  return to === '' ? rest : `${to}/${rest}`;
}

export function deleteWithin<V>(map: Map<string, V>, root: string): void {
  for (const key of [...map.keys()]) {
    if (isPathWithin(root, key)) map.delete(key);
  }
}

export function remapWithin<V>(
  map: Map<string, V>,
  from: string,
  to: string,
): void {
  const moves: Array<[string, V]> = [];
  for (const [key, value] of map) {
    if (!isPathWithin(from, key)) continue;
    moves.push([rebasePath(key, from, to), value]);
    map.delete(key);
  }
  for (const [key, value] of moves) map.set(key, value);
}

export function assertName(name: string): void {
  if (name === '' || name.includes('\0') || name.includes('/'))
    throw new P9Error(EINVAL);
  if (name !== '.' && name !== '..' && encoder.encode(name).length > NAME_MAX) {
    throw new P9Error(ENAMETOOLONG);
  }
}
