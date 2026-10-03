import type { EmulatorOptions } from './emulator-options';
import type { FsChange, FsErrorCode, FsRequest } from './fs-protocol';

export type WorkerCommand =
  | { type: 'start'; assetBase: string; options: EmulatorOptions }
  | { type: 'input'; text: string }
  | { type: 'fs'; id: number; request: FsRequest }
  | { type: 'stop' };

export type StorageReason = 'locked' | 'unavailable' | 'mount-failed';

export type WorkerEvent =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'booting' }
  | { type: 'ready' }
  | { type: 'serial'; text: string }
  | { type: 'error'; message: string }
  | { type: 'stopped' }
  | { type: 'storage'; persistent: true }
  | { type: 'storage'; persistent: false; reason: StorageReason }
  | { type: 'fs-result'; id: number; ok: true; value: unknown }
  | { type: 'fs-result'; id: number; ok: false; code: FsErrorCode }
  | ({ type: 'fs-change' } & FsChange);

export interface GuestManifest {
  bytes: number;
  chunks: Array<{ file: string; bytes: number; sha256: string }>;
}
