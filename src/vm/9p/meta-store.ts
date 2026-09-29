import { OPFS_META_FILE, OPFS_META_TEMP_FILE } from '../opfs-storage';
import { S_IFLNK, S_IFMT, S_IFREG, S_IRWXUGO } from './constants';
import { ignoreNotFound, isDomError } from './errors';
import { typeMode, type NodeKind } from './node-kind';
import { canMove, collectKinds, copyFile } from './opfs';
import { deleteWithin, remapWithin } from './paths';

const META_FLUSH_MS = 250;

export const SYMLINK_MODE = S_IFLNK | 0o777;

const encoder = new TextEncoder();

/**
 * meta.json is the authority for symlink identity and targets (`symlink: string`).
 * OPFS stores symlinks as empty files, so losing meta.json turns them into empty regular files.
 */
export interface MetaEntry {
  mode: number;
  uid: number;
  gid: number;
  atimeSec: number;
  atimeNsec: number;
  mtimeSec: number;
  mtimeNsec: number;
  ctimeSec: number;
  ctimeNsec: number;
  symlink?: string;
}

export interface StoredMeta {
  version: 1;
  entries: Record<string, MetaEntry>;
}

export type MetaTimes = Pick<
  MetaEntry,
  'atimeSec' | 'atimeNsec' | 'mtimeSec' | 'mtimeNsec' | 'ctimeSec' | 'ctimeNsec'
>;

export function nowTimes(): MetaTimes {
  const ms = Date.now();
  const sec = Math.floor(ms / 1000);
  const nsec = (ms % 1000) * 1e6;
  return {
    atimeSec: sec,
    atimeNsec: nsec,
    mtimeSec: sec,
    mtimeNsec: nsec,
    ctimeSec: sec,
    ctimeNsec: nsec,
  };
}

export function defaultMeta(
  kind: NodeKind,
  extra?: Partial<MetaEntry>,
): MetaEntry {
  const times = nowTimes();
  const defaultPerms = kind === 'dir' ? 0o755 : 0o644;
  const mode =
    kind === 'symlink'
      ? SYMLINK_MODE
      : typeMode(kind) | ((extra?.mode ?? defaultPerms) & S_IRWXUGO);
  const meta: MetaEntry = {
    uid: 0,
    gid: 0,
    ...times,
    ...extra,
    mode,
  };
  if (kind !== 'symlink') delete meta.symlink;
  return meta;
}

export function normalizeLoadedMeta(entry: MetaEntry): MetaEntry {
  if (typeof entry.symlink === 'string') {
    return { ...entry, mode: SYMLINK_MODE, symlink: entry.symlink };
  }
  const rest = { ...entry };
  delete rest.symlink;
  if ((rest.mode & S_IFMT) === S_IFLNK) {
    return { ...rest, mode: S_IFREG | (rest.mode & S_IRWXUGO) };
  }
  return rest;
}

export function parseStoredMeta(text: string): StoredMeta | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const candidate = parsed as Partial<StoredMeta> | null;
  if (
    candidate?.version !== 1 ||
    !candidate.entries ||
    typeof candidate.entries !== 'object'
  ) {
    return null;
  }
  return candidate as StoredMeta;
}

async function readMetaCandidate(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<{ payload: StoredMeta; lastModified: number } | null> {
  try {
    const file = await (await dir.getFileHandle(name)).getFile();
    const payload = parseStoredMeta(await file.text());
    return payload ? { payload, lastModified: file.lastModified } : null;
  } catch (error) {
    if (!isDomError(error, 'NotFoundError')) console.error(error);
    return null;
  }
}

/**
 * In-memory path → metadata map persisted to `meta.json` in `dir`.
 * Changes are flushed after a short debounce via `scheduleFlush`, which must
 * serialize the flush with other filesystem work.
 */
export class MetaStore {
  private readonly entries = new Map<string, MetaEntry>();
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly dir: FileSystemDirectoryHandle,
    private readonly scheduleFlush: (flush: () => Promise<void>) => void,
  ) {}

  get(path: string): MetaEntry | undefined {
    return this.entries.get(path);
  }

  /** A copy of the entry for `path`, or defaults for `kind`. */
  of(path: string, kind: NodeKind): MetaEntry {
    const existing = this.entries.get(path);
    return existing ? { ...existing } : defaultMeta(kind);
  }

  set(path: string, meta: MetaEntry): void {
    this.entries.set(path, meta);
    this.markDirty();
  }

  ensureRoot(): void {
    this.set('', this.entries.get('') ?? defaultMeta('dir'));
  }

  forget(root: string): void {
    deleteWithin(this.entries, root);
    this.markDirty();
  }

  remap(from: string, to: string): void {
    remapWithin(this.entries, from, to);
    this.markDirty();
  }

  /**
   * Loads meta.json (or its tmp sibling, whichever is newer), drops entries for
   * paths missing from `tree`, adds defaults for untracked paths, and flushes.
   */
  async load(tree: FileSystemDirectoryHandle): Promise<void> {
    const primary = await readMetaCandidate(this.dir, OPFS_META_FILE);
    const fallback = await readMetaCandidate(this.dir, OPFS_META_TEMP_FILE);
    const parsed =
      primary && fallback
        ? fallback.lastModified >= primary.lastModified
          ? fallback.payload
          : primary.payload
        : (primary?.payload ?? fallback?.payload ?? null);
    if (parsed) {
      for (const [path, entry] of Object.entries(parsed.entries)) {
        if (entry && typeof entry.mode === 'number')
          this.entries.set(path, normalizeLoadedMeta(entry));
      }
    }

    const existing = await collectKinds(tree);
    for (const path of [...this.entries.keys()]) {
      if (!existing.has(path)) this.entries.delete(path);
    }
    for (const [path, kind] of existing) {
      if (!this.entries.has(path)) this.entries.set(path, defaultMeta(kind));
    }
    this.ensureRoot();
    await this.flush();
  }

  /** Writes meta.json.tmp, then moves it over meta.json. */
  async flush(): Promise<void> {
    if (!this.dirty) return;
    const payload: StoredMeta = {
      version: 1,
      entries: Object.fromEntries(this.entries),
    };
    const bytes = encoder.encode(JSON.stringify(payload));
    const tmp = await this.dir.getFileHandle(OPFS_META_TEMP_FILE, {
      create: true,
    });
    const access = await tmp.createSyncAccessHandle();
    try {
      access.truncate(0);
      access.write(bytes, { at: 0 });
      access.flush();
    } finally {
      access.close();
    }
    try {
      if (canMove(tmp)) {
        // Preferred: atomic rename that overwrites the destination when the
        // engine supports it (current Chromium/Firefox/Safari WPT behavior).
        try {
          await tmp.move(this.dir, OPFS_META_FILE);
        } catch (error) {
          // Some engines reject overwrite; remove dest then retry. A crash
          // between remove and move leaves only meta.json.tmp, which load()
          // recovers from.
          if (
            !isDomError(
              error,
              'InvalidModificationError',
              'NoModificationAllowedError',
            )
          ) {
            throw error;
          }
          await ignoreNotFound(() => this.dir.removeEntry(OPFS_META_FILE));
          await tmp.move(this.dir, OPFS_META_FILE);
        }
      } else {
        // Keep tmp until the main file is fully written so a mid-copy crash
        // still leaves a recoverable copy for load().
        await copyFile(tmp, this.dir, OPFS_META_FILE);
        await ignoreNotFound(() => this.dir.removeEntry(OPFS_META_TEMP_FILE));
      }
    } catch (error) {
      console.error(error);
      return;
    }
    this.dirty = false;
  }

  async close(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.flush();
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.scheduleFlush(() => this.flush());
    }, META_FLUSH_MS);
  }
}
