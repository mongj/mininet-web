import type { editor } from 'monaco-editor/editor/editor.api';
import { errorMessage } from '@/lib/errors';
import { baseName, isPathWithin, rebasePath } from '@/lib/paths';
import type { FileSystemClient } from '@/vm/fs-client';
import { FsError, type FsChange, type FsReadResult } from '@/vm/fs-protocol';
import { languageFor, loadMonaco, type Monaco } from './monaco';

/** Larger files are not opened in the editor. */
export const MAX_EDITABLE_BYTES = 2 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8192;

export type DocumentStatus =
  | 'waiting' // Linux is not serving files yet
  | 'loading'
  | 'ready'
  | 'missing'
  | 'too-large'
  | 'binary'
  | 'error';

export interface DocumentSnapshot {
  status: DocumentStatus;
  /** The buffer has edits that are not on disk. */
  dirty: boolean;
  /** The file was removed while the buffer was being kept. */
  deletedOnDisk: boolean;
  model: editor.ITextModel | null;
  error: string | null;
  saveError: string | null;
}

const CLOSED: DocumentSnapshot = {
  status: 'waiting',
  dirty: false,
  deletedOnDisk: false,
  model: null,
  error: null,
  saveError: null,
};

interface OpenDocument {
  path: string;
  refs: number;
  snapshot: DocumentSnapshot;
  /** `getAlternativeVersionId()` of the content last read from or written to disk. */
  savedVersion: number;
  loading: boolean;
  /** The file changed while it was being loaded. */
  loadAgain: boolean;
}

/** The text in `data`, or null when it would not survive a UTF-8 round trip. */
function decodeText(data: Uint8Array): string | null {
  if (data.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return null;
  }
}

/**
 * The files open in editors: one Monaco model per path, shared by every view
 * of that file, with its saved/dirty state and its link to the file on disk.
 */
export class DocumentStore {
  private readonly documents = new Map<string, OpenDocument>();
  private readonly listeners = new Set<() => void>();
  private ready = false;
  private monaco: Monaco | null = null;

  constructor(private readonly fs: FileSystemClient) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot(path: string): DocumentSnapshot {
    return this.documents.get(path)?.snapshot ?? CLOSED;
  }

  hasUnsavedChanges(): boolean {
    return [...this.documents.values()].some((doc) => doc.snapshot.dirty);
  }

  /** Starts tracking `path`; balanced by `close`. */
  open(path: string): void {
    const existing = this.documents.get(path);
    if (existing) {
      existing.refs += 1;
      return;
    }
    const doc: OpenDocument = {
      path,
      refs: 1,
      snapshot: CLOSED,
      savedVersion: 0,
      loading: false,
      loadAgain: false,
    };
    this.documents.set(path, doc);
    void this.load(doc);
  }

  close(path: string): void {
    const doc = this.documents.get(path);
    if (!doc) return;
    doc.refs -= 1;
    if (doc.refs > 0) return;
    this.documents.delete(path);
    doc.snapshot.model?.dispose();
    this.emit();
  }

  /** Tells the store whether Linux is serving files; reloads when it starts. */
  setReady(ready: boolean): void {
    if (this.ready === ready) return;
    this.ready = ready;
    if (!ready) return;
    for (const doc of this.documents.values()) void this.load(doc);
  }

  /** Reloads the open files a change in the playground may have touched. */
  handleChange(change: FsChange): void {
    for (const doc of this.documents.values()) {
      if (change.paths.some((path) => isPathWithin(path, doc.path))) {
        void this.load(doc);
      }
    }
  }

  /** Follows a file or folder that was moved from `from` to `to`. */
  rename(from: string, to: string): void {
    const moved = [...this.documents.values()].filter((doc) =>
      isPathWithin(from, doc.path),
    );
    if (moved.length === 0) return;
    for (const doc of moved) this.documents.delete(doc.path);
    for (const doc of moved) {
      doc.path = rebasePath(doc.path, from, to);
      // A document already open at the destination described what the move
      // replaced; its views now show the moved file.
      const displaced = this.documents.get(doc.path);
      if (displaced) {
        doc.refs += displaced.refs;
        displaced.snapshot.model?.dispose();
      }
      this.documents.set(doc.path, doc);
      const model = doc.snapshot.model;
      if (model && this.monaco) {
        this.monaco.editor.setModelLanguage(
          model,
          languageFor(doc.path, model.getValue()),
        );
      }
      doc.snapshot = { ...doc.snapshot };
    }
    this.emit();
  }

  /** Writes the buffer to disk, recreating the file if it was removed. */
  async save(path: string): Promise<void> {
    const doc = this.documents.get(path);
    const model = doc?.snapshot.model;
    if (!doc || !model || doc.snapshot.status !== 'ready') return;
    const version = model.getAlternativeVersionId();
    try {
      await this.fs.write(doc.path, new TextEncoder().encode(model.getValue()));
    } catch (error) {
      if (this.isOpen(doc)) {
        this.update(doc, {
          saveError: `Could not save ${baseName(doc.path)}. ${errorMessage(error)}`,
        });
      }
      return;
    }
    if (!this.isOpen(doc) || model.isDisposed()) return;
    doc.savedVersion = version;
    this.update(doc, {
      dirty: model.getAlternativeVersionId() !== version,
      deletedOnDisk: false,
      saveError: null,
    });
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private update(doc: OpenDocument, patch: Partial<DocumentSnapshot>): void {
    doc.snapshot = { ...doc.snapshot, ...patch };
    this.emit();
  }

  /** False once `doc` was closed, or replaced by a file moved onto it. */
  private isOpen(doc: OpenDocument): boolean {
    return this.documents.get(doc.path) === doc;
  }

  /** Drops a model whose file can no longer be shown as text. */
  private unload(doc: OpenDocument, patch: Partial<DocumentSnapshot>): void {
    doc.snapshot.model?.dispose();
    this.update(doc, {
      model: null,
      dirty: false,
      deletedOnDisk: false,
      error: null,
      saveError: null,
      ...patch,
    });
  }

  /** The file on disk stopped being editable text. */
  private notText(doc: OpenDocument, status: 'too-large' | 'binary'): void {
    // Unsaved edits win over what changed on disk; saving writes them back.
    if (doc.snapshot.model && doc.snapshot.dirty) {
      if (doc.snapshot.deletedOnDisk)
        this.update(doc, { deletedOnDisk: false });
      return;
    }
    this.unload(doc, { status });
  }

  /**
   * Brings `doc` in line with the file on disk. Calls made while a load is
   * running are folded into one more pass, so the content shown is never
   * older than the last change.
   */
  private async load(doc: OpenDocument): Promise<void> {
    if (doc.loading) {
      doc.loadAgain = true;
      return;
    }
    doc.loading = true;
    try {
      do {
        doc.loadAgain = false;
        await this.loadOnce(doc);
      } while (doc.loadAgain && this.isOpen(doc));
    } finally {
      doc.loading = false;
    }
  }

  private async loadOnce(doc: OpenDocument): Promise<void> {
    if (!this.ready) {
      if (!doc.snapshot.model) this.update(doc, { status: 'waiting' });
      return;
    }
    if (!doc.snapshot.model) this.update(doc, { status: 'loading' });
    // Fetch the editor while the file is being read.
    const editor = loadMonaco();
    editor.catch(() => {});

    let result: FsReadResult;
    try {
      result = await this.fs.read(doc.path, MAX_EDITABLE_BYTES);
    } catch (error) {
      if (this.isOpen(doc)) this.loadFailed(doc, error);
      return;
    }
    if (!this.isOpen(doc)) return;
    if (result.tooLarge) return this.notText(doc, 'too-large');
    const text = decodeText(result.data);
    if (text === null) return this.notText(doc, 'binary');

    let monaco: Monaco;
    try {
      monaco = await editor;
    } catch (error) {
      if (this.isOpen(doc)) {
        this.update(doc, {
          status: 'error',
          error: `The editor could not be loaded. ${errorMessage(error)}`,
        });
      }
      return;
    }
    if (!this.isOpen(doc)) return;
    this.monaco = monaco;

    let model = doc.snapshot.model;
    if (!model) {
      model = this.createModel(doc, monaco, text);
      doc.savedVersion = model.getAlternativeVersionId();
    } else if (!doc.snapshot.dirty && model.getValue() !== text) {
      // Unsaved edits win over what changed on disk; saving writes them back.
      model.setValue(text);
      doc.savedVersion = model.getAlternativeVersionId();
    }
    this.update(doc, {
      status: 'ready',
      model,
      dirty: model.getAlternativeVersionId() !== doc.savedVersion,
      deletedOnDisk: false,
      error: null,
    });
  }

  private createModel(
    doc: OpenDocument,
    monaco: Monaco,
    text: string,
  ): editor.ITextModel {
    const model = monaco.editor.createModel(text, languageFor(doc.path, text));
    model.onDidChangeContent(() => {
      if (!this.isOpen(doc)) return;
      const dirty = model.getAlternativeVersionId() !== doc.savedVersion;
      if (dirty !== doc.snapshot.dirty || doc.snapshot.saveError) {
        this.update(doc, { dirty, saveError: null });
      }
    });
    return model;
  }

  private loadFailed(doc: OpenDocument, error: unknown): void {
    const code = error instanceof FsError ? error.code : 'io';
    // Linux stopped serving files; keep what is shown until it is back.
    if (code === 'unavailable') return;
    if (code === 'not-found') {
      if (doc.snapshot.model && doc.snapshot.dirty) {
        this.update(doc, { deletedOnDisk: true });
      } else {
        this.unload(doc, { status: 'missing' });
      }
      return;
    }
    if (doc.snapshot.model) return;
    this.update(doc, { status: 'error', error: errorMessage(error) });
  }
}
