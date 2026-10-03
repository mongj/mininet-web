import {
  P9_MSIZE,
  P9_RLERROR,
  P9_STATS_BASIC,
  P9_TATTACH,
  P9_TCLUNK,
  P9_TFSYNC,
  P9_TGETATTR,
  P9_TLCREATE,
  P9_TLOPEN,
  P9_TMKDIR,
  P9_TREAD,
  P9_TREADDIR,
  P9_TREADLINK,
  P9_TRENAMEAT,
  P9_TSETATTR,
  P9_TSYMLINK,
  P9_TUNLINKAT,
  P9_TVERSION,
  P9_TWALK,
  P9_TWRITE,
  P9_VERSION,
} from '../constants';
import { P9Error } from '../errors';
import { Opfs9pServer } from '../server';
import { header, Reader, Writer } from '../wire';
import { asOpfsRoot, type FakeDirectory } from './fake-opfs';

export const O_RDONLY = 0;
export const O_RDWR = 2;
export const ROOT_FID = 0;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function text(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/**
 * Speaks 9P2000.L to an `Opfs9pServer` through `handle()`. Rlerror replies
 * reject with a `P9Error` carrying the errno.
 */
export class TestClient {
  private nextTag = 1;

  private constructor(readonly server: Opfs9pServer) {}

  /** Opens a server on `root` and attaches `ROOT_FID` to the playground. */
  static async connect(root: FakeDirectory): Promise<TestClient> {
    return TestClient.attach(await Opfs9pServer.open(asOpfsRoot(root)));
  }

  /** Negotiates a session on `server` and attaches `ROOT_FID` to the playground. */
  static async attach(server: Opfs9pServer): Promise<TestClient> {
    const client = new TestClient(server);
    await client.rpc(P9_TVERSION, new Writer().u32(P9_MSIZE).str(P9_VERSION));
    await client.rpc(
      P9_TATTACH,
      new Writer().u32(ROOT_FID).u32(0xffffffff).str('root').str('').u32(0),
    );
    return client;
  }

  async rpc(type: number, body: Writer): Promise<Reader> {
    const tag = this.nextTag++;
    const res = await new Promise<Uint8Array>((resolve) => {
      this.server.handle(body.finish(type, tag), resolve);
    });
    const reply = header(res);
    if (reply.tag !== tag) throw new Error(`tag ${reply.tag} != ${tag}`);
    const r = new Reader(res);
    if (reply.type === P9_RLERROR) throw new P9Error(r.u32());
    if (reply.type !== type + 1)
      throw new Error(`reply type ${reply.type} for T${type}`);
    return r;
  }

  /** Number of qids returned (a full walk returns `names.length`). */
  async walk(fid: number, newfid: number, names: string[]): Promise<number> {
    const w = new Writer().u32(fid).u32(newfid).u16(names.length);
    for (const name of names) w.str(name);
    return (await this.rpc(P9_TWALK, w)).u16();
  }

  async lopen(fid: number, flags: number): Promise<void> {
    await this.rpc(P9_TLOPEN, new Writer().u32(fid).u32(flags));
  }

  /** Turns directory `fid` into an open fid on the new file. */
  async lcreate(fid: number, name: string, mode = 0o644): Promise<void> {
    await this.rpc(
      P9_TLCREATE,
      new Writer().u32(fid).str(name).u32(O_RDWR).u32(mode).u32(0),
    );
  }

  async mkdir(dfid: number, name: string, mode = 0o755): Promise<void> {
    await this.rpc(
      P9_TMKDIR,
      new Writer().u32(dfid).str(name).u32(mode).u32(0),
    );
  }

  async symlink(dfid: number, name: string, target: string): Promise<void> {
    await this.rpc(
      P9_TSYMLINK,
      new Writer().u32(dfid).str(name).str(target).u32(0),
    );
  }

  async readlink(fid: number): Promise<string> {
    return (await this.rpc(P9_TREADLINK, new Writer().u32(fid))).str();
  }

  async read(fid: number, offset: number, count = 4096): Promise<Uint8Array> {
    const r = await this.rpc(
      P9_TREAD,
      new Writer().u32(fid).u64(offset).u32(count),
    );
    return r.bytes(r.u32()).slice();
  }

  async write(fid: number, offset: number, data: string): Promise<number> {
    const bytes = encoder.encode(data);
    const r = await this.rpc(
      P9_TWRITE,
      new Writer().u32(fid).u64(offset).u32(bytes.length).bytes(bytes),
    );
    return r.u32();
  }

  async readdir(fid: number, offset = 0, count = 4096): Promise<string[]> {
    const r = await this.rpc(
      P9_TREADDIR,
      new Writer().u32(fid).u64(offset).u32(count),
    );
    const data = new Reader(r.bytes(r.u32()), 0);
    const names: string[] = [];
    while (data.remaining() > 0) {
      data.bytes(13 + 8 + 1); // qid, offset, type
      names.push(data.str());
    }
    return names;
  }

  async getattr(
    fid: number,
    mask = P9_STATS_BASIC,
  ): Promise<{ valid: bigint; mode: number; size: bigint }> {
    const r = await this.rpc(P9_TGETATTR, new Writer().u32(fid).u64(mask));
    const valid = r.u64();
    r.bytes(13); // qid
    const mode = r.u32();
    r.u32(); // uid
    r.u32(); // gid
    r.u64(); // nlink
    r.u64(); // rdev
    return { valid, mode, size: r.u64() };
  }

  async setattr(fid: number, valid: number, mode: number): Promise<void> {
    const w = new Writer().u32(fid).u32(valid).u32(mode).u32(0).u32(0);
    for (let i = 0; i < 5; i++) w.u64(0); // size, atime, mtime
    await this.rpc(P9_TSETATTR, w);
  }

  async renameat(
    olddir: number,
    oldname: string,
    newdir: number,
    newname: string,
  ): Promise<void> {
    await this.rpc(
      P9_TRENAMEAT,
      new Writer().u32(olddir).str(oldname).u32(newdir).str(newname),
    );
  }

  async unlinkat(dfid: number, name: string, flags = 0): Promise<void> {
    await this.rpc(P9_TUNLINKAT, new Writer().u32(dfid).str(name).u32(flags));
  }

  async fsync(fid: number, datasync: number): Promise<void> {
    await this.rpc(P9_TFSYNC, new Writer().u32(fid).u32(datasync));
  }

  async clunk(fid: number): Promise<void> {
    await this.rpc(P9_TCLUNK, new Writer().u32(fid));
  }

  /** Walks `path` from the root into `fid`, failing unless every element resolves. */
  async open(fid: number, path: string[], flags = O_RDWR): Promise<void> {
    const walked = await this.walk(ROOT_FID, fid, path);
    if (walked !== path.length)
      throw new Error(`walk ${path.join('/')} stopped at ${walked}`);
    await this.lopen(fid, flags);
  }
}
