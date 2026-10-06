import type { FsChange, FsEntry, FsReadResult, HostFs } from '../fs-protocol';
import { OPFS_APP_DIR, OPFS_PLAYGROUND_DIR } from '../opfs-storage';
import {
  AT_REMOVEDIR,
  EACCES,
  EBADF,
  EBUSY,
  EEXIST,
  EINVAL,
  EIO,
  EISDIR,
  ELOOP,
  ENOENT,
  ENOTDIR,
  ENOTEMPTY,
  EOPNOTSUPP,
  EPERM,
  NAME_MAX,
  O_ACCMODE,
  O_DIRECTORY,
  O_NOFOLLOW,
  O_RDONLY,
  O_TRUNC,
  P9_HEADER_SIZE,
  P9_DIRENT_FIXED_SIZE,
  P9_IOUNIT,
  P9_LOCK_SUCCESS,
  P9_LOCK_TYPE_UNLCK,
  P9_MIN_MSIZE,
  P9_MSIZE,
  P9_RATTACH,
  P9_RCLUNK,
  P9_RFLUSH,
  P9_RFSYNC,
  P9_RGETATTR,
  P9_RGETLOCK,
  P9_RLCREATE,
  P9_RLOCK,
  P9_RLOPEN,
  P9_RMKDIR,
  P9_RREAD,
  P9_RREAD_OVERHEAD,
  P9_RREADDIR,
  P9_RREADLINK,
  P9_RREMOVE,
  P9_RRENAME,
  P9_RRENAMEAT,
  P9_RSETATTR,
  P9_RSTATFS,
  P9_RSYMLINK,
  P9_RUNLINKAT,
  P9_RVERSION,
  P9_RWALK,
  P9_RWRITE,
  P9_SETATTR_ATIME,
  P9_SETATTR_ATIME_SET,
  P9_SETATTR_GID,
  P9_SETATTR_MODE,
  P9_SETATTR_MTIME,
  P9_SETATTR_MTIME_SET,
  P9_SETATTR_SIZE,
  P9_SETATTR_UID,
  P9_STATS_BASIC,
  P9_TATTACH,
  P9_TAUTH,
  P9_TCLUNK,
  P9_TFLUSH,
  P9_TFSYNC,
  P9_TGETATTR,
  P9_TGETLOCK,
  P9_TLCREATE,
  P9_TLINK,
  P9_TLOCK,
  P9_TLOPEN,
  P9_TMKDIR,
  P9_TMKNOD,
  P9_TREAD,
  P9_TREADDIR,
  P9_TREADLINK,
  P9_TREMOVE,
  P9_TRENAME,
  P9_TRENAMEAT,
  P9_TSETATTR,
  P9_TSTATFS,
  P9_TSYMLINK,
  P9_TUNLINKAT,
  P9_TVERSION,
  P9_TWALK,
  P9_TWRITE,
  P9_TXATTRCREATE,
  P9_TXATTRWALK,
  P9_VERSION,
  S_IFDIR,
  S_IFREG,
  S_IRWXUGO,
} from './constants';
import { isDomError, mapError, P9Error } from './errors';
import { HandleCache, type OpenHandle } from './handles';
import {
  defaultMeta,
  MetaStore,
  nowTimes,
  SYMLINK_MODE,
  type MetaEntry,
} from './meta-store';
import { direntType, typeMode, type NodeKind } from './node-kind';
import { canMove, copyDir, copyFile, isDirEmpty, listed } from './opfs';
import {
  assertName,
  baseName,
  isPathWithin,
  joinPath,
  parentPath,
  rebasePath,
} from './paths';
import { QidTable } from './qids';
import {
  asSafeNumber,
  emptyReply,
  encodeDirent,
  errorReply,
  header,
  Reader,
  roundDirents,
  Writer,
  type Qid,
} from './wire';

const V9FS_MAGIC = 0x01021997;
const BLOCK_SIZE = 4096;
/** st_blocks is counted in 512-byte units regardless of blksize. */
const ST_BLOCK_UNIT = 512;
const STATFS_FALLBACK_QUOTA = 64 * 1024 * 1024;
const STATFS_FILE_COUNT = 1024 * 1024;
const CHANGE_FLUSH_MS = 100;

const encoder = new TextEncoder();

/** Files and folders made from the page belong to root, like the shell's. */
const ROOT_OWNER = { uid: 0, gid: 0 };

function assertHostPath(path: string): void {
  if (path === '') return;
  for (const name of path.split('/')) {
    assertName(name);
    if (name === '.' || name === '..') throw new P9Error(EINVAL);
  }
}

interface Fid {
  path: string;
  kind: NodeKind;
  uid: number;
  opened: boolean;
  dirSnapshot?: Uint8Array;
  /** Shared sync access handle held while this fid is open on a regular file. */
  handle?: OpenHandle;
}

export class Opfs9pServer {
  private readonly fids = new Map<number, Fid>();
  private readonly qids = new QidTable();
  private readonly handles = new HandleCache((path) => this.getFile(path));
  private readonly meta: MetaStore;
  private msize = P9_MSIZE;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly changedDirs = new Set<string>();
  private readonly changedPaths = new Set<string>();
  private changeTimer: ReturnType<typeof setTimeout> | undefined;

  private constructor(
    appDir: FileSystemDirectoryHandle,
    private readonly playground: FileSystemDirectoryHandle,
    private readonly onChange?: (change: FsChange) => void,
  ) {
    this.meta = new MetaStore(appDir, (flush) => {
      this.queue = this.queue.then(flush).catch((error: unknown) => {
        console.error(error);
      });
    });
  }

  /**
   * Serves the playground under `root` (default: this origin's OPFS root).
   * `onChange` receives debounced batches of what changed in the playground.
   */
  static async open(
    root?: FileSystemDirectoryHandle,
    onChange?: (change: FsChange) => void,
  ): Promise<Opfs9pServer> {
    const storageRoot = root ?? (await navigator.storage.getDirectory());
    const appDir = await storageRoot.getDirectoryHandle(OPFS_APP_DIR, {
      create: true,
    });
    const playground = await appDir.getDirectoryHandle(OPFS_PLAYGROUND_DIR, {
      create: true,
    });
    const server = new Opfs9pServer(appDir, playground, onChange);
    await server.meta.load(playground);
    return server;
  }

  handle(req: Uint8Array, reply: (buf: Uint8Array) => void): void {
    this.queue = this.queue
      .then(async () => {
        let response: Uint8Array;
        try {
          if (this.closed) throw new P9Error(EIO);
          response = await this.dispatch(req);
        } catch (error) {
          if (!(error instanceof P9Error)) console.error(error);
          // Without a full header there is no tag to answer.
          if (req.length < P9_HEADER_SIZE) return;
          response = errorReply(header(req).tag, mapError(error));
        }
        reply(response);
      })
      .catch((error) => {
        console.error(error);
      });
  }

  async close(): Promise<void> {
    await this.queue;
    this.closed = true;
    if (this.changeTimer !== undefined) {
      clearTimeout(this.changeTimer);
      this.changeTimer = undefined;
    }
    await this.meta.close();
    this.resetSession();
  }

  /**
   * Host-side operations, serialized with the guest's 9P requests. What one
   * changes is reported through `onChange` before it settles.
   */
  readonly host: HostFs = {
    list: (path) =>
      this.run(async () => {
        assertHostPath(path);
        const dir = await this.getDir(path);
        const entries: FsEntry[] = [];
        for await (const [name, handle] of listed(dir).entries()) {
          const target = this.meta.get(joinPath(path, name))?.symlink;
          if (handle.kind === 'directory') entries.push({ name, kind: 'dir' });
          else if (typeof target === 'string')
            entries.push({ name, kind: 'symlink', target });
          else entries.push({ name, kind: 'file' });
        }
        return entries;
      }),

    read: (path, maxBytes) =>
      this.run(async () => {
        assertHostPath(path);
        await this.requireRegularFile(path);
        return this.handles.withFileAccess(
          path,
          undefined,
          (access): FsReadResult => {
            const size = access.getSize();
            if (size > maxBytes) return { tooLarge: true, size };
            const data = new Uint8Array(size);
            let offset = 0;
            while (offset < size) {
              const n = access.read(data.subarray(offset), { at: offset });
              if (n <= 0) break;
              offset += n;
            }
            return { tooLarge: false, data: data.subarray(0, offset) };
          },
        );
      }),

    write: (path, data) =>
      this.run(async () => {
        assertHostPath(path);
        if (path === '') throw new P9Error(EISDIR);
        const existed = Boolean(await this.tryKind(path));
        if (existed) await this.requireRegularFile(path);
        else await this.createFile(path, ROOT_OWNER);
        try {
          await this.handles.withFileAccess(path, undefined, (access) => {
            let offset = 0;
            while (offset < data.length) {
              const n = access.write(data.subarray(offset), { at: offset });
              if (n <= 0) throw new P9Error(EIO);
              offset += n;
            }
            access.truncate(data.length);
            access.flush();
          });
        } catch (error) {
          // Do not leave behind a partial file that this call created.
          if (!existed) {
            await this.unlink(path, false).catch(() => {});
            this.notePath(path);
          }
          throw error;
        }
        this.qids.bump(path);
        this.touchModified(path);
      }),

    createFile: (path) =>
      this.run(async () => {
        assertHostPath(path);
        if (await this.tryKind(path)) throw new P9Error(EEXIST);
        await this.createFile(path, ROOT_OWNER);
      }),

    createDir: (path) =>
      this.run(async () => {
        assertHostPath(path);
        if (await this.tryKind(path)) throw new P9Error(EEXIST);
        await this.makeDir(path, ROOT_OWNER);
      }),

    rename: (from, to) =>
      this.run(async () => {
        assertHostPath(from);
        assertHostPath(to);
        if (from === to) return;
        await this.requireKind(from);
        // Unlike rename(2), an existing destination is an error.
        if (await this.tryKind(to)) throw new P9Error(EEXIST);
        // Fail before renamePath drops the open handles under `from`.
        await this.getDir(parentPath(to));
        await this.renamePath(from, to);
      }),

    remove: (path) =>
      this.run(async () => {
        assertHostPath(path);
        if (path === '') throw new P9Error(EBUSY);
        const kind = await this.requireKind(path);
        this.handles.closeWithin(path, this.fids.values());
        const parent = await this.getDir(parentPath(path));
        await parent.removeEntry(baseName(path), { recursive: kind === 'dir' });
        this.meta.forget(path);
        this.qids.forget(path);
        this.noteDir(parentPath(path));
        this.notePath(path);
      }),
  };

  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      if (this.closed) throw new P9Error(EIO);
      try {
        return await task();
      } finally {
        this.flushChange();
      }
    });
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private async requireRegularFile(path: string): Promise<void> {
    const kind = await this.requireKind(path);
    if (kind === 'dir') throw new P9Error(EISDIR);
    if (kind === 'symlink') throw new P9Error(EINVAL);
  }

  private noteDir(path: string): void {
    this.changedDirs.add(path);
    this.scheduleChange();
  }

  private notePath(path: string): void {
    this.changedPaths.add(path);
    this.scheduleChange();
  }

  private scheduleChange(): void {
    if (!this.onChange || this.closed || this.changeTimer !== undefined) return;
    this.changeTimer = setTimeout(() => this.flushChange(), CHANGE_FLUSH_MS);
  }

  private flushChange(): void {
    if (this.changeTimer === undefined) return;
    clearTimeout(this.changeTimer);
    this.changeTimer = undefined;
    const change: FsChange = {
      dirs: [...this.changedDirs],
      paths: [...this.changedPaths],
    };
    this.changedDirs.clear();
    this.changedPaths.clear();
    this.onChange?.(change);
  }

  private resetSession(): void {
    this.handles.closeAll();
    this.fids.clear();
  }

  private async dispatch(req: Uint8Array): Promise<Uint8Array> {
    const { type, tag } = header(req);
    const r = new Reader(req);
    switch (type) {
      case P9_TVERSION:
        return this.version(r, tag);
      case P9_TATTACH:
        return this.attach(r, tag);
      case P9_TFLUSH:
        r.u16();
        return emptyReply(P9_RFLUSH, tag);
      case P9_TWALK:
        return this.walk(r, tag);
      case P9_TCLUNK:
        return this.clunk(r, tag);
      case P9_TGETATTR:
        return this.getattr(r, tag);
      case P9_TSETATTR:
        return this.setattr(r, tag);
      case P9_TLOPEN:
        return this.lopen(r, tag);
      case P9_TLCREATE:
        return this.lcreate(r, tag);
      case P9_TREAD:
        return this.read(r, tag);
      case P9_TWRITE:
        return this.write(r, tag);
      case P9_TREADDIR:
        return this.readdir(r, tag);
      case P9_TMKDIR:
        return this.mkdir(r, tag);
      case P9_TUNLINKAT:
        return this.unlinkat(r, tag);
      case P9_TRENAMEAT:
        return this.renameat(r, tag);
      case P9_TRENAME:
        return this.rename(r, tag);
      case P9_TSYMLINK:
        return this.symlink(r, tag);
      case P9_TREADLINK:
        return this.readlink(r, tag);
      case P9_TFSYNC:
        return this.fsync(r, tag);
      case P9_TSTATFS:
        return this.statfs(r, tag);
      case P9_TLOCK:
        return this.lock(r, tag);
      case P9_TGETLOCK:
        return this.getlock(r, tag);
      case P9_TREMOVE:
        return this.remove(r, tag);
      case P9_TMKNOD:
        return errorReply(tag, EPERM);
      case P9_TLINK:
      case P9_TAUTH:
      case P9_TXATTRWALK:
      case P9_TXATTRCREATE:
      default:
        return errorReply(tag, EOPNOTSUPP);
    }
  }

  private version(r: Reader, tag: number): Uint8Array {
    const requested = r.u32();
    r.str();
    this.msize = Math.min(P9_MSIZE, Math.max(P9_MIN_MSIZE, requested));
    this.resetSession();
    return new Writer()
      .u32(this.msize)
      .str(P9_VERSION)
      .finish(P9_RVERSION, tag);
  }

  private async attach(r: Reader, tag: number): Promise<Uint8Array> {
    const fid = r.u32();
    r.u32();
    r.str();
    r.str();
    const uid = r.remaining() >= 4 ? r.u32() : 0;
    this.meta.ensureRoot();
    this.fids.set(fid, { path: '', kind: 'dir', uid, opened: false });
    return new Writer().qid(this.qids.of('', 'dir')).finish(P9_RATTACH, tag);
  }

  private async walk(r: Reader, tag: number): Promise<Uint8Array> {
    const fid = r.u32();
    const newfid = r.u32();
    const nwname = r.u16();
    const names: string[] = [];
    for (let i = 0; i < nwname; i++) names.push(r.str());
    const start = this.getFid(fid);
    if (start.opened && nwname > 0) throw new P9Error(EBADF);

    let path = start.path;
    let kind = start.kind;
    const qids: Qid[] = [];
    for (const name of names) {
      assertName(name);
      if (kind !== 'dir' && name !== '.' && name !== '..') break;
      const next = joinPath(path, name);
      const nextKind = await this.tryKind(next);
      if (!nextKind) break;
      path = next;
      kind = nextKind;
      qids.push(this.qids.of(path, kind));
    }

    if (qids.length > 0 || nwname === 0) {
      if (this.fids.has(newfid)) this.releaseFid(newfid);
      this.fids.set(newfid, {
        path: nwname === 0 ? start.path : path,
        kind: nwname === 0 ? start.kind : kind,
        uid: start.uid,
        opened: false,
      });
    }

    const w = new Writer().u16(qids.length);
    for (const qid of qids) w.qid(qid);
    return w.finish(P9_RWALK, tag);
  }

  private clunk(r: Reader, tag: number): Uint8Array {
    this.releaseFid(r.u32());
    return emptyReply(P9_RCLUNK, tag);
  }

  private async getattr(r: Reader, tag: number): Promise<Uint8Array> {
    const fid = this.getFid(r.u32());
    const requestMask = r.u64();
    const stat = await this.stat(fid.path, fid.kind);
    const qid = this.qids.of(fid.path, fid.kind);
    const valid =
      requestMask === 0n ? P9_STATS_BASIC : requestMask & P9_STATS_BASIC;
    return new Writer()
      .u64(valid)
      .qid(qid)
      .u32(stat.mode)
      .u32(stat.uid)
      .u32(stat.gid)
      .u64(stat.nlink)
      .u64(0) // rdev
      .u64(stat.size)
      .u64(BLOCK_SIZE)
      .u64(stat.blocks)
      .u64(stat.atimeSec)
      .u64(stat.atimeNsec)
      .u64(stat.mtimeSec)
      .u64(stat.mtimeNsec)
      .u64(stat.ctimeSec)
      .u64(stat.ctimeNsec)
      .u64(0) // btime sec
      .u64(0) // btime nsec
      .u64(0) // gen
      .u64(0) // data_version
      .finish(P9_RGETATTR, tag);
  }

  private async setattr(r: Reader, tag: number): Promise<Uint8Array> {
    const fid = this.getFid(r.u32());
    const valid = r.u32();
    const mode = r.u32();
    const uid = r.u32();
    const gid = r.u32();
    const size = r.u64();
    const atimeSec = r.u64();
    const atimeNsec = r.u64();
    const mtimeSec = r.u64();
    const mtimeNsec = r.u64();
    const meta = this.meta.of(fid.path, fid.kind);
    const times = nowTimes();
    if (valid & P9_SETATTR_MODE) {
      if (fid.kind === 'symlink') meta.mode = SYMLINK_MODE;
      else meta.mode = typeMode(fid.kind) | (mode & S_IRWXUGO);
    }
    if (valid & P9_SETATTR_UID) meta.uid = uid;
    if (valid & P9_SETATTR_GID) meta.gid = gid;
    if (valid & P9_SETATTR_ATIME) {
      meta.atimeSec = times.atimeSec;
      meta.atimeNsec = times.atimeNsec;
    }
    if (valid & P9_SETATTR_MTIME) {
      meta.mtimeSec = times.mtimeSec;
      meta.mtimeNsec = times.mtimeNsec;
    }
    if (valid & P9_SETATTR_ATIME_SET) {
      meta.atimeSec = asSafeNumber(atimeSec);
      meta.atimeNsec = asSafeNumber(atimeNsec);
    }
    if (valid & P9_SETATTR_MTIME_SET) {
      meta.mtimeSec = asSafeNumber(mtimeSec);
      meta.mtimeNsec = asSafeNumber(mtimeNsec);
    }
    if (valid !== 0) {
      meta.ctimeSec = times.ctimeSec;
      meta.ctimeNsec = times.ctimeNsec;
    }
    if (valid & P9_SETATTR_SIZE) {
      if (fid.kind === 'dir') throw new P9Error(EISDIR);
      if (fid.kind === 'symlink') throw new P9Error(EINVAL);
      await this.handles.withFileAccess(fid.path, fid.handle, (access) => {
        access.truncate(asSafeNumber(size));
      });
      this.qids.bump(fid.path);
      this.notePath(fid.path);
    }
    this.meta.set(fid.path, meta);
    return emptyReply(P9_RSETATTR, tag);
  }

  private async lopen(r: Reader, tag: number): Promise<Uint8Array> {
    const fid = this.getFid(r.u32());
    const flags = r.u32();
    if (fid.kind === 'symlink' && flags & O_NOFOLLOW) throw new P9Error(ELOOP);
    if (fid.kind === 'dir' && (flags & O_ACCMODE) !== O_RDONLY) {
      throw new P9Error(EISDIR);
    }
    if (fid.kind !== 'dir' && flags & O_DIRECTORY) throw new P9Error(ENOTDIR);
    if (fid.kind === 'file') {
      if (flags & O_TRUNC && (flags & O_ACCMODE) === O_RDONLY) {
        throw new P9Error(EACCES);
      }
      if (!fid.handle) fid.handle = await this.handles.acquire(fid.path);
      if (flags & O_TRUNC) {
        fid.handle.access.truncate(0);
        this.qids.bump(fid.path);
        this.notePath(fid.path);
        this.meta.set(fid.path, {
          ...this.meta.of(fid.path, 'file'),
          ...nowTimes(),
        });
      }
    }
    fid.opened = true;
    fid.dirSnapshot = undefined;
    return new Writer()
      .qid(this.qids.of(fid.path, fid.kind))
      .u32(P9_IOUNIT)
      .finish(P9_RLOPEN, tag);
  }

  private async lcreate(r: Reader, tag: number): Promise<Uint8Array> {
    const fid = this.getFid(r.u32());
    const name = r.str();
    r.u32();
    const mode = r.u32();
    const gid = r.u32();
    if (fid.kind !== 'dir') throw new P9Error(ENOTDIR);
    assertName(name);
    const path = joinPath(fid.path, name);
    if (await this.tryKind(path)) throw new P9Error(EEXIST);
    await this.createFile(path, {
      mode: S_IFREG | (mode & S_IRWXUGO),
      uid: fid.uid,
      gid,
    });
    fid.path = path;
    fid.kind = 'file';
    fid.opened = true;
    fid.dirSnapshot = undefined;
    fid.handle = await this.handles.acquire(path);
    return new Writer()
      .qid(this.qids.of(path, 'file'))
      .u32(P9_IOUNIT)
      .finish(P9_RLCREATE, tag);
  }

  private async read(r: Reader, tag: number): Promise<Uint8Array> {
    const fid = this.getFid(r.u32());
    const offset = asSafeNumber(r.u64());
    const count = r.u32();
    if (fid.kind === 'dir')
      return this.readDirBytes(fid, offset, count, tag, P9_RREAD);
    if (fid.kind === 'symlink') throw new P9Error(EINVAL);
    const handle = this.fileHandleOf(fid);
    const size = handle.access.getSize();
    const start = Math.min(offset, size);
    const length = Math.max(
      0,
      Math.min(count, size - start, this.msize - P9_RREAD_OVERHEAD),
    );
    const data = new Uint8Array(length);
    if (length > 0) handle.access.read(data, { at: start });
    return new Writer().u32(length).bytes(data).finish(P9_RREAD, tag);
  }

  private async write(r: Reader, tag: number): Promise<Uint8Array> {
    const fid = this.getFid(r.u32());
    const offset = asSafeNumber(r.u64());
    const count = r.u32();
    const data = r.bytes(count).slice();
    if (fid.kind !== 'file')
      throw new P9Error(fid.kind === 'dir' ? EISDIR : EINVAL);
    const handle = this.fileHandleOf(fid);
    const written = handle.access.write(data, { at: offset });
    this.qids.bump(fid.path);
    this.notePath(fid.path);
    this.touchModified(fid.path);
    return new Writer().u32(written).finish(P9_RWRITE, tag);
  }

  private async readdir(r: Reader, tag: number): Promise<Uint8Array> {
    const fid = this.getFid(r.u32());
    const offset = asSafeNumber(r.u64());
    const count = r.u32();
    return this.readDirBytes(fid, offset, count, tag, P9_RREADDIR);
  }

  private async mkdir(r: Reader, tag: number): Promise<Uint8Array> {
    const fid = this.getFid(r.u32());
    const name = r.str();
    const mode = r.u32();
    const gid = r.u32();
    if (fid.kind !== 'dir') throw new P9Error(ENOTDIR);
    assertName(name);
    const path = joinPath(fid.path, name);
    if (await this.tryKind(path)) throw new P9Error(EEXIST);
    await this.makeDir(path, {
      mode: S_IFDIR | (mode & S_IRWXUGO),
      uid: fid.uid,
      gid,
    });
    return new Writer().qid(this.qids.of(path, 'dir')).finish(P9_RMKDIR, tag);
  }

  private async unlinkat(r: Reader, tag: number): Promise<Uint8Array> {
    const fid = this.getFid(r.u32());
    const name = r.str();
    const flags = r.u32();
    if (fid.kind !== 'dir') throw new P9Error(ENOTDIR);
    assertName(name);
    await this.unlink(joinPath(fid.path, name), (flags & AT_REMOVEDIR) !== 0);
    return emptyReply(P9_RUNLINKAT, tag);
  }

  private async renameat(r: Reader, tag: number): Promise<Uint8Array> {
    const oldDir = this.getFid(r.u32());
    const oldName = r.str();
    const newDir = this.getFid(r.u32());
    const newName = r.str();
    if (oldDir.kind !== 'dir' || newDir.kind !== 'dir')
      throw new P9Error(ENOTDIR);
    assertName(oldName);
    assertName(newName);
    await this.renamePath(
      joinPath(oldDir.path, oldName),
      joinPath(newDir.path, newName),
    );
    return emptyReply(P9_RRENAMEAT, tag);
  }

  private async rename(r: Reader, tag: number): Promise<Uint8Array> {
    const fid = this.getFid(r.u32());
    const newDir = this.getFid(r.u32());
    const newName = r.str();
    if (fid.path === '') throw new P9Error(EBUSY);
    if (newDir.kind !== 'dir') throw new P9Error(ENOTDIR);
    assertName(newName);
    const next = joinPath(newDir.path, newName);
    await this.renamePath(fid.path, next);
    fid.path = next;
    return emptyReply(P9_RRENAME, tag);
  }

  private async symlink(r: Reader, tag: number): Promise<Uint8Array> {
    const fid = this.getFid(r.u32());
    const name = r.str();
    const target = r.str();
    const gid = r.u32();
    if (fid.kind !== 'dir') throw new P9Error(ENOTDIR);
    assertName(name);
    const path = joinPath(fid.path, name);
    if (await this.tryKind(path)) throw new P9Error(EEXIST);
    await this.createFile(path, {
      uid: fid.uid,
      gid,
      symlink: target,
    });
    return new Writer()
      .qid(this.qids.of(path, 'symlink'))
      .finish(P9_RSYMLINK, tag);
  }

  private readlink(r: Reader, tag: number): Uint8Array {
    const fid = this.getFid(r.u32());
    if (fid.kind !== 'symlink') throw new P9Error(EINVAL);
    const target = this.meta.of(fid.path, 'symlink').symlink;
    if (typeof target !== 'string') throw new P9Error(EINVAL);
    return new Writer().str(target).finish(P9_RREADLINK, tag);
  }

  private async fsync(r: Reader, tag: number): Promise<Uint8Array> {
    const fid = this.getFid(r.u32());
    // 9P2000.L datasync is a 32-bit flag. Reading 8 bytes runs past the
    // message and makes every fsync fail, which vim reports on write.
    r.u32();
    if (fid.kind === 'file' && fid.handle) {
      fid.handle.access.flush();
    }
    await this.meta.flush();
    return emptyReply(P9_RFSYNC, tag);
  }

  private async statfs(r: Reader, tag: number): Promise<Uint8Array> {
    this.getFid(r.u32());
    const estimate = (await navigator.storage?.estimate?.()) ?? {};
    const quota = estimate.quota ?? STATFS_FALLBACK_QUOTA;
    const usage = estimate.usage ?? 0;
    const blocks = Math.max(1, Math.floor(quota / BLOCK_SIZE));
    const bfree = Math.max(0, Math.floor((quota - usage) / BLOCK_SIZE));
    return new Writer()
      .u32(V9FS_MAGIC)
      .u32(BLOCK_SIZE)
      .u64(blocks)
      .u64(bfree)
      .u64(bfree) // bavail
      .u64(STATFS_FILE_COUNT) // files
      .u64(STATFS_FILE_COUNT) // ffree
      .u64(0) // fsid
      .u32(NAME_MAX)
      .finish(P9_RSTATFS, tag);
  }

  private lock(r: Reader, tag: number): Uint8Array {
    this.getFid(r.u32());
    r.u8();
    r.u32();
    r.u64();
    r.u64();
    r.u32();
    r.str();
    return new Writer().u8(P9_LOCK_SUCCESS).finish(P9_RLOCK, tag);
  }

  private getlock(r: Reader, tag: number): Uint8Array {
    this.getFid(r.u32());
    r.u8();
    const start = r.u64();
    const length = r.u64();
    const procId = r.u32();
    const clientId = r.str();
    return new Writer()
      .u8(P9_LOCK_TYPE_UNLCK)
      .u64(start)
      .u64(length)
      .u32(procId)
      .str(clientId)
      .finish(P9_RGETLOCK, tag);
  }

  private async remove(r: Reader, tag: number): Promise<Uint8Array> {
    const id = r.u32();
    const fid = this.getFid(id);
    if (fid.path === '') throw new P9Error(EBUSY);
    await this.unlink(fid.path, fid.kind === 'dir');
    this.releaseFid(id);
    return emptyReply(P9_RREMOVE, tag);
  }

  private async readDirBytes(
    fid: Fid,
    offset: number,
    count: number,
    tag: number,
    replyType: number,
  ): Promise<Uint8Array> {
    if (fid.kind !== 'dir') throw new P9Error(ENOTDIR);
    if (offset === 0 || !fid.dirSnapshot) {
      fid.dirSnapshot = await this.packDir(fid.path);
    }
    const snapshot = fid.dirSnapshot;
    if (offset >= snapshot.length || count <= 0) {
      return new Writer().u32(0).finish(replyType, tag);
    }
    const end = roundDirents(
      snapshot,
      offset,
      Math.min(snapshot.length, offset + count),
    );
    const data = snapshot.subarray(offset, end);
    return new Writer().u32(data.length).bytes(data).finish(replyType, tag);
  }

  private async packDir(path: string): Promise<Uint8Array> {
    const entries: Array<{ name: string; kind: NodeKind; path: string }> = [
      { name: '.', kind: 'dir', path },
      { name: '..', kind: 'dir', path: parentPath(path) },
    ];
    const dir = await this.getDir(path);
    for await (const [name] of listed(dir).entries()) {
      const child = joinPath(path, name);
      const kind = (await this.tryKind(child)) ?? 'file';
      entries.push({ name, kind, path: child });
    }
    const out = new Writer();
    let offset = 0;
    for (const entry of entries) {
      const name = encoder.encode(entry.name);
      offset += P9_DIRENT_FIXED_SIZE + name.length;
      out.bytes(
        encodeDirent(
          this.qids.of(entry.path, entry.kind),
          offset,
          direntType(entry.kind),
          name,
        ),
      );
    }
    return out.payload();
  }

  private async createFile(
    path: string,
    extra: Partial<MetaEntry>,
  ): Promise<void> {
    const parent = await this.getDir(parentPath(path));
    const file = await parent.getFileHandle(baseName(path), { create: true });
    const access = await file.createSyncAccessHandle();
    access.truncate(0);
    access.flush();
    access.close();
    const kind: NodeKind =
      typeof extra.symlink === 'string' ? 'symlink' : 'file';
    this.meta.set(path, defaultMeta(kind, extra));
    this.qids.of(path, kind);
    this.noteDir(parentPath(path));
    this.notePath(path);
  }

  private async makeDir(
    path: string,
    extra: Partial<MetaEntry>,
  ): Promise<void> {
    const parent = await this.getDir(parentPath(path));
    await parent.getDirectoryHandle(baseName(path), { create: true });
    this.meta.set(path, defaultMeta('dir', extra));
    this.noteDir(parentPath(path));
  }

  /** Stamps a file whose content just changed. */
  private touchModified(path: string): void {
    const times = nowTimes();
    this.meta.set(path, {
      ...this.meta.of(path, 'file'),
      mtimeSec: times.mtimeSec,
      mtimeNsec: times.mtimeNsec,
      ctimeSec: times.ctimeSec,
      ctimeNsec: times.ctimeNsec,
    });
  }

  private async unlink(path: string, directory: boolean): Promise<void> {
    if (path === '') throw new P9Error(EBUSY);
    const name = baseName(path);
    if (name === '.' || name === '..') throw new P9Error(EINVAL);
    const kind = await this.requireKind(path);
    if (directory && kind !== 'dir') throw new P9Error(ENOTDIR);
    if (!directory && kind === 'dir') throw new P9Error(EISDIR);
    if (kind === 'dir' && !(await isDirEmpty(await this.getDir(path))))
      throw new P9Error(ENOTEMPTY);
    this.handles.closeWithin(path, this.fids.values());
    const parent = await this.getDir(parentPath(path));
    try {
      await parent.removeEntry(name, { recursive: false });
    } catch (error) {
      if (isDomError(error, 'InvalidModificationError'))
        throw new P9Error(ENOTEMPTY);
      throw error;
    }
    this.meta.forget(path);
    this.qids.forget(path);
    this.noteDir(parentPath(path));
    this.notePath(path);
  }

  private async renamePath(from: string, to: string): Promise<void> {
    if (from === '' || to === '') throw new P9Error(EBUSY);
    if (from === to) return;
    if (isPathWithin(from, to)) throw new P9Error(EINVAL);
    const kind = await this.requireKind(from);
    const destKind = await this.tryKind(to);
    if (destKind) {
      if (destKind === 'dir') {
        if (kind !== 'dir') throw new P9Error(EISDIR);
        if (!(await isDirEmpty(await this.getDir(to))))
          throw new P9Error(ENOTEMPTY);
      } else if (kind === 'dir') {
        throw new P9Error(ENOTDIR);
      }
      await this.unlink(to, destKind === 'dir');
    }
    // Sync access handles are exclusive per path; drop them across the rename
    // and reacquire afterward for still-open fids.
    this.handles.closeWithin(from, this.fids.values());
    const destParent = await this.getDir(parentPath(to));
    const destName = baseName(to);
    const source = await this.getHandle(from, kind);
    if (canMove(source)) {
      await source.move(destParent, destName);
    } else if (kind === 'dir') {
      await copyDir(await this.getDir(from), destParent, destName);
      await this.removeTree(from);
    } else {
      await copyFile(await this.getFile(from), destParent, destName);
      await this.unlink(from, false);
    }
    this.remapPath(from, to);
    this.noteDir(parentPath(from));
    this.noteDir(parentPath(to));
    this.notePath(from);
    this.notePath(to);
    await this.handles.reacquire(to, this.openFileFids());
  }

  private remapPath(from: string, to: string): void {
    this.meta.remap(from, to);
    this.qids.remap(from, to);
    this.handles.remap(from, to);
    for (const fid of this.fids.values()) {
      if (isPathWithin(from, fid.path))
        fid.path = rebasePath(fid.path, from, to);
    }
  }

  private openFileFids(): Fid[] {
    return [...this.fids.values()].filter(
      (fid) => fid.kind === 'file' && fid.opened,
    );
  }

  private async removeTree(path: string): Promise<void> {
    if (path === '') throw new P9Error(EBUSY);
    const parent = await this.getDir(parentPath(path));
    await parent.removeEntry(baseName(path), { recursive: true });
  }

  private async getDir(path: string): Promise<FileSystemDirectoryHandle> {
    if (path === '') return this.playground;
    let dir = this.playground;
    for (const part of path.split('/')) {
      dir = await dir.getDirectoryHandle(part);
    }
    return dir;
  }

  private async getFile(path: string): Promise<FileSystemFileHandle> {
    const dir = await this.getDir(parentPath(path));
    return dir.getFileHandle(baseName(path));
  }

  private async getHandle(
    path: string,
    kind: NodeKind,
  ): Promise<FileSystemFileHandle | FileSystemDirectoryHandle> {
    if (kind === 'dir') return this.getDir(path);
    return this.getFile(path);
  }

  private async tryKind(path: string): Promise<NodeKind | null> {
    if (path === '') return 'dir';
    if (typeof this.meta.get(path)?.symlink === 'string') {
      try {
        await this.getFile(path);
        return 'symlink';
      } catch {
        return null;
      }
    }
    try {
      const parent = await this.getDir(parentPath(path));
      const name = baseName(path);
      try {
        await parent.getDirectoryHandle(name);
        return 'dir';
      } catch (error) {
        if (!isDomError(error, 'TypeMismatchError')) throw error;
      }
      await parent.getFileHandle(name);
      return 'file';
    } catch (error) {
      if (isDomError(error, 'NotFoundError')) return null;
      throw error;
    }
  }

  private async requireKind(path: string): Promise<NodeKind> {
    const kind = await this.tryKind(path);
    if (!kind) throw new P9Error(ENOENT);
    return kind;
  }

  private fileHandleOf(fid: Fid): OpenHandle {
    if (!fid.handle) throw new P9Error(fid.opened ? ENOENT : EBADF);
    return fid.handle;
  }

  private async stat(
    path: string,
    kind: NodeKind,
  ): Promise<MetaEntry & { size: number; blocks: number; nlink: number }> {
    const meta = this.meta.of(path, kind);
    let size = 0;
    if (kind === 'symlink') {
      size = encoder.encode(meta.symlink ?? '').length;
    } else if (kind === 'file') {
      const open = this.handles.get(path);
      size = open
        ? open.access.getSize()
        : (await (await this.getFile(path)).getFile()).size;
    }
    return {
      ...meta,
      mode: kind === 'symlink' ? SYMLINK_MODE : meta.mode,
      size,
      blocks: Math.floor(size / ST_BLOCK_UNIT) + 1,
      nlink: kind === 'dir' ? 2 : 1,
    };
  }

  private getFid(id: number): Fid {
    const fid = this.fids.get(id);
    if (!fid) throw new P9Error(EBADF);
    return fid;
  }

  private releaseFid(id: number): void {
    const fid = this.fids.get(id);
    if (!fid) return;
    this.fids.delete(id);
    if (fid.handle) {
      this.handles.release(fid.path, fid.handle);
      fid.handle = undefined;
    }
  }
}
