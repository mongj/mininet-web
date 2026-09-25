import type { V86 as Emulator } from 'v86';
import type { GuestManifest, WorkerCommand, WorkerEvent } from './messages';

let emulator: Emulator | undefined;
let starting = false;
let output = '';

function emit(event: WorkerEvent) {
  self.postMessage(event);
}

function flush() {
  if (!output) return;
  emit({ type: 'serial', text: output });
  output = '';
}

const flushTimer = setInterval(flush, 24);

function fail(error: unknown) {
  flush();
  clearInterval(flushTimer);
  emit({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  });
}

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

async function start(assetBase: string) {
  if (starting) return;
  starting = true;

  try {
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
    let offset = 0;
    emit({ type: 'progress', loaded: 0, total: manifest.bytes });

    for (const chunk of manifest.chunks) {
      const bytes = await readBody(await asset(chunk.file), (loaded) => {
        emit({
          type: 'progress',
          loaded: offset + loaded,
          total: manifest.bytes,
        });
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
      initrd.set(new Uint8Array(bytes), offset);
      offset += bytes.byteLength;
      emit({ type: 'progress', loaded: offset, total: manifest.bytes });
    }
    if (offset !== manifest.bytes)
      throw new Error('The Linux image is incomplete.');

    const [bios, vgaBios, kernel] = await Promise.all(
      ['seabios.bin', 'vgabios.bin', 'vmlinuz'].map(async (file) =>
        (await asset(file)).arrayBuffer(),
      ),
    );
    emit({ type: 'booting' });
    emulator = new V86({
      wasm_path: url('v86.wasm'),
      memory_size: 256 * 1024 * 1024,
      vga_memory_size: 2 * 1024 * 1024,
      bios: { buffer: bios },
      vga_bios: { buffer: vgaBios },
      bzimage: { buffer: kernel },
      initrd: { buffer: initrd.buffer },
      cmdline:
        'console=ttyS0,115200 rdinit=/init random.trust_cpu=on tsc=reliable mitigations=off',
      autostart: true,
      disable_speaker: true,
      disable_mouse: true,
      disable_keyboard: true,
    });
    emulator.add_listener('serial0-output-byte', (byte) => {
      output += String.fromCharCode(byte);
      if (output.length > 4096) flush();
    });
  } catch (error) {
    fail(error);
  }
}

self.onmessage = ({ data }: MessageEvent<WorkerCommand>) => {
  if (data.type === 'start') void start(data.assetBase);
  else emulator?.serial0_send(data.text);
};

self.addEventListener('unhandledrejection', (event) => fail(event.reason));
