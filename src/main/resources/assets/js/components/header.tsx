import { useQuery } from '@tanstack/react-query';
import { Link, useMatch, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import type { ReactElement } from 'react';

import { workflowQueryOptions } from '../lib/api/workflows';
import { cn } from '../lib/utils';
import { ThemeToggle } from './theme-toggle';

const ROUTE_TITLE_KEYS: Record<string, string> = {
  '/workflows': 'nav.workflows',
  '/crons': 'nav.crons',
  '/system': 'nav.system',
  '/mcp': 'nav.mcp',
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
  const workflowId = useMatch({ from: '/workflows/$workflowId', shouldThrow: false })?.params
    .workflowId;
  // Shares the page's query, so the name costs no extra request.
  const workflow = useQuery({
    ...workflowQueryOptions(workflowId ?? ''),
    enabled: workflowId != null,
  }).data;

  const pageTitle = t(getPageTitleKey(routerState.location.pathname));

  const headerClasses = cn(
    'border-border bg-card flex h-12 shrink-0 items-center justify-between border-b px-5',
    className,
  );

  return (
    <header data-component={HEADER_NAME} className={headerClasses}>
      {workflow == null ? (
        <h1 className="text-foreground text-sm font-semibold">{pageTitle}</h1>
      ) : (
        <nav aria-label={t('nav.breadcrumb')} className="flex min-w-0 items-center gap-2 text-sm">
          <Link to="/workflows" className="text-muted-foreground hover:text-foreground shrink-0">
            {pageTitle}
          </Link>
          <span aria-hidden className="text-text-dimmed">
            /
          </span>
          <h1 className="text-foreground truncate font-semibold">{workflow.displayName}</h1>
        </nav>
      )}
      <ThemeToggle />
    </header>
  );
};

Header.displayName = HEADER_NAME;
