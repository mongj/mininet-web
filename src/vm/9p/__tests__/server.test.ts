import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OPFS_APP_DIR,
  OPFS_META_FILE,
  OPFS_META_TEMP_FILE,
} from '../../opfs-storage';
import {
  ENOENT,
  P9_SETATTR_MODE,
  P9_STATS_BASIC,
  S_IFLNK,
  S_IFMT,
  S_IFREG,
} from '../constants';
import { O_RDONLY, ROOT_FID, TestClient, text } from './client';
import {
  createFakeRoot,
  readText,
  writeText,
  type FakeDirectory,
} from './fake-opfs';

let root: FakeDirectory;
const clients: TestClient[] = [];

async function connect(): Promise<TestClient> {
  const client = await TestClient.connect(root);
  clients.push(client);
  return client;
}

/** Closes `client` (flushing meta.json) and opens a fresh server on the same root. */
async function restart(client: TestClient): Promise<TestClient> {
  await client.server.close();
  return connect();
}

/** Clones the root fid into `fid` and creates `name` there, leaving it open. */
async function createFile(
  client: TestClient,
  fid: number,
  name: string,
  content = '',
  mode?: number,
): Promise<void> {
  await client.walk(ROOT_FID, fid, []);
  await client.lcreate(fid, name, mode);
  if (content) await client.write(fid, 0, content);
}

beforeEach(() => {
  root = createFakeRoot();
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.server.close()));
});

describe('Opfs9pServer file I/O', () => {
  it('writes a file that reads back and persists across a server restart', async () => {
    const client = await connect();
    await createFile(client, 1, 'notes.txt', 'hello 9p');
    expect(text(await client.read(1, 0))).toBe('hello 9p');
    expect(text(await client.read(1, 6, 2))).toBe('9p');
    await client.clunk(1);

    const next = await restart(client);
    await next.open(2, ['notes.txt'], O_RDONLY);
    expect(text(await next.read(2, 0))).toBe('hello 9p');
    expect((await next.getattr(2)).size).toBe(8n);
  });

  it('shares one sync access handle between two fids on the same file', async () => {
    const client = await connect();
    await createFile(client, 1, 'shared', 'abc');

    await client.open(2, ['shared'], O_RDONLY);
    expect(text(await client.read(2, 0))).toBe('abc');

    await client.write(1, 3, 'def');
    await client.clunk(1);
    expect(text(await client.read(2, 0))).toBe('abcdef');

    await client.clunk(2);
    // The last clunk released the handle, so the file can be opened again.
    await client.open(3, ['shared']);
    expect(text(await client.read(3, 0))).toBe('abcdef');
  });

  it('accepts Tfsync with a 32-bit datasync field', async () => {
    const client = await connect();
    await createFile(client, 1, 'synced', 'x');
    await expect(client.fsync(1, 1)).resolves.toBeUndefined();
    await expect(client.fsync(ROOT_FID, 0)).resolves.toBeUndefined();
  });
});

describe('Opfs9pServer rename and unlink', () => {
  it('keeps I/O working on an open fid after its file is renamed', async () => {
    const client = await connect();
    await createFile(client, 1, 'old', 'hello');

    await client.renameat(ROOT_FID, 'old', ROOT_FID, 'new');

    await client.write(1, 5, ' world');
    expect(text(await client.read(1, 0))).toBe('hello world');
    expect(await client.walk(ROOT_FID, 2, ['old'])).toBe(0);
    await client.open(3, ['new'], O_RDONLY);
    expect(text(await client.read(3, 0))).toBe('hello world');
  });

  it('remaps open children when their directory is renamed', async () => {
    const client = await connect();
    await client.mkdir(ROOT_FID, 'dir');
    await client.walk(ROOT_FID, 1, ['dir']);
    await client.lcreate(1, 'child');
    await client.write(1, 0, 'inside');

    await client.renameat(ROOT_FID, 'dir', ROOT_FID, 'moved');

    expect(text(await client.read(1, 0))).toBe('inside');
    expect(await client.walk(ROOT_FID, 2, ['dir'])).toBe(0);
    await client.open(3, ['moved', 'child'], O_RDONLY);
    expect(text(await client.read(3, 0))).toBe('inside');
  });

  it('fails reads on a still-open fid with ENOENT after unlink', async () => {
    const client = await connect();
    await createFile(client, 1, 'doomed', 'bye');

    await client.unlinkat(ROOT_FID, 'doomed');

    await expect(client.read(1, 0)).rejects.toMatchObject({ errno: ENOENT });
    await expect(client.clunk(1)).resolves.toBeUndefined();
    expect(await client.walk(ROOT_FID, 2, ['doomed'])).toBe(0);
  });
});

describe('Opfs9pServer metadata', () => {
  it('round-trips symlinks and keeps them across a restart', async () => {
    const client = await connect();
    await client.symlink(ROOT_FID, 'link', '../target/файл');
    await client.walk(ROOT_FID, 1, ['link']);
    expect(await client.readlink(1)).toBe('../target/файл');
    expect((await client.getattr(1)).mode & S_IFMT).toBe(S_IFLNK);

    const next = await restart(client);
    await next.walk(ROOT_FID, 2, ['link']);
    expect(await next.readlink(2)).toBe('../target/файл');
    expect((await next.getattr(2)).mode & S_IFMT).toBe(S_IFLNK);
  });

  it('persists chmod across a restart once the server is closed', async () => {
    const client = await connect();
    await createFile(client, 1, 'script', '#!/bin/sh', 0o644);
    await client.setattr(1, P9_SETATTR_MODE, 0o755);

    const next = await restart(client);
    await next.walk(ROOT_FID, 2, ['script']);
    expect((await next.getattr(2)).mode).toBe(S_IFREG | 0o755);
  });

  it('recovers from a corrupt meta.json using a valid meta.json.tmp', async () => {
    const client = await connect();
    await client.symlink(ROOT_FID, 'link', 'target');
    await client.server.close();

    const metaPath = [OPFS_APP_DIR, OPFS_META_FILE];
    const good = readText(root, metaPath);
    expect(good).toContain('"symlink":"target"');
    writeText(root, [OPFS_APP_DIR, OPFS_META_TEMP_FILE], good!);
    writeText(root, metaPath, '{"version":1,"entr');

    const next = await connect();
    await next.walk(ROOT_FID, 1, ['link']);
    expect(await next.readlink(1)).toBe('target');
  });

  it('never reports getattr valid bits outside P9_STATS_BASIC', async () => {
    const client = await connect();
    await createFile(client, 1, 'f');
    const { valid } = await client.getattr(1, 0xffff_ffff_ffff_ffffn);
    expect(valid & ~P9_STATS_BASIC).toBe(0n);
    expect(valid).toBe(P9_STATS_BASIC);
  });
});

describe('Opfs9pServer readdir', () => {
  it('refreshes the listing when an open directory is re-read from offset 0', async () => {
    const client = await connect();
    await client.walk(ROOT_FID, 1, []);
    await client.lopen(1, O_RDONLY);
    expect(await client.readdir(1)).toEqual(['.', '..']);

    await createFile(client, 2, 'fresh');

    expect(await client.readdir(1)).toEqual(['.', '..', 'fresh']);
  });
});
