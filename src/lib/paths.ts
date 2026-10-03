// Playground-relative paths: '' is the root, 'a/b' a descendant.

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

/** Drops paths that lie beneath another path in the list. */
export function topMostPaths(paths: string[]): string[] {
  return paths.filter(
    (path) =>
      !paths.some((other) => other !== path && isPathWithin(other, path)),
  );
}

/** Why `name` cannot be used for a file or folder, or null when it can. */
export function nameProblem(name: string): string | null {
  if (name === '') return 'Enter a name.';
  if (name === '.' || name === '..') return 'That name is reserved.';
  if (name.includes('/')) return 'Names cannot contain a slash.';
  if (name.includes('\0')) return 'That name is not valid.';
  return null;
}
