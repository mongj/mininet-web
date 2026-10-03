import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

function applyAppearance(appearance: ThemePreference) {
  const root = document.documentElement;
  switch (appearance) {
    case 'system':
      root.classList.remove('light', 'dark');
      return;
    case 'light':
      root.classList.remove('dark');
      root.classList.add('light');
      return;
    case 'dark':
      root.classList.remove('light');
      root.classList.add('dark');
      return;
    default: {
      const exhaustive: never = appearance;
      return exhaustive;
    }
  }
}

interface AppearanceContextValue {
  appearance: ThemePreference;
  setAppearance: (next: ThemePreference) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<ThemePreference>('system');

  useEffect(() => {
    applyAppearance(appearance);
  }, [appearance]);

  return (
    <AppearanceContext.Provider value={{ appearance, setAppearance }}>
      {children}
    </AppearanceContext.Provider>
  );
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribeToSystemAppearance(notify: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
}

/** The appearance in effect, with `system` resolved against the OS setting. */
export function useResolvedAppearance(): 'light' | 'dark' {
  const { appearance } = useAppearance();
  const systemDark = useSyncExternalStore(
    subscribeToSystemAppearance,
    () => window.matchMedia(DARK_QUERY).matches,
  );
  if (appearance === 'system') return systemDark ? 'dark' : 'light';
  return appearance;
}

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) {
    throw new Error('useAppearance must be used within ThemeProvider');
  }
  return value;
}
