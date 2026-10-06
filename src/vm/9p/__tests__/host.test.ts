import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FsChange } from '../../fs-protocol';
import { EEXIST, EINVAL, EISDIR, ENOENT } from '../constants';
import { fsErrorCode } from '../errors';
import { MemoryFile } from '../memory-opfs';
import { Opfs9pServer } from '../server';
import { O_RDONLY, ROOT_FID, TestClient, text } from './client';
import {
  asOpfsRoot,
  createFakeRoot,
  readText,
  type FakeDirectory,
} from './fake-opfs';

const PLAYGROUND = ['mininet-web', 'playground'];
const encoder = new TextEncoder();
const decoder = new TextDecoder();

let root: FakeDirectory;
const servers: Opfs9pServer[] = [];

async function connect(): Promise<TestClient> {
  const client = await TestClient.connect(root);
  servers.push(client.server);
  return client;
}

async function readHost(server: Opfs9pServer, path: string): Promise<string> {
  const result = await server.host.read(path, 1024);
  if (result.tooLarge) throw new Error('too large');
  return decoder.decode(result.data);
}

function names(entries: Array<{ name: string }>): string[] {
  return entries.map((entry) => entry.name).sort();
}

beforeEach(() => {
  root = createFakeRoot();
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('Opfs9pServer host operations', () => {
  it('lists files, directories and symlinks with their kinds', async () => {
    const client = await connect();
    await client.mkdir(ROOT_FID, 'dir');
    await client.symlink(ROOT_FID, 'link', 'dir/target');
    await client.walk(ROOT_FID, 1, []);
    await client.lcreate(1, 'file.py');

    const entries = await client.server.host.list('');
    expect(entries.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'dir', kind: 'dir' },
      { name: 'file.py', kind: 'file' },
      { name: 'link', kind: 'symlink', target: 'dir/target' },
    ]);
    expect(await client.server.host.list('dir')).toEqual([]);
  });

  it('reads what the guest wrote, including through an open guest fid', async () => {
    const client = await connect();
    await client.walk(ROOT_FID, 1, []);
    await client.lcreate(1, 'a.txt');
    await client.write(1, 0, 'from guest');

    expect(await readHost(client.server, 'a.txt')).toBe('from guest');
    await client.clunk(1);
    expect(await readHost(client.server, 'a.txt')).toBe('from guest');
  });

  it('reports files over the size limit without reading them', async () => {
    const client = await connect();
    await client.server.host.write('big', encoder.encode('0123456789'));
    expect(await client.server.host.read('big', 4)).toEqual({
      tooLarge: true,
      size: 10,
    });
  });

  it('writes files the guest then reads, creating and shrinking them', async () => {
    const client = await connect();
    await client.server.host.write(
      'a.txt',
      encoder.encode('a long first draft'),
    );
    await client.server.host.write('a.txt', encoder.encode('short'));

    await client.open(1, ['a.txt'], O_RDONLY);
    expect(text(await client.read(1, 0))).toBe('short');
    expect((await client.getattr(1)).size).toBe(5n);
    expect(readText(root, [...PLAYGROUND, 'a.txt'])).toBe('short');
  });

  it('removes a file it created when the write fails', async () => {
    const client = await connect();
    await client.server.host.write('old.txt', encoder.encode('keep'));
    const grow = MemoryFile.prototype.resize;
    const resize = vi
      .spyOn(MemoryFile.prototype, 'resize')
      .mockImplementation(function (this: MemoryFile, size: number) {
        if (size > this.size) {
          throw new DOMException('full', 'QuotaExceededError');
        }
        grow.call(this, size);
      });
    try {
      await expect(
        client.server.host.write('new.txt', encoder.encode('lost')),
      ).rejects.toSatisfy((error) => fsErrorCode(error) === 'no-space');
      await expect(
        client.server.host.write('old.txt', encoder.encode('longer text')),
      ).rejects.toSatisfy((error) => fsErrorCode(error) === 'no-space');
    } finally {
      resize.mockRestore();
    }

    expect(names(await client.server.host.list(''))).toEqual(['old.txt']);
    await client.server.host.write('new.txt', encoder.encode('retry'));
    expect(await readHost(client.server, 'new.txt')).toBe('retry');
  });

  it('writes through a fid the guest already holds open', async () => {
    const client = await connect();
    await client.walk(ROOT_FID, 1, []);
    await client.lcreate(1, 'a.txt');
    await client.write(1, 0, 'guest');

    await client.server.host.write('a.txt', encoder.encode('host wins'));
    expect(text(await client.read(1, 0))).toBe('host wins');
  });

  it('creates empty files and directories, refusing existing names', async () => {
    const client = await connect();
    await client.server.host.createDir('dir');
    await client.server.host.createFile('dir/new.py');

    expect(names(await client.server.host.list('dir'))).toEqual(['new.py']);
    expect(await readHost(client.server, 'dir/new.py')).toBe('');
    await expect(
      client.server.host.createFile('dir/new.py'),
    ).rejects.toMatchObject({ errno: EEXIST });
    await expect(client.server.host.createDir('dir')).rejects.toMatchObject({
      errno: EEXIST,
    });
    await expect(
      client.server.host.createFile('missing/new.py'),
    ).rejects.toSatisfy((error) => fsErrorCode(error) === 'not-found');
  });

  it('moves a directory tree and keeps an open guest fid usable', async () => {
    const client = await connect();
    await client.mkdir(ROOT_FID, 'src');
    await client.walk(ROOT_FID, 1, ['src']);
    await client.lcreate(1, 'a.txt');
    await client.write(1, 0, 'kept');

    await client.server.host.rename('src', 'dst');
    expect(names(await client.server.host.list(''))).toEqual(['dst']);
    expect(await readHost(client.server, 'dst/a.txt')).toBe('kept');
    expect(text(await client.read(1, 0))).toBe('kept');
  });

  it('refuses to move onto an existing entry or into a missing directory', async () => {
    const client = await connect();
    await client.server.host.write('a', encoder.encode('a'));
    await client.server.host.write('b', encoder.encode('b'));
    await client.walk(ROOT_FID, 1, ['a']);
    await client.lopen(1, O_RDONLY);

    await expect(client.server.host.rename('a', 'b')).rejects.toMatchObject({
      errno: EEXIST,
    });
    await expect(client.server.host.rename('a', 'nope/a')).rejects.toSatisfy(
      (error) => fsErrorCode(error) === 'not-found',
    );
    await expect(client.server.host.rename('gone', 'c')).rejects.toMatchObject({
      errno: ENOENT,
    });
    // The failed moves left the guest's open file intact.
    expect(text(await client.read(1, 0))).toBe('a');
    expect(await readHost(client.server, 'b')).toBe('b');
  });

  it('removes a non-empty directory and forgets its metadata', async () => {
    const client = await connect();
    await client.server.host.createDir('dir');
    await client.server.host.createDir('dir/sub');
    await client.server.host.write('dir/sub/a', encoder.encode('a'));
    await client.symlink(ROOT_FID, 'link', 'dir');

    await client.server.host.remove('dir');
    await client.server.host.remove('link');
    expect(await client.server.host.list('')).toEqual([]);
    expect(await client.walk(ROOT_FID, 1, ['dir'])).toBe(0);

    // A new file at a removed symlink's path is a regular file again.
    await client.server.host.createFile('link');
    expect(await client.server.host.list('')).toEqual([
      { name: 'link', kind: 'file' },
    ]);
  });

  it('rejects directories, symlinks and unsafe paths', async () => {
    const client = await connect();
    await client.server.host.createDir('dir');
    await client.symlink(ROOT_FID, 'link', 'dir');
    await client.server.host.write('file', encoder.encode('x'));

    await expect(client.server.host.read('dir', 10)).rejects.toMatchObject({
      errno: EISDIR,
    });
    await expect(
      client.server.host.write('dir', encoder.encode('x')),
    ).rejects.toMatchObject({ errno: EISDIR });
    await expect(client.server.host.read('link', 10)).rejects.toMatchObject({
      errno: EINVAL,
    });
    await expect(client.server.host.list('file')).rejects.toSatisfy(
      (error) => fsErrorCode(error) === 'not-dir',
    );
    await expect(client.server.host.list('file/x')).rejects.toSatisfy(
      (error) => fsErrorCode(error) === 'not-dir',
    );
    for (const path of [
      '../x',
      'dir/../file',
      './file',
      'dir//file',
      '/file',
    ]) {
      await expect(client.server.host.read(path, 10)).rejects.toMatchObject({
        errno: EINVAL,
      });
    }
    await expect(client.server.host.remove('')).rejects.toSatisfy(
      (error) => fsErrorCode(error) === 'busy',
    );
  });

  it('fails host operations after the server is closed', async () => {
    const client = await connect();
    await client.server.close();
    await expect(client.server.host.list('')).rejects.toSatisfy(
      (error) => fsErrorCode(error) === 'io',
    );
  });
});

describe('Opfs9pServer change notifications', () => {
  async function connectWatched(): Promise<{
    client: TestClient;
    next: () => Promise<FsChange>;
  }> {
    const pending: FsChange[] = [];
    let wake: (() => void) | undefined;
    const server = await Opfs9pServer.open(asOpfsRoot(root), (change) => {
      pending.push(change);
      wake?.();
    });
    servers.push(server);
    const client = await TestClient.attach(server);
    return {
      client,
      next: async () => {
        if (pending.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
        return pending.shift()!;
      },
    };
  }

  it('batches guest changes into directories and files', async () => {
    const { client, next } = await connectWatched();
    await client.mkdir(ROOT_FID, 'dir');
    await client.walk(ROOT_FID, 1, ['dir']);
    await client.lcreate(1, 'a.txt');
    await client.write(1, 0, 'one');
    await client.write(1, 3, 'two');

    const change = await next();
    expect(change.dirs.sort()).toEqual(['', 'dir']);
    expect(change.paths).toEqual(['dir/a.txt']);
  });

  it('reports both directories of a guest rename and an unlink', async () => {
    const { client, next } = await connectWatched();
    await client.mkdir(ROOT_FID, 'a');
    await client.mkdir(ROOT_FID, 'b');
    await client.walk(ROOT_FID, 1, ['a']);
    await client.walk(ROOT_FID, 2, ['b']);
    await client.server.host.write('a/f', encoder.encode('x'));
    await next();

    await client.renameat(1, 'f', 2, 'g');
    expect((await next()).dirs.sort()).toEqual(['a', 'b']);

    await client.unlinkat(2, 'g');
    expect(await next()).toEqual({ dirs: ['b'], paths: ['b/g'] });
  });

  it('reports files a host write creates, but not their content', async () => {
    const { client, next } = await connectWatched();
    await client.server.host.write('new.txt', encoder.encode('created'));
    expect(await next()).toEqual({ dirs: [''], paths: ['new.txt'] });

    await client.server.host.write('new.txt', encoder.encode('saved again'));
    await client.server.host.createDir('dir');
    expect(await next()).toEqual({ dirs: [''], paths: [] });
  });

  it('reports what a host operation changed before it settles', async () => {
    const seen: FsChange[] = [];
    const server = await Opfs9pServer.open(asOpfsRoot(root), (change) => {
      seen.push(change);
    });
    servers.push(server);

    await server.host.createDir('dir');
    expect(seen).toEqual([{ dirs: [''], paths: [] }]);

    await server.host.createFile('dir/a.txt');
    await server.host.rename('dir', 'moved');
    expect(seen.slice(1)).toEqual([
      { dirs: ['dir'], paths: ['dir/a.txt'] },
      { dirs: [''], paths: ['dir', 'moved'] },
    ]);

    await expect(server.host.createDir('moved')).rejects.toBeDefined();
    await server.host.list('');
    expect(seen).toHaveLength(3);
  });
});
