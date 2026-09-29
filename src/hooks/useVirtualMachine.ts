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

const STOP_TIMEOUT_MS = 2000;

function describeUnknownError(error: unknown): string | null {
  if (error instanceof Error) return error.message.trim() || null;
  if (typeof error === 'string') return error.trim() || null;
  return null;
}

function kernelPanicMessage(serial: string): string {
  const match = serial.match(/Kernel panic - not syncing:[^\n\r]*/);
  return match?.[0]?.trim() || 'Kernel panic - not syncing';
}

async function shutdownWorker(instance: Worker) {
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      instance.removeEventListener('message', onMessage);
      resolve();
    };
    const onMessage = ({ data }: MessageEvent<WorkerEvent>) => {
      if (data.type === 'stopped') finish();
    };
    const timer = setTimeout(finish, STOP_TIMEOUT_MS);
    instance.addEventListener('message', onMessage);
    try {
      instance.postMessage({ type: 'stop' } satisfies WorkerCommand);
    } catch {
      finish();
    }
  });
  instance.terminate();
}

export function useVirtualMachine(onSerial: (text: string) => void) {
  const [state, setState] = useState<SessionState>(INITIAL_STATE);
  const worker = useRef<Worker | null>(null);
  const session = useRef(0);
  const lifecycle = useRef(Promise.resolve());

  const enqueue = useCallback((task: () => Promise<void>) => {
    const done = lifecycle.current.then(task);
    lifecycle.current = done.then(
      () => {},
      () => {},
    );
    return done;
  }, []);

  const stop = useCallback(async () => {
    await enqueue(async () => {
      const instance = worker.current;
      worker.current = null;
      if (instance) await shutdownWorker(instance);
    });
  }, [enqueue]);

  useEffect(
    () => () => {
      void stop();
    },
    [stop],
  );

  const send = useCallback((text: string) => {
    worker.current?.postMessage({
      type: 'input',
      text,
    } satisfies WorkerCommand);
  }, []);

  const start = useCallback(async () => {
    const generation = ++session.current;
    setState({ ...INITIAL_STATE, phase: 'downloading', progress: 0 });

    await enqueue(async () => {
      const previous = worker.current;
      worker.current = null;
      if (previous) await shutdownWorker(previous);
      if (session.current !== generation) return;

      let tail = '';
      let instance: Worker | null = null;

      const fail = (message?: string | null) => {
        if (instance && worker.current === instance) void stop();
        if (session.current !== generation) return;
        setState((current) => ({
          ...current,
          phase: 'error',
          progress: null,
          error: message?.trim() || null,
        }));
      };

      try {
        instance = new Worker(
          new URL('../vm/emulator.worker.ts', import.meta.url),
          { type: 'module' },
        );
        if (session.current !== generation) {
          instance.terminate();
          return;
        }
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
            case 'stopped':
              return;
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
    });
  }, [enqueue, onSerial, stop]);

  return { ...state, start, send };
}
