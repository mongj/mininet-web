import {
  EINVAL,
  EIO,
  P9_DIRENT_FIXED_SIZE,
  P9_HEADER_SIZE,
  P9_QID_SIZE,
  P9_RLERROR,
} from './constants';
import { P9Error } from './errors';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface Qid {
  type: number;
  version: number;
  path: bigint;
}

export function asSafeNumber(value: bigint, errno = EINVAL): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new P9Error(errno);
  return Number(value);
}

/** Reads a message body; starts right after the 9P header by default. */
export class Reader {
  private readonly view: DataView;

  constructor(
    private readonly buf: Uint8Array,
    private offset = P9_HEADER_SIZE,
  ) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  remaining(): number {
    return this.buf.length - this.offset;
  }

  u8(): number {
    if (this.offset + 1 > this.buf.length) throw new P9Error(EIO);
    return this.buf[this.offset++];
  }

  u16(): number {
    if (this.offset + 2 > this.buf.length) throw new P9Error(EIO);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  u32(): number {
    if (this.offset + 4 > this.buf.length) throw new P9Error(EIO);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  u64(): bigint {
    if (this.offset + 8 > this.buf.length) throw new P9Error(EIO);
    const value = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return value;
  }

  str(): string {
    const length = this.u16();
    if (this.offset + length > this.buf.length) throw new P9Error(EIO);
    const text = decoder.decode(
      this.buf.subarray(this.offset, this.offset + length),
    );
    this.offset += length;
    return text;
  }

  bytes(length: number): Uint8Array {
    if (length < 0 || this.offset + length > this.buf.length)
      throw new P9Error(EIO);
    const slice = this.buf.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }
}

export class Writer {
  private readonly parts: Uint8Array[] = [];
  private length = 0;

  u8(value: number): this {
    return this.bytes(Uint8Array.of(value & 0xff));
  }

  u16(value: number): this {
    const buf = new Uint8Array(2);
    new DataView(buf.buffer).setUint16(0, value, true);
    return this.bytes(buf);
  }

  u32(value: number): this {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, value, true);
    return this.bytes(buf);
  }

  u64(value: bigint | number): this {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setBigUint64(0, BigInt(value), true);
    return this.bytes(buf);
  }

  str(value: string): this {
    const bytes = encoder.encode(value);
    return this.u16(bytes.length).bytes(bytes);
  }

  qid(qid: Qid): this {
    return this.u8(qid.type).u32(qid.version).u64(qid.path);
  }

  bytes(value: Uint8Array): this {
    this.parts.push(value);
    this.length += value.byteLength;
    return this;
  }

  /** The bytes written so far, without a 9P header. */
  payload(): Uint8Array {
    return this.concatInto(new Uint8Array(this.length), 0);
  }

  finish(type: number, tag: number): Uint8Array {
    const out = new Uint8Array(P9_HEADER_SIZE + this.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, out.length, true);
    out[4] = type;
    view.setUint16(5, tag, true);
    return this.concatInto(out, P9_HEADER_SIZE);
  }

  private concatInto(out: Uint8Array, start: number): Uint8Array {
    let offset = start;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.byteLength;
    }
    return out;
  }
}

export function header(req: Uint8Array): { type: number; tag: number } {
  if (req.length < P9_HEADER_SIZE) throw new P9Error(EIO);
  const view = new DataView(req.buffer, req.byteOffset, req.byteLength);
  return { type: req[4], tag: view.getUint16(5, true) };
}

export function errorReply(tag: number, errno: number): Uint8Array {
  return new Writer().u32(errno).finish(P9_RLERROR, tag);
}

export function emptyReply(type: number, tag: number): Uint8Array {
  return new Writer().finish(type, tag);
}

/** `next` is the readdir offset of the entry after this one. */
export function encodeDirent(
  qid: Qid,
  next: number,
  type: number,
  name: Uint8Array,
): Uint8Array {
  return new Writer()
    .qid(qid)
    .u64(next)
    .u8(type)
    .u16(name.length)
    .bytes(name)
    .payload();
}

/** Largest dirent boundary in `[start, end]` reachable from `start`. */
export function roundDirents(
  data: Uint8Array,
  start: number,
  end: number,
): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = start;
  while (offset < end) {
    if (offset + P9_DIRENT_FIXED_SIZE > data.length) break;
    const next = Number(view.getBigUint64(offset + P9_QID_SIZE, true));
    if (next <= offset || next > data.length || next > end) break;
    offset = next;
  }
  return offset;
}
