import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadEmulatorOptions } from '@/lib/emulator-settings';
import { FileSystemClient } from '../vm/fs-client';
import type { StorageReason, WorkerCommand, WorkerEvent } from '../vm/messages';
import {
  clearPlaygroundStorage,
  type ClearPlaygroundResult,
} from '../vm/opfs-storage';

export type Phase =
  'idle' | 'downloading' | 'booting' | 'shell' | 'mininet' | 'error';

/** Linux is stopped, or the last boot failed. Same condition as showing Boot. */
export function canBoot(phase: Phase): boolean {
  return phase === 'idle' || phase === 'error';
}

/** Linux is up and the shell is usable. */
export function isBooted(phase: Phase): boolean {
  return phase === 'shell' || phase === 'mininet';
}

export type StorageState =
  { persistent: true } | { persistent: false; reason: StorageReason } | null;

interface SessionState {
  phase: Phase;
  progress: number | null;
  error: string | null;
  storage: StorageState;
}
const INITIAL_STATE: SessionState = {
  phase: 'idle',
  progress: null,
  error: null,
  storage: null,
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

function storageFromEvent(
  event: Extract<WorkerEvent, { type: 'storage' }>,
): StorageState {
  return event.persistent
    ? { persistent: true }
    : { persistent: false, reason: event.reason };
}

let persistenceRequested = false;

function requestPersistentStorage(): void {
  if (persistenceRequested || !navigator.storage?.persist) return;
  persistenceRequested = true;
  void (async () => {
    try {
      if (await navigator.storage.persisted()) return;
      await navigator.storage.persist();
    } catch (error) {
      console.error(error);
    }
  })();
}

const fileSystem = new FileSystemClient();

async function shutdownWorker(instance: Worker) {
  fileSystem.detach(instance);
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
        fileSystem.attach(instance);
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
            case 'storage':
              if (data.persistent) requestPersistentStorage();
              setState((current) => ({
                ...current,
                storage: storageFromEvent(data),
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
            case 'fs-result':
              fileSystem.handleResult(data);
              return;
            case 'fs-change':
              fileSystem.handleChange(data);
              return;
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

  const resetSavedFiles =
    useCallback(async (): Promise<ClearPlaygroundResult> => {
      let shouldRestart = false;
      let result: ClearPlaygroundResult = 'unavailable';

      try {
        await enqueue(async () => {
          shouldRestart = worker.current !== null;
          const instance = worker.current;
          worker.current = null;
          if (instance) await shutdownWorker(instance);
          result = await clearPlaygroundStorage();
          if (!shouldRestart && result === 'cleared') setState(INITIAL_STATE);
        });
      } finally {
        if (shouldRestart) void start();
      }
      return result;
    }, [enqueue, start]);

  // A stable object between state changes, so it can be a memo dependency.
  return useMemo(
    () => ({ ...state, start, send, resetSavedFiles, files: fileSystem }),
    [state, start, send, resetSavedFiles],
  );
}
