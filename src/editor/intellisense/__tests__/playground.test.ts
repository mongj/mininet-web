import { describe, expect, it } from 'vitest';
import type { FsEntry } from '@/vm/fs-protocol';
import {
  fromUri,
  isPythonFile,
  listPythonFiles,
  readSource,
  toUri,
} from '../playground';

function fakeFs(tree: Record<string, FsEntry[]>) {
  const listed: string[] = [];
  return {
    listed,
    list: async (path: string) => {
      listed.push(path);
      const entries = tree[path];
      if (!entries) throw new Error(`no such folder: ${path}`);
      return [...entries];
    },
  };
}

const file = (name: string): FsEntry => ({ name, kind: 'file' });
const dir = (name: string): FsEntry => ({ name, kind: 'dir' });

describe('playground URIs', () => {
  it('round-trips paths, including ones that need escaping', () => {
    for (const path of ['lab.py', 'nets/ring.py', 'my topo/a#b.py', 'ü/ß.py']) {
      expect(fromUri(toUri(path))).toBe(path);
    }
    expect(toUri('my topo/a.py')).toBe('file:///playground/my%20topo/a.py');
  });

  it('accepts the unescaped form a server may send back', () => {
    expect(fromUri('file:///playground/nets/ring.py')).toBe('nets/ring.py');
  });

  it('rejects anything outside the playground', () => {
    expect(fromUri('file:///lib/mininet/net.py')).toBeNull();
    expect(fromUri('file:///playground')).toBeNull();
    expect(fromUri('not a uri')).toBeNull();
  });
});

describe('listPythonFiles', () => {
  it('finds Python files in nested folders, shallowest first', async () => {
    const fs = fakeFs({
      '': [dir('nets'), file('lab.py'), file('notes.md'), file('a.pyi')],
      nets: [file('ring.py'), dir('deep'), file('data.json')],
      'nets/deep': [file('x.py')],
    });
    expect(await listPythonFiles(fs)).toEqual([
      'a.pyi',
      'lab.py',
      'nets/ring.py',
      'nets/deep/x.py',
    ]);
  });

  it('skips hidden folders, caches and symlinks', async () => {
    const fs = fakeFs({
      '': [
        dir('.git'),
        dir('__pycache__'),
        dir('node_modules'),
        { name: 'link.py', kind: 'symlink', target: 'lab.py' },
        file('lab.py'),
      ],
    });
    expect(await listPythonFiles(fs)).toEqual(['lab.py']);
    expect(fs.listed).toEqual(['']);
  });

  it('stops at 200 files', async () => {
    const fs = fakeFs({
      '': Array.from({ length: 250 }, (_, i) => file(`f${i}.py`)),
    });
    expect(await listPythonFiles(fs)).toHaveLength(200);
  });

  it('only matches the Python extensions', () => {
    expect(isPythonFile('a.py')).toBe(true);
    expect(isPythonFile('a.pyi')).toBe(true);
    expect(isPythonFile('a.pyc')).toBe(false);
    expect(isPythonFile('py')).toBe(false);
  });
});

describe('readSource', () => {
  const encoder = new TextEncoder();

  it('returns text, and null for oversized or non-UTF-8 files', async () => {
    const read = async (path: string) =>
      path === 'big.py'
        ? ({ tooLarge: true, size: 1 << 30 } as const)
        : ({
            tooLarge: false,
            data:
              path === 'bad.py'
                ? new Uint8Array([0xff, 0xfe, 0x00])
                : encoder.encode('print("héllo")\n'),
          } as const);
    expect(await readSource({ read }, 'ok.py')).toBe('print("héllo")\n');
    expect(await readSource({ read }, 'big.py')).toBeNull();
    expect(await readSource({ read }, 'bad.py')).toBeNull();
  });
});
