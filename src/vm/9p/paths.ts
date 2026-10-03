import { EINVAL, ENAMETOOLONG, NAME_MAX } from './constants';
import { P9Error } from './errors';
import { isPathWithin, rebasePath } from '../../lib/paths';

export {
  baseName,
  isPathWithin,
  joinPath,
  parentPath,
  rebasePath,
} from '../../lib/paths';

const encoder = new TextEncoder();

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
