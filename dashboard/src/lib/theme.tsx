import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Theme selection for the developer console.
 *
 *   'light'  — force light tokens, ignore the OS
 *   'dark'   — force dark tokens, ignore the OS
 *   'system' — follow prefers-color-scheme (default)
 *
 * Storage key matches the inline boot script in index.html, which reads
 * the preference BEFORE React mounts and sets data-theme on <html> so
 * there's no flash of the wrong palette.
 */
export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'zeroauth.theme';

interface ThemeContextValue {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice: (next: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch { /* localStorage blocked */ }
  return 'system';
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyToDom(choice: ThemeChoice): ResolvedTheme {
  const root = document.documentElement;
  if (choice === 'system') {
    root.removeAttribute('data-theme');
    return systemPrefersDark() ? 'dark' : 'light';
  }
  root.setAttribute('data-theme', choice);
  return choice;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => readStoredChoice());
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    choice === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : choice,
  );

  // Apply on mount + when the choice changes.
  useEffect(() => {
    setResolved(applyToDom(choice));
    try { localStorage.setItem(STORAGE_KEY, choice); } catch { /* storage blocked */ }
  }, [choice]);

  // Track OS preference flips while 'system' is selected.
  useEffect(() => {
    if (choice !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => setResolved(systemPrefersDark() ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => setChoiceState(next), []);

  const value = useMemo<ThemeContextValue>(() => ({ choice, resolved, setChoice }), [choice, resolved, setChoice]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

/**
 * Returns the URL of the brand mark for the currently-resolved theme,
 * relative to Vite's BASE_URL so it works in both dev (`/dashboard/`)
 * and prod (mounted under `/dashboard/`).
 */
export function useBrandMarkUrl(): string {
  const { resolved } = useTheme();
  const base = import.meta.env.BASE_URL || '/';
  return `${base.replace(/\/$/, '')}/${resolved === 'dark' ? 'zeroauth-mark-dark.svg' : 'zeroauth-mark.svg'}`;
}
