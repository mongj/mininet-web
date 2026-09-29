import {
  DT_DIR,
  DT_LNK,
  DT_REG,
  P9_QTDIR,
  P9_QTFILE,
  P9_QTSYMLINK,
  S_IFDIR,
  S_IFLNK,
  S_IFREG,
} from './constants';

export type NodeKind = 'file' | 'dir' | 'symlink';

export function typeMode(kind: NodeKind): number {
  switch (kind) {
    case 'dir':
      return S_IFDIR;
    case 'symlink':
      return S_IFLNK;
    case 'file':
      return S_IFREG;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function qidType(kind: NodeKind): number {
  switch (kind) {
    case 'dir':
      return P9_QTDIR;
    case 'symlink':
      return P9_QTSYMLINK;
    case 'file':
      return P9_QTFILE;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function direntType(kind: NodeKind): number {
  switch (kind) {
    case 'dir':
      return DT_DIR;
    case 'symlink':
      return DT_LNK;
    case 'file':
      return DT_REG;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}
