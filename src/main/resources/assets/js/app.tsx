import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';

import type { ReactElement } from 'react';

import { ThemeProvider } from './components/theme-provider';
import { getConfig } from './lib/config';
import './lib/i18n';
import { createAppRouter } from './router';

const STALE_TIME_MS = 30_000;
const MAX_RETRIES = 1;

const config = getConfig();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_TIME_MS,
      retry: MAX_RETRIES,
    },
  },
});

const router = createAppRouter({ queryClient, config });

const APP_NAME = 'App';

const App = (): ReactElement => {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  );
};

App.displayName = APP_NAME;

const container = document.getElementById('app');

if (container) {
  createRoot(container).render(<App />);
}
