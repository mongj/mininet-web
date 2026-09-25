import { useCallback, useEffect, useRef, useState } from 'react';
import { loadEmulatorOptions } from '@/lib/emulator-settings';
import type { WorkerCommand, WorkerEvent } from '../vm/messages';

export type Phase =
  'idle' | 'downloading' | 'booting' | 'shell' | 'mininet' | 'error';
interface SessionState {
  phase: Phase;
  progress: number | null;
  error: string | null;
}
const INITIAL_STATE: SessionState = {
  phase: 'idle',
  progress: null,
  error: null,
};
const ANSI_ESCAPE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const SHELL_INSTRUCTIONS = `BROWSER_LAB_READY
Linux is ready. Mininet and Open vSwitch are installed in this guest.

Demo network (hosts h1 and h2, switch s1):
  python3 /root/lab.py

That opens the Mininet CLI. Try nodes, net, pingall, and help.
exit returns to this shell.

Or start your own topology:
  mn --switch ovsbr --controller none --topo single,2`;

function toTerminalText(text: string) {
  return `${text.replace(/\n/g, '\r\n')}\r\n`;
}

function isClearEcho(text: string) {
  const stripped = text.replace(ANSI_ESCAPE, '').replace(/\r/g, '');
  return stripped.trim() === '' || stripped === 'browser-lab:~# ';
}

function describeUnknownError(error: unknown): string | null {
  if (error instanceof Error) return error.message.trim() || null;
  if (typeof error === 'string') return error.trim() || null;
  return null;
}

function kernelPanicMessage(serial: string): string {
  const match = serial.match(/Kernel panic - not syncing:[^\n\r]*/);
  return match?.[0]?.trim() || 'Kernel panic - not syncing';
}

export function useVirtualMachine(
  onSerial: (text: string) => void,
  onClearScreen?: () => void,
) {
  const [state, setState] = useState<SessionState>(INITIAL_STATE);
  const worker = useRef<Worker | null>(null);
  const session = useRef(0);

  const stop = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const send = useCallback((text: string) => {
    worker.current?.postMessage({
      type: 'input',
      text,
    } satisfies WorkerCommand);
  }, []);

  const start = useCallback(() => {
    stop();
    const generation = ++session.current;
    setState({ ...INITIAL_STATE, phase: 'downloading', progress: 0 });
    let tail = '';
    let welcomed = false;
    let clearing = false;
    let clearFrom = 0;
    let ignoreClearEchoUntil = 0;
    let welcomeTimer: ReturnType<typeof setTimeout> | undefined;

    const fail = (message?: string | null) => {
      if (welcomeTimer !== undefined) clearTimeout(welcomeTimer);
      stop();
      setState((current) => ({
        ...current,
        phase: 'error',
        progress: null,
        error: message?.trim() || null,
      }));
    };

    const finishWelcome = () => {
      if (session.current !== generation || !clearing) return;
      clearing = false;
      if (welcomeTimer !== undefined) {
        clearTimeout(welcomeTimer);
        welcomeTimer = undefined;
      }
      ignoreClearEchoUntil = Date.now() + 500;
      onClearScreen?.();
      onSerial(
        `\x1b[3J\x1b[H\x1b[2J${toTerminalText(SHELL_INSTRUCTIONS)}browser-lab:~# `,
      );
    };

    try {
      const instance = new Worker(
        new URL('../vm/emulator.worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.current = instance;
      instance.onerror = (event) => {
        if (worker.current !== instance) return;
        fail(describeUnknownError(event.error) ?? event.message);
      };
      instance.onmessage = ({ data }: MessageEvent<WorkerEvent>) => {
        if (worker.current !== instance) return;
        switch (data.type) {
          case 'error':
            fail(data.message);
            return;
          case 'progress':
            setState((current) => ({
              ...current,
              phase: 'downloading',
              progress: data.total > 0 ? (data.loaded / data.total) * 100 : 0,
            }));
            return;
          case 'booting':
            setState((current) => ({
              ...current,
              phase: 'booting',
              progress: null,
            }));
            return;
          case 'serial': {
            tail = (tail + data.text).slice(-20_000);
            const clean = tail.replace(ANSI_ESCAPE, '');
            if (clean.includes('Kernel panic - not syncing:')) {
              fail(kernelPanicMessage(clean));
              return;
            }

            if (clearing) {
              const after = tail.slice(clearFrom).replace(ANSI_ESCAPE, '');
              if (after.includes('browser-lab:~# ')) finishWelcome();
              return;
            }

            if (Date.now() < ignoreClearEchoUntil && isClearEcho(data.text))
              return;

            onSerial(data.text);

            const atMininet = clean.endsWith('mininet> ');
            const atShell =
              clean.includes('BROWSER_LAB_READY') &&
              clean.endsWith('browser-lab:~# ');
            if (atMininet) {
              setState((current) => ({ ...current, phase: 'mininet' }));
              return;
            }
            if (!atShell) return;
            setState((current) => ({ ...current, phase: 'shell' }));
            if (welcomed) return;
            welcomed = true;
            clearing = true;
            clearFrom = tail.length;
            onClearScreen?.();
            instance.postMessage({
              type: 'input',
              text: '\x0c',
            } satisfies WorkerCommand);
            welcomeTimer = setTimeout(finishWelcome, 400);
            return;
          }
          default: {
            const exhaustive: never = data;
            return exhaustive;
          }
        }
      };

      instance.postMessage({
        type: 'start',
        assetBase: new URL(
          `${import.meta.env.BASE_URL}vm/`,
          window.location.href,
        ).href,
        options: loadEmulatorOptions(),
      } satisfies WorkerCommand);
    } catch (error) {
      fail(describeUnknownError(error));
    }
  }, [onClearScreen, onSerial, stop]);

  return { ...state, start, send };
}
