export const PLAYGROUND_LOCK = 'mininet-web:playground';
export const OPFS_APP_DIR = 'mininet-web';
export const OPFS_PLAYGROUND_DIR = 'playground';
export const OPFS_META_FILE = 'meta.json';
export const OPFS_META_TEMP_FILE = 'meta.json.tmp';

const CLEAR_LOCK_TIMEOUT_MS = 3_000;

export type ClearPlaygroundResult = 'cleared' | 'busy' | 'unavailable';

export async function requestPlaygroundLock(
  timeoutMs?: number,
): Promise<(() => void) | null> {
  const locks = navigator.locks;
  if (!locks?.request) return null;

  const options: LockOptions =
    timeoutMs === undefined
      ? { ifAvailable: true }
      : { signal: AbortSignal.timeout(timeoutMs) };

  return new Promise((resolve, reject) => {
    let settled = false;
    void locks
      .request(PLAYGROUND_LOCK, options, (lock) => {
        if (!lock) {
          resolve(null);
          return;
        }
        return new Promise<void>((release) => {
          resolve(() => {
            if (settled) return;
            settled = true;
            release();
          });
        });
      })
      .catch((error: unknown) => {
        if (
          error instanceof DOMException &&
          (error.name === 'TimeoutError' || error.name === 'AbortError')
        ) {
          resolve(null);
          return;
        }
        reject(error);
      });
  });
}

// A just-terminated worker releases the lock asynchronously, so wait for it.
export async function clearPlaygroundStorage(): Promise<ClearPlaygroundResult> {
  if (!navigator.storage?.getDirectory || !navigator.locks?.request) {
    return 'unavailable';
  }
  const release = await requestPlaygroundLock(CLEAR_LOCK_TIMEOUT_MS);
  if (!release) return 'busy';
  try {
    const root = await navigator.storage.getDirectory();
    try {
      await root.removeEntry(OPFS_APP_DIR, { recursive: true });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) {
        throw error;
      }
    }
    return 'cleared';
  } finally {
    release();
  }
}
