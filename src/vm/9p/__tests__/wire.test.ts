import { describe, expect, it } from 'vitest';
import { EIO, P9_DIRENT_FIXED_SIZE, P9_HEADER_SIZE } from '../constants';
import { P9Error } from '../errors';
import { encodeDirent, header, Reader, roundDirents, Writer } from '../wire';

const encoder = new TextEncoder();

function expectEio(fn: () => unknown): void {
  expect(fn).toThrow(P9Error);
  expect(fn).toThrow(expect.objectContaining({ errno: EIO }));
}

describe('Writer/Reader', () => {
  it('round-trips integers and multibyte strings inside a framed message', () => {
    const name = 'héllo/世界 🙂';
    const msg = new Writer()
      .u8(0xab)
      .u16(0xbeef)
      .u32(0xdeadbeef)
      .u64(0xffff_ffff_ffff_ffffn)
      .str(name)
      .finish(110, 0x1234);

    const view = new DataView(msg.buffer);
    expect(view.getUint32(0, true)).toBe(msg.length);
    expect(header(msg)).toEqual({ type: 110, tag: 0x1234 });

    const r = new Reader(msg);
    expect(r.u8()).toBe(0xab);
    expect(r.u16()).toBe(0xbeef);
    expect(r.u32()).toBe(0xdeadbeef);
    expect(r.u64()).toBe(0xffff_ffff_ffff_ffffn);
    expect(r.str()).toBe(name);
    expect(r.remaining()).toBe(0);
    // The length prefix counts UTF-8 bytes, not UTF-16 code units.
    expect(msg.length).toBe(
      P9_HEADER_SIZE + 1 + 2 + 4 + 8 + 2 + encoder.encode(name).length,
    );
  });

  it('throws EIO instead of reading past the end of the message', () => {
    const empty = new Writer().finish(100, 1);
    expectEio(() => new Reader(empty).u8());
    expectEio(() => new Reader(new Writer().u8(1).finish(100, 1)).u16());
    expectEio(() => new Reader(new Writer().u16(1).finish(100, 1)).u32());
    expectEio(() => new Reader(new Writer().u32(1).finish(100, 1)).u64());
    expectEio(() => new Reader(empty).bytes(1));
    // Declared string length exceeds the bytes actually present.
    const truncated = new Writer().u16(10).bytes(Uint8Array.of(0x61, 0x62));
    expectEio(() => new Reader(truncated.finish(100, 1)).str());
    expectEio(() => header(new Uint8Array(P9_HEADER_SIZE - 1)));
  });
});

describe('roundDirents', () => {
  it('never splits a dirent across the count boundary', () => {
    const names = ['.', '..', 'a-longer-file-name', 'ü'];
    const boundaries = [0];
    const w = new Writer();
    for (const [i, name] of names.entries()) {
      const bytes = encoder.encode(name);
      const next = boundaries[i] + P9_DIRENT_FIXED_SIZE + bytes.length;
      boundaries.push(next);
      w.bytes(encodeDirent({ type: 0, version: 0, path: 1n }, next, 8, bytes));
    }
    const data = w.payload();
    expect(data.length).toBe(boundaries.at(-1));

    for (const start of boundaries) {
      for (let end = start; end <= data.length; end++) {
        const cut = roundDirents(data, start, end);
        const expected = Math.max(...boundaries.filter((b) => b <= end));
        expect(cut, `start=${start} end=${end}`).toBe(expected);
      }
    }
  });
});
