import { errorMessage } from '@/lib/errors';
import { baseName, joinPath, nameProblem, parentPath } from '@/lib/paths';
import { FsError, fsErrorMessage } from '@/vm/fs-protocol';

/** A file or directory the user picked or dropped, relative to the destination. */
export type UploadSource =
  | { kind: 'file'; relativePath: string; read: () => Promise<Uint8Array> }
  | { kind: 'dir'; relativePath: string };

/** One node from a dropped file or directory. */
export interface UploadEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  readFile(): Promise<Uint8Array>;
  readChildren(): Promise<UploadEntry[]>;
}

export interface UploadFs {
  list(path: string): Promise<{ name: string }[]>;
  createDir(path: string): Promise<void>;
  write(path: string, data: Uint8Array): Promise<void>;
}

export interface UploadFailure {
  /** Path relative to the destination; empty when the destination itself failed. */
  relativePath: string;
  message: string;
}

export interface UploadResult {
  /** Playground paths of files written and directories created. */
  paths: string[];
  failures: UploadFailure[];
}

/** How many failures the error message spells out before summarizing. */
const MAX_FAILURES_SHOWN = 3;

/** True when a drag is carrying files from outside the explorer. */
export function isExternalFileDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  for (const type of dataTransfer.types) {
    if (type === 'Files') return true;
  }
  return false;
}

export function uploadErrorMessage(failures: UploadFailure[]): string | null {
  if (failures.length === 0) return null;
  if (failures.length === 1 && failures[0].relativePath === '') {
    return `Could not upload files. ${failures[0].message}`;
  }
  const details = failures
    .slice(0, MAX_FAILURES_SHOWN)
    .map((failure) =>
      failure.relativePath === ''
        ? failure.message
        : `${failure.relativePath}: ${failure.message}`,
    );
  const more = failures.length - details.length;
  if (more > 0) details.push(`And ${more} more.`);
  return `Could not upload ${details.join(' ')}`;
}

export function sourcesFromFiles(files: Iterable<File>): UploadSource[] {
  return Array.from(files, (file) => ({
    kind: 'file' as const,
    relativePath: file.name,
    read: async () => new Uint8Array(await file.arrayBuffer()),
  }));
}

/** Flattens dropped files and directories. An empty directory is kept. */
export async function sourcesFromEntries(
  entries: readonly UploadEntry[],
): Promise<UploadSource[]> {
  const sources: UploadSource[] = [];
  async function walk(entry: UploadEntry, prefix: string): Promise<void> {
    const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory) {
      sources.push({ kind: 'dir', relativePath });
      for (const child of await entry.readChildren()) {
        await walk(child, relativePath);
      }
      return;
    }
    if (entry.isFile) {
      sources.push({
        kind: 'file',
        relativePath,
        read: () => entry.readFile(),
      });
    }
  }
  for (const entry of entries) await walk(entry, '');
  return sources;
}

/**
 * Reads drag payload synchronously, then walks directories. `webkitGetAsEntry`
 * has to run during the drop event; the file bytes can be read afterwards.
 */
export function sourcesFromDataTransfer(
  dataTransfer: DataTransfer,
): Promise<UploadSource[]> {
  const entries: UploadEntry[] = [];
  for (const item of dataTransfer.items) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry();
    if (entry) entries.push(domEntry(entry));
  }
  if (entries.length > 0) return sourcesFromEntries(entries);
  return Promise.resolve(sourcesFromFiles(dataTransfer.files));
}

/**
 * Adds `sources` under `destination`. Existing files and folders are left as
 * they are: a file already there is reported, and a folder already there
 * receives anything dropped inside it.
 */
export async function uploadToPlayground(
  fs: UploadFs,
  destination: string,
  sources: readonly UploadSource[],
): Promise<UploadResult> {
  const failures: UploadFailure[] = [];
  const directories = new Set<string>();
  const files: Extract<UploadSource, { kind: 'file' }>[] = [];

  for (const source of sources) {
    const problem = relativePathProblem(source.relativePath);
    if (problem) {
      failures.push({ relativePath: source.relativePath, message: problem });
      continue;
    }
    switch (source.kind) {
      case 'dir':
        for (const dir of selfAndParents(source.relativePath)) {
          directories.add(dir);
        }
        break;
      case 'file':
        for (const dir of parentsOnly(source.relativePath))
          directories.add(dir);
        files.push(source);
        break;
      default: {
        const exhaustive: never = source;
        throw new Error(exhaustive);
      }
    }
  }

  const names = new Map<string, Set<string>>();
  try {
    names.set(destination, await entryNames(fs, destination));
  } catch (error) {
    return {
      paths: [],
      failures: [{ relativePath: '', message: errorMessage(error) }],
    };
  }

  const created: string[] = [];
  const failed = new Set<string>();
  const orderedDirs = [...directories].sort(
    (a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : 1),
  );
  for (const relative of orderedDirs) {
    if (blocked(relative, failed)) continue;
    const path = joinPath(destination, relative);
    const parent = parentPath(path);
    const name = baseName(relative);
    try {
      const siblings = await namesIn(fs, names, parent);
      if (siblings.has(name)) {
        names.set(path, await entryNames(fs, path));
      } else {
        await fs.createDir(path);
        siblings.add(name);
        names.set(path, new Set());
        created.push(path);
      }
    } catch (error) {
      failed.add(relative);
      failures.push({ relativePath: relative, message: errorMessage(error) });
    }
  }

  const written: string[] = [];
  for (const file of files) {
    if (blocked(file.relativePath, failed)) continue;
    const path = joinPath(destination, file.relativePath);
    const name = baseName(file.relativePath);
    try {
      const siblings = await namesIn(fs, names, parentPath(path));
      if (siblings.has(name)) {
        failures.push({
          relativePath: file.relativePath,
          message: fsErrorMessage('exists'),
        });
        continue;
      }
      const data = await file.read();
      await fs.write(path, data);
      siblings.add(name);
      written.push(path);
    } catch (error) {
      failures.push({
        relativePath: file.relativePath,
        message: errorMessage(error),
      });
    }
  }

  return { paths: [...created, ...written], failures };
}

function relativePathProblem(relativePath: string): string | null {
  if (relativePath === '' || relativePath.startsWith('/')) {
    return 'That name is not valid.';
  }
  for (const part of relativePath.split('/')) {
    const problem = nameProblem(part);
    if (problem) return problem;
  }
  return null;
}

function selfAndParents(relativePath: string): string[] {
  return [...parentsOnly(relativePath), relativePath];
}

function parentsOnly(relativePath: string): string[] {
  const parts = relativePath.split('/');
  parts.pop();
  const dirs: string[] = [];
  for (let index = 0; index < parts.length; index++) {
    dirs.push(parts.slice(0, index + 1).join('/'));
  }
  return dirs;
}

function blocked(relativePath: string, failed: ReadonlySet<string>): boolean {
  let dir = parentPath(relativePath);
  while (dir !== '') {
    if (failed.has(dir)) return true;
    dir = parentPath(dir);
  }
  return false;
}

async function namesIn(
  fs: UploadFs,
  names: Map<string, Set<string>>,
  dir: string,
): Promise<Set<string>> {
  const cached = names.get(dir);
  if (cached) return cached;
  const loaded = await entryNames(fs, dir);
  names.set(dir, loaded);
  return loaded;
}

async function entryNames(fs: UploadFs, dir: string): Promise<Set<string>> {
  const entries = await fs.list(dir);
  return new Set(entries.map((entry) => entry.name));
}

function domEntry(entry: FileSystemEntry): UploadEntry {
  return {
    name: entry.name,
    isFile: entry.isFile,
    isDirectory: entry.isDirectory,
    readFile: () => readDomFile(entry),
    readChildren: () => readDomChildren(entry),
  };
}

function readDomFile(entry: FileSystemEntry): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (!entry.isFile) {
      reject(new FsError('io'));
      return;
    }
    (entry as FileSystemFileEntry).file(
      (file) => {
        void file.arrayBuffer().then(
          (buffer) => resolve(new Uint8Array(buffer)),
          () => reject(new FsError('io')),
        );
      },
      () => reject(new FsError('io')),
    );
  });
}

function readDomChildren(entry: FileSystemEntry): Promise<UploadEntry[]> {
  if (!entry.isDirectory) return Promise.resolve([]);
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const read = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) resolve(all.map(domEntry));
          else {
            all.push(...batch);
            read();
          }
        },
        () => reject(new FsError('io')),
      );
    };
    read();
  });
}
