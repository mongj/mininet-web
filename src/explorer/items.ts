import { joinPath } from '@/lib/paths';
import type { FsEntry, FsEntryKind } from '@/vm/fs-protocol';

export interface ExplorerItem {
  path: string;
  name: string;
  kind: FsEntryKind;
  target?: string;
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

/** True for a real directory entry or file the tree should show. */
export function isVisibleEntry(entry: FsEntry): boolean {
  return !entry.name.startsWith('.');
}

/** Tree rows for one directory listing. Dotfiles never become items. */
export function toItems(dir: string, entries: FsEntry[]): ExplorerItem[] {
  return entries
    .filter(isVisibleEntry)
    .map((entry) => ({ ...entry, path: joinPath(dir, entry.name) }))
    .sort(
      (a, b) =>
        Number(b.kind === 'dir') - Number(a.kind === 'dir') ||
        collator.compare(a.name, b.name) ||
        (a.name < b.name ? -1 : 1),
    );
}
