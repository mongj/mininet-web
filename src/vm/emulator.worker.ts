import type { V86 as Emulator } from 'v86';
import {
  sanitizeEmulatorOptions,
  type EmulatorOptions,
} from './emulator-options';
import type { GuestManifest, WorkerCommand, WorkerEvent } from './messages';

let emulator: Emulator | undefined;
let starting = false;
let output = '';
let flushTimer: ReturnType<typeof setInterval> | undefined;

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
    case 0x01:
      emit({ type: 'ready' });
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

async function stopEmulator() {
  const current = emulator;
  if (!current) return;
  emulator = undefined;
  current.remove_listener('serial0-output-byte', onSerial0Output);
  current.remove_listener('serial1-output-byte', onSerial1Output);
  output = '';
  await current.destroy();
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

self.onmessage = ({ data }: MessageEvent<WorkerCommand>) => {
  if (data.type === 'start') void start(data.assetBase, data.options);
  else emulator?.serial0_send(data.text);
};

self.addEventListener('unhandledrejection', (event) => fail(event.reason));
