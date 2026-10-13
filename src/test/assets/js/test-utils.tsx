import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { GriegConfig } from '../../../main/resources/assets/js/lib/config';
import type { AnyRouter } from '@tanstack/react-router';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../../main/resources/assets/js/components/theme-provider';
import { routeTree } from '../../../main/resources/assets/js/routeTree.gen';

export function buildConfig(overrides?: Partial<GriegConfig>): GriegConfig {
  return {
    appId: 'com.enonic.app.grieg',
    assetsUri: '/assets',
    toolUri: '/',
    apiUris: {
      system: '/api/system',
      workflows: '/api/workflows',
      crons: '/api/crons',
      keys: '/api/keys',
    },
    mcpUri: 'http://localhost:8080/api/com.enonic.app.grieg:mcp',
    launcherUri: '/launcher',
    access: { admin: true, mcp: true },
    user: { key: 'user:system:su', displayName: 'Super User' },
    locale: 'en',
    phrases: {},
    ...overrides,
  };
}

type RenderRouteOptions = {
  initialLocation?: string;
  config?: GriegConfig;
};

type RenderRouteResult = {
  user: ReturnType<typeof userEvent.setup>;
  router: AnyRouter;
  queryClient: QueryClient;
};

export function renderRoute({
  initialLocation = '/',
  config = buildConfig(),
}: RenderRouteOptions = {}): RenderRouteResult {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient, config },
    basepath: config.toolUri,
    defaultPreloadStaleTime: 0,
    history: createMemoryHistory({ initialEntries: [initialLocation] }),
  });

  const Wrapper = (): ReactElement => (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  );

  const user = userEvent.setup();
  render(<Wrapper />);

  return { user, router, queryClient };
}

export { fireEvent, screen, waitFor, within };
