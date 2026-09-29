import { qidType, type NodeKind } from './node-kind';
import { deleteWithin, remapWithin } from './paths';
import type { Qid } from './wire';

/** Stable qid paths per filesystem path; versions bump on content changes. */
export class QidTable {
  private readonly byPath = new Map<
    string,
    { path: bigint; version: number }
  >();
  private next = 1n;

  of(path: string, kind: NodeKind): Qid {
    let entry = this.byPath.get(path);
    if (!entry) {
      entry = { path: this.next++, version: 0 };
      this.byPath.set(path, entry);
    }
    return { type: qidType(kind), version: entry.version, path: entry.path };
  }

  bump(path: string): void {
    const entry = this.byPath.get(path);
    if (entry) entry.version += 1;
  }

  forget(root: string): void {
    deleteWithin(this.byPath, root);
  }

  remap(from: string, to: string): void {
    remapWithin(this.byPath, from, to);
  }
}
