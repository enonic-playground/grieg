import { useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import type { ReactElement } from 'react';

import { cn } from '../lib/utils';

const ROUTE_STATUS_KEYS: Record<string, string> = {
  '/workflows': 'statusBar.workflows',
  '/crons': 'statusBar.crons',
  '/system': 'statusBar.system',
};

function getStatusKey(pathname: string): string {
  for (const [route, key] of Object.entries(ROUTE_STATUS_KEYS)) {
    if (pathname.startsWith(route)) return key;
  }
  return 'statusBar.ready';
}

export type StatusBarProps = {
  className?: string;
};

const STATUS_BAR_NAME = 'StatusBar';

export const StatusBar = ({ className }: StatusBarProps): ReactElement => {
  const { t } = useTranslation();
  const routerState = useRouterState();
  const statusText = t(getStatusKey(routerState.location.pathname));

  const barClasses = cn('bg-primary flex h-6 shrink-0 items-center px-3.5', className);

  return (
    <div data-component={STATUS_BAR_NAME} className={barClasses}>
      <div className="flex items-center gap-1.5">
        <div className="size-1 rounded-full bg-white/55" />
        <span className="font-mono text-xs tracking-wide text-white/88">{statusText}</span>
      </div>
      <div className="flex-1" />
      <span className="font-mono text-xs tracking-wider text-white/45">{t('statusBar.role')}</span>
    </div>
  );
};

StatusBar.displayName = STATUS_BAR_NAME;
