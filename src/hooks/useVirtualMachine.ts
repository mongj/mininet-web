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

function describeUnknownError(error: unknown): string | null {
  if (error instanceof Error) return error.message.trim() || null;
  if (typeof error === 'string') return error.trim() || null;
  return null;
}

function kernelPanicMessage(serial: string): string {
  const match = serial.match(/Kernel panic - not syncing:[^\n\r]*/);
  return match?.[0]?.trim() || 'Kernel panic - not syncing';
}

export function useVirtualMachine(onSerial: (text: string) => void) {
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

    const fail = (message?: string | null) => {
      stop();
      setState((current) => ({
        ...current,
        phase: 'error',
        progress: null,
        error: message?.trim() || null,
      }));
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
          case 'ready':
            if (session.current !== generation) return;
            setState((current) => ({
              ...current,
              phase: 'shell',
              progress: null,
            }));
            return;
          case 'serial': {
            tail = (tail + data.text).slice(-20_000);
            if (tail.includes('Kernel panic - not syncing:')) {
              fail(kernelPanicMessage(tail));
              return;
            }
            onSerial(data.text);
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
  }, [onSerial, stop]);

  return { ...state, start, send };
}
