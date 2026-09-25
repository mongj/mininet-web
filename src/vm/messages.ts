export type WorkerCommand =
  { type: 'start'; assetBase: string } | { type: 'input'; text: string };

export type WorkerEvent =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'booting' }
  | { type: 'serial'; text: string }
  | { type: 'error'; message: string };

export interface GuestManifest {
  bytes: number;
  chunks: Array<{ file: string; bytes: number; sha256: string }>;
}
