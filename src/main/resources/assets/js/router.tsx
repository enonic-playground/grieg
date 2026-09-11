import { createRouter } from '@tanstack/react-router';

import type { GriegConfig } from './lib/config';
import type { QueryClient } from '@tanstack/react-query';

import { routeTree } from './routeTree.gen';

export type RouterContext = {
  queryClient: QueryClient;
  config: GriegConfig;
};

type CreateAppRouterOptions = {
  queryClient: QueryClient;
  config: GriegConfig;
};

export function createAppRouter({ queryClient, config }: CreateAppRouterOptions) {
  return createRouter({
    routeTree,
    context: { queryClient, config },
    basepath: config.toolUri,
    defaultPreloadStaleTime: 0,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
