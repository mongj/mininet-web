import {
  createContext,
  useContext,
  useEffect,
  useState,
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

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) {
    throw new Error('useAppearance must be used within ThemeProvider');
  }
  return value;
}
