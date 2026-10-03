import type { V86 as Emulator } from 'v86';
import {
  sanitizeEmulatorOptions,
  type EmulatorOptions,
} from './emulator-options';
import type { FsChange, FsRequest } from './fs-protocol';
import type {
  GuestManifest,
  StorageReason,
  WorkerCommand,
  WorkerEvent,
} from './messages';
import { fsErrorCode } from './9p/errors';
import { asOpfsRoot, createMemoryRoot } from './9p/memory-opfs';
import { Opfs9pServer } from './9p/server';
import { requestPlaygroundLock } from './opfs-storage';

let emulator: Emulator | undefined;
let starting = false;
let output = '';
let flushTimer: ReturnType<typeof setInterval> | undefined;
// `releaseLock` is set when the playground is backed by OPFS, not by memory.
let playground: { server: Opfs9pServer; releaseLock?: () => void } | undefined;
// Set while the host serves the playground and waits for the guest's mount result.
let awaitingGuestMount = false;

// Side-channel bytes the guest writes to serial1; see guest/init.
const SERIAL1_READY = 0x01;
const SERIAL1_PLAYGROUND_MOUNTED = 0x02;
const SERIAL1_PLAYGROUND_NOT_MOUNTED = 0x03;

function emit(event: WorkerEvent) {
  self.postMessage(event);
}

function flush() {
  if (!output) return;
  emit({ type: 'serial', text: output });
  output = '';
}

function onSerial0Output(byte: number) {
  output += String.fromCharCode(byte);
  if (output.length > 4096) flush();
}

function onSerial1Output(byte: number) {
  switch (byte) {
    case SERIAL1_READY:
      emit({ type: 'ready' });
      break;
    case SERIAL1_PLAYGROUND_MOUNTED:
    case SERIAL1_PLAYGROUND_NOT_MOUNTED:
      if (!awaitingGuestMount) break;
      awaitingGuestMount = false;
      if (byte === SERIAL1_PLAYGROUND_MOUNTED) {
        // A memory-backed playground was already reported when it was attached.
        if (playground?.releaseLock)
          emit({ type: 'storage', persistent: true });
        break;
      }
      emit({ type: 'storage', persistent: false, reason: 'mount-failed' });
      releasePlayground().catch((error: unknown) => {
        console.error(error);
      });
      break;
  }
}

function armFlush() {
  if (flushTimer !== undefined) return;
  flushTimer = setInterval(flush, 24);
}

function fail(error: unknown) {
  flush();
  if (flushTimer !== undefined) {
    clearInterval(flushTimer);
    flushTimer = undefined;
  }
  emit({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  });
}

async function releasePlayground() {
  const current = playground;
  playground = undefined;
  awaitingGuestMount = false;
  if (!current) return;
  try {
    await current.server.close();
  } finally {
    current.releaseLock?.();
  }
}

function onPlaygroundChange(change: FsChange) {
  emit({ type: 'fs-change', ...change });
}

/** Serves the playground from OPFS when `releaseLock` is given, else from memory. */
async function servePlayground(
  releaseLock?: () => void,
): Promise<Opfs9pServer> {
  const server = await Opfs9pServer.open(
    releaseLock ? undefined : asOpfsRoot(createMemoryRoot()),
    onPlaygroundChange,
  );
  playground = { server, releaseLock };
  awaitingGuestMount = true;
  return server;
}

/**
 * Serves the playground from memory, so the host still sees the session's
 * files when they cannot be saved.
 */
function attachMemoryPlayground(reason: StorageReason): Promise<Opfs9pServer> {
  emit({ type: 'storage', persistent: false, reason });
  return servePlayground();
}

async function attachPlayground(): Promise<Opfs9pServer> {
  let releaseLock: (() => void) | null;
  try {
    releaseLock = await requestPlaygroundLock();
  } catch (error) {
    console.error(error);
    return attachMemoryPlayground('unavailable');
  }
  if (!releaseLock) return attachMemoryPlayground('locked');
  try {
    return await servePlayground(releaseLock);
  } catch (error) {
    console.error(error);
    releaseLock();
    return attachMemoryPlayground('unavailable');
  }
}

async function handleFs(id: number, request: FsRequest) {
  if (!playground) {
    emit({ type: 'fs-result', id, ok: false, code: 'unavailable' });
    return;
  }
  try {
    const call = playground.server.host[request.method] as (
      ...args: unknown[]
    ) => Promise<unknown>;
    const value = await call(...request.args);
    emit({ type: 'fs-result', id, ok: true, value: value ?? null });
  } catch (error) {
    emit({ type: 'fs-result', id, ok: false, code: fsErrorCode(error) });
  }
}

async function stopEmulator() {
  const current = emulator;
  emulator = undefined;
  if (current) {
    current.remove_listener('serial0-output-byte', onSerial0Output);
    current.remove_listener('serial1-output-byte', onSerial1Output);
    output = '';
    await current.destroy();
  }
  await releasePlayground();
}

armFlush();

async function readBody(
  response: Response,
  onProgress: (loaded: number) => void,
): Promise<ArrayBuffer> {
  const length = Number(response.headers.get('content-length'));
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    onProgress(bytes.byteLength);
    return bytes;
  }

  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.byteLength;
    onProgress(
      Number.isFinite(length) && length > 0 ? Math.min(loaded, length) : loaded,
    );
  }

  const bytes = new Uint8Array(loaded);
  let written = 0;
  for (const part of parts) {
    bytes.set(part, written);
    written += part.byteLength;
  }
  return bytes.buffer;
}

async function start(assetBase: string, rawOptions: EmulatorOptions) {
  if (starting) return;
  starting = true;

  try {
    await stopEmulator();
    armFlush();
    const url = (file: string) => new URL(file, assetBase).href;
    async function asset(file: string) {
      const response = await fetch(url(file));
      if (
        !response.ok ||
        response.headers.get('content-type')?.includes('text/html')
      ) {
        throw new Error(
          `Could not load ${file}. Check the deployed assets and retry.`,
        );
      }
      return response;
    }

    // v86 is a vendored module, outside Vite's bundle. Its Node-only branches
    // stay intact for the headless test and are never executed in this worker.
    const moduleUrl = url('libv86.mjs');
    const { V86 } = (await import(
      /* @vite-ignore */ moduleUrl
    )) as typeof import('v86');
    const manifest = (await (
      await asset('guest.json')
    ).json()) as GuestManifest;
    const initrd = new Uint8Array(manifest.bytes);
    const loadedBytes = manifest.chunks.map(() => 0);
    const starts: number[] = [];
    let cursor = 0;
    for (const chunk of manifest.chunks) {
      starts.push(cursor);
      cursor += chunk.bytes;
    }
    if (cursor !== manifest.bytes)
      throw new Error('The Linux image is incomplete.');
    emit({ type: 'progress', loaded: 0, total: manifest.bytes });

    const report = () => {
      const loaded = loadedBytes.reduce((sum, value) => sum + value, 0);
      emit({
        type: 'progress',
        loaded: Math.min(loaded, manifest.bytes),
        total: manifest.bytes,
      });
    };

    const [[bios, vgaBios, kernel]] = await Promise.all([
      Promise.all(
        ['seabios.bin', 'vgabios.bin', 'vmlinuz'].map(async (file) =>
          (await asset(file)).arrayBuffer(),
        ),
      ),
      Promise.all(
        manifest.chunks.map(async (chunk, index) => {
          const start = starts[index];
          const bytes = await readBody(await asset(chunk.file), (loaded) => {
            loadedBytes[index] = Math.min(loaded, chunk.bytes);
            report();
          });
          const digest = await crypto.subtle.digest('SHA-256', bytes);
          const hash = Array.from(new Uint8Array(digest), (value) =>
            value.toString(16).padStart(2, '0'),
          ).join('');
          if (bytes.byteLength !== chunk.bytes || hash !== chunk.sha256) {
            throw new Error(
              'The Linux image failed its integrity check. Reset the lab to retry.',
            );
          }
          initrd.set(new Uint8Array(bytes), start);
          loadedBytes[index] = bytes.byteLength;
          report();
        }),
      ),
    ]);
    emit({ type: 'booting' });
    const options = sanitizeEmulatorOptions(rawOptions);
    console.info('v86 options', options);
    const server = await attachPlayground();
    emulator = new V86({
      wasm_path: url('v86.wasm'),
      memory_size: options.memory_size,
      vga_memory_size: options.vga_memory_size,
      bios: { buffer: bios },
      vga_bios: { buffer: vgaBios },
      bzimage: { buffer: kernel },
      initrd: { buffer: initrd.buffer },
      cmdline: options.cmdline,
      autostart: true,
      disable_speaker: options.disable_speaker,
      disable_mouse: options.disable_mouse,
      disable_keyboard: options.disable_keyboard,
      uart1: true,
      filesystem: { handle9p: (req, reply) => server.handle(req, reply) },
    });
    emulator.add_listener('serial0-output-byte', onSerial0Output);
    emulator.add_listener('serial1-output-byte', onSerial1Output);
  } catch (error) {
    try {
      await stopEmulator();
    } catch (stopError) {
      console.error(stopError);
    }
    fail(error);
  } finally {
    starting = false;
  }
}

async function handleStop() {
  try {
    await stopEmulator();
  } catch (error) {
    console.error(error);
  }
  emit({ type: 'stopped' });
}

self.onmessage = ({ data }: MessageEvent<WorkerCommand>) => {
  switch (data.type) {
    case 'start':
      void start(data.assetBase, data.options);
      return;
    case 'input':
      emulator?.serial0_send(data.text);
      return;
    case 'fs':
      void handleFs(data.id, data.request);
      return;
    case 'stop':
      void handleStop();
      return;
    default: {
      const exhaustive: never = data;
      return exhaustive;
    }
  }
};

self.addEventListener('unhandledrejection', (event) => fail(event.reason));
