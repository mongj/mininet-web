import { describe, expect, it } from 'vitest';
import { FsError } from '@/vm/fs-protocol';
import { parentPath } from '@/lib/paths';
import {
  isExternalFileDrag,
  sourcesFromEntries,
  uploadErrorMessage,
  uploadToPlayground,
  type UploadEntry,
  type UploadFs,
  type UploadSource,
} from '../upload';

function memoryFs(seed?: {
  dirs?: string[];
  files?: Record<string, string>;
}): UploadFs & { files: Map<string, Uint8Array> } {
  const dirs = new Set<string>(['']);
  const files = new Map<string, Uint8Array>();
  for (const dir of seed?.dirs ?? []) addDir(dirs, dir);
  for (const [path, text] of Object.entries(seed?.files ?? {})) {
    addDir(dirs, parentPath(path));
    files.set(path, new TextEncoder().encode(text));
  }

  return {
    files,
    async list(path) {
      if (files.has(path)) throw new FsError('not-dir');
      if (!dirs.has(path)) throw new FsError('not-found');
      return childNames(path, dirs, files);
    },
    async createDir(path) {
      const parent = parentPath(path);
      if (files.has(parent)) throw new FsError('not-dir');
      if (!dirs.has(parent)) throw new FsError('not-found');
      if (dirs.has(path) || files.has(path)) throw new FsError('exists');
      dirs.add(path);
    },
    async write(path, data) {
      const parent = parentPath(path);
      if (files.has(parent)) throw new FsError('not-dir');
      if (!dirs.has(parent)) throw new FsError('not-found');
      if (dirs.has(path)) throw new FsError('is-dir');
      files.set(path, data);
    },
  };
}

function addDir(dirs: Set<string>, path: string) {
  if (path === '') return;
  addDir(dirs, parentPath(path));
  dirs.add(path);
}

function childNames(
  path: string,
  dirs: Set<string>,
  files: Map<string, Uint8Array>,
): { name: string }[] {
  const prefix = path === '' ? '' : `${path}/`;
  const names = new Set<string>();
  for (const dir of dirs) {
    if (dir === path || !dir.startsWith(prefix)) continue;
    const rest = dir.slice(prefix.length);
    if (!rest.includes('/')) names.add(rest);
  }
  for (const file of files.keys()) {
    if (!file.startsWith(prefix)) continue;
    const rest = file.slice(prefix.length);
    if (rest !== '' && !rest.includes('/')) names.add(rest);
  }
  return [...names].map((name) => ({ name }));
}

function file(relativePath: string, text: string): UploadSource {
  return {
    kind: 'file',
    relativePath,
    read: async () => new TextEncoder().encode(text),
  };
}

function text(bytes: Uint8Array | undefined): string {
  return new TextDecoder().decode(bytes);
}

describe('uploadToPlayground', () => {
  it('writes files and creates the directories that hold them', async () => {
    const fs = memoryFs({ dirs: ['lab'] });
    const result = await uploadToPlayground(fs, 'lab', [
      file('topo.py', 'print(1)\n'),
      file('nets/spine.py', 'spine\n'),
    ]);

    expect(result.failures).toEqual([]);
    expect(result.paths).toEqual([
      'lab/nets',
      'lab/topo.py',
      'lab/nets/spine.py',
    ]);
    expect(text(fs.files.get('lab/topo.py'))).toBe('print(1)\n');
    expect(text(fs.files.get('lab/nets/spine.py'))).toBe('spine\n');
  });

  it('keeps an existing file and still uploads the rest', async () => {
    const fs = memoryFs({ files: { 'lab/topo.py': 'keep\n' } });
    const result = await uploadToPlayground(fs, 'lab', [
      file('topo.py', 'replace\n'),
      file('new.py', 'new\n'),
    ]);

    expect(text(fs.files.get('lab/topo.py'))).toBe('keep\n');
    expect(text(fs.files.get('lab/new.py'))).toBe('new\n');
    expect(result.paths).toEqual(['lab/new.py']);
    expect(result.failures).toEqual([
      {
        relativePath: 'topo.py',
        message: 'A file or folder with that name already exists.',
      },
    ]);
  });

  it('puts files into a directory that is already there', async () => {
    const fs = memoryFs({ dirs: ['lab/nets'] });
    const result = await uploadToPlayground(fs, '', [
      { kind: 'dir', relativePath: 'lab/nets' },
      file('lab/nets/leaf.py', 'leaf\n'),
    ]);

    expect(result.failures).toEqual([]);
    expect(result.paths).toEqual(['lab/nets/leaf.py']);
    expect(text(fs.files.get('lab/nets/leaf.py'))).toBe('leaf\n');
  });

  it('does not write inside a name that is already a file', async () => {
    const fs = memoryFs({ files: { 'lab/nets': 'not a folder' } });
    const result = await uploadToPlayground(fs, 'lab', [
      file('nets/leaf.py', 'leaf\n'),
    ]);

    expect(fs.files.has('lab/nets/leaf.py')).toBe(false);
    expect(text(fs.files.get('lab/nets'))).toBe('not a folder');
    expect(result.paths).toEqual([]);
    expect(result.failures.map((failure) => failure.relativePath)).toEqual([
      'nets',
    ]);
  });

  it('rejects names that would escape the destination', async () => {
    const fs = memoryFs({ dirs: ['lab'] });
    const result = await uploadToPlayground(fs, 'lab', [
      file('../escape.py', 'nope\n'),
      file('ok.py', 'ok\n'),
    ]);

    expect(fs.files.has('escape.py')).toBe(false);
    expect(text(fs.files.get('lab/ok.py'))).toBe('ok\n');
    expect(result.failures[0]?.message).toBe('That name is reserved.');
  });

  it('reports when the destination cannot be listed', async () => {
    const fs = memoryFs();
    const result = await uploadToPlayground(fs, 'missing', [file('a.py', 'a')]);

    expect(result.paths).toEqual([]);
    expect(uploadErrorMessage(result.failures)).toBe(
      'Could not upload files. No such file or folder.',
    );
  });
});

describe('uploadErrorMessage', () => {
  it('spells out the first failures and counts the rest', () => {
    const failures = ['a', 'b', 'c', 'd', 'e'].map((relativePath) => ({
      relativePath,
      message: 'Nope.',
    }));

    expect(uploadErrorMessage(failures.slice(0, 2))).toBe(
      'Could not upload a: Nope. b: Nope.',
    );
    expect(uploadErrorMessage(failures)).toBe(
      'Could not upload a: Nope. b: Nope. c: Nope. And 2 more.',
    );
  });
});

describe('sourcesFromEntries', () => {
  it('keeps an empty directory and nested files', async () => {
    const entries: UploadEntry[] = [
      {
        name: 'notes',
        isDirectory: true,
        isFile: false,
        readFile: async () => new Uint8Array(),
        readChildren: async () => [],
      },
      {
        name: 'lab',
        isDirectory: true,
        isFile: false,
        readFile: async () => new Uint8Array(),
        readChildren: async () => [
          {
            name: 'topo.py',
            isDirectory: false,
            isFile: true,
            readFile: async () => new TextEncoder().encode('print(1)\n'),
            readChildren: async () => [],
          },
        ],
      },
    ];

    const sources = await sourcesFromEntries(entries);
    expect(sources.map((source) => [source.kind, source.relativePath])).toEqual(
      [
        ['dir', 'notes'],
        ['dir', 'lab'],
        ['file', 'lab/topo.py'],
      ],
    );
  });
});

describe('isExternalFileDrag', () => {
  it('accepts a drag that carries files', () => {
    expect(
      isExternalFileDrag({ types: ['Files'] } as unknown as DataTransfer),
    ).toBe(true);
    expect(
      isExternalFileDrag({ types: ['text/plain'] } as unknown as DataTransfer),
    ).toBe(false);
    expect(isExternalFileDrag(null)).toBe(false);
  });
});
