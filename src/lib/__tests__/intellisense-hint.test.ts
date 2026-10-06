import { afterEach, describe, expect, it } from 'vitest';
import {
  INTELLISENSE_HINT_KEY,
  hasSeenIntelliSenseHint,
  rememberIntelliSenseHint,
} from '../intellisense-hint';

function installStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
      key: () => null,
      get length() {
        return store.size;
      },
    },
  });
}

describe('intellisense hint', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('stays unseen until the editor has been opened once', () => {
    installStorage();
    expect(hasSeenIntelliSenseHint()).toBe(false);
    rememberIntelliSenseHint();
    expect(localStorage.getItem(INTELLISENSE_HINT_KEY)).toBe('1');
    expect(hasSeenIntelliSenseHint()).toBe(true);
  });
});
