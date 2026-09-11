// ? Only loaded in jsdom tests (per-file annotation), but setup runs for all environments.
// Guards ensure these mocks are no-ops in node environment.

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

afterEach(cleanup);

if (typeof window !== 'undefined') {
  // ThemeProvider calls window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });

  // jsdom 28 uses Node.js built-in localStorage which lacks standard methods
  if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') {
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      writable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, String(value)),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear(),
        get length() {
          return store.size;
        },
        key: (index: number) => [...store.keys()][index] ?? null,
      },
    });
  }
}
