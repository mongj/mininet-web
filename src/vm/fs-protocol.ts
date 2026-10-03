// Host-side file operations on the playground, served by the emulator worker.
// Paths are relative to the playground root: '' is the root, 'a/b' a descendant.

export type FsEntryKind = 'file' | 'dir' | 'symlink';

export interface FsEntry {
  name: string;
  kind: FsEntryKind;
  /** Link target, for symlinks. */
  target?: string;
}

export type FsReadResult =
  { tooLarge: false; data: Uint8Array } | { tooLarge: true; size: number };

/** What the page can do to the playground; each call fails with an `FsError`. */
export interface HostFs {
  list(path: string): Promise<FsEntry[]>;
  /** Reads a regular file, unless it is larger than `maxBytes`. */
  read(path: string, maxBytes: number): Promise<FsReadResult>;
  /** Replaces the content of a regular file, creating it when missing. */
  write(path: string, data: Uint8Array): Promise<void>;
  /** Creates an empty file; an existing `path` is an error. */
  createFile(path: string): Promise<void>;
  createDir(path: string): Promise<void>;
  /** Moves `from` to `to`; an existing `to` is an error. */
  rename(from: string, to: string): Promise<void>;
  /** Removes a file, or a directory with everything in it. */
  remove(path: string): Promise<void>;
}

export type FsMethod = keyof HostFs;

export type FsRequest = {
  [M in FsMethod]: { method: M; args: Parameters<HostFs[M]> };
}[FsMethod];

export type FsErrorCode =
  | 'not-found'
  | 'exists'
  | 'not-dir'
  | 'is-dir'
  | 'not-empty'
  | 'invalid'
  | 'name-too-long'
  | 'busy'
  | 'no-space'
  | 'unavailable'
  | 'io';

export interface FsChange {
  /** Directories whose entries changed. */
  dirs: string[];
  /**
   * Files whose content changed, and entries that were created, removed or
   * moved. A folder here stands for everything inside it.
   */
  paths: string[];
}

export class FsError extends Error {
  constructor(readonly code: FsErrorCode) {
    super(fsErrorMessage(code));
    this.name = 'FsError';
  }
}

export function fsErrorMessage(code: FsErrorCode): string {
  switch (code) {
    case 'not-found':
      return 'No such file or folder.';
    case 'exists':
      return 'A file or folder with that name already exists.';
    case 'not-dir':
      return 'Not a folder.';
    case 'is-dir':
      return 'That is a folder.';
    case 'not-empty':
      return 'The folder is not empty.';
    case 'invalid':
      return 'That name is not valid.';
    case 'name-too-long':
      return 'That name is too long.';
    case 'busy':
      return 'The file is in use.';
    case 'no-space':
      return 'Storage is full.';
    case 'unavailable':
      return 'Files are not available until Linux is running.';
    case 'io':
      return 'The file operation failed.';
    default: {
      const exhaustive: never = code;
      return exhaustive;
    }
  }
}
