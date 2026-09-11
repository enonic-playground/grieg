import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

import type { RouterContext } from '../router';
import type { ReactElement } from 'react';

import { Header } from '../components/header';
import { Sidebar } from '../components/sidebar';
import { StatusBar } from '../components/status-bar';

const ROOT_LAYOUT_NAME = 'RootLayout';

const RootLayout = (): ReactElement => {
  return (
    <div
      data-component={ROOT_LAYOUT_NAME}
      className="bg-background text-foreground flex h-screen flex-col"
    >
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
      <StatusBar />
    </div>
  );
};

RootLayout.displayName = ROOT_LAYOUT_NAME;

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});
