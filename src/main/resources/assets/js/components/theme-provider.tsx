import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';

type Theme = 'light' | 'dark' | 'system';

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const STORAGE_KEY = 'grieg-theme';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  return 'system';
}

function applyTheme(theme: Theme): void {
  const resolved = theme === 'system' ? getSystemTheme() : theme;
  const root = document.documentElement;

  root.classList.remove('light', 'dark');
  root.classList.add(resolved);
}

//
// * ThemeProvider
//

export type ThemeProviderProps = {
  defaultTheme?: Theme;
  children?: ReactNode;
};

const THEME_PROVIDER_NAME = 'ThemeProvider';

export const ThemeProvider = ({
  defaultTheme = 'system',
  children,
}: ThemeProviderProps): ReactElement => {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme() ?? defaultTheme);

  const setTheme = (next: Theme): void => {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  };

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system') return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (): void => applyTheme('system');
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
};

ThemeProvider.displayName = THEME_PROVIDER_NAME;

//
// * useTheme
//

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context == null) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
