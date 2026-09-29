import type { EmulatorOptions } from './emulator-options';

export type WorkerCommand =
  | { type: 'start'; assetBase: string; options: EmulatorOptions }
  | { type: 'input'; text: string }
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
  | { type: 'storage'; persistent: false; reason: StorageReason };

export interface GuestManifest {
  bytes: number;
  chunks: Array<{ file: string; bytes: number; sha256: string }>;
}
