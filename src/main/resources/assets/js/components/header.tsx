import { useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import type { ReactElement } from 'react';

import { cn } from '../lib/utils';
import { ThemeToggle } from './theme-toggle';

const ROUTE_TITLE_KEYS: Record<string, string> = {
  '/workflows': 'nav.workflows',
  '/crons': 'nav.crons',
  '/system': 'nav.system',
};

function getPageTitleKey(pathname: string): string {
  for (const [route, key] of Object.entries(ROUTE_TITLE_KEYS)) {
    if (pathname.startsWith(route)) return key;
  }
  return 'common.appName';
}

export type HeaderProps = {
  className?: string;
};

const HEADER_NAME = 'Header';

export const Header = ({ className }: HeaderProps): ReactElement => {
  const { t } = useTranslation();
  const routerState = useRouterState();
  const pageTitle = t(getPageTitleKey(routerState.location.pathname));

  const headerClasses = cn(
    'border-border bg-card flex h-12 shrink-0 items-center justify-between border-b px-5',
    className,
  );

  return (
    <header data-component={HEADER_NAME} className={headerClasses}>
      <h1 className="text-foreground text-sm font-semibold">{pageTitle}</h1>
      <ThemeToggle />
    </header>
  );
};

Header.displayName = HEADER_NAME;
