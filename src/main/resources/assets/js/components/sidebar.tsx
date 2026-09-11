import { Link, useRouterState } from '@tanstack/react-router';
import { CalendarClock, PanelRightClose, PanelRightOpen, Settings, Workflow } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';

import { cn } from '../lib/utils';

type NavItem = {
  to: string;
  labelKey: string;
  icon: LucideIcon;
};

const NAV_ITEMS: NavItem[] = [
  { to: '/workflows', labelKey: 'nav.workflows', icon: Workflow },
  { to: '/crons', labelKey: 'nav.crons', icon: CalendarClock },
  { to: '/system', labelKey: 'nav.system', icon: Settings },
];

// ? 45px = 44px content + 1px border-right. Gives exactly size-8 (32px) buttons
// ? with px-1.5 (6px) padding on each side: 6 + 32 + 6 = 44.
const COLLAPSED_WIDTH = 'w-[45px]';

export type SidebarProps = {
  className?: string;
};

const SIDEBAR_NAME = 'Sidebar';

export const Sidebar = ({ className }: SidebarProps): ReactElement => {
  const [collapsed, setCollapsed] = useState(false);
  const { t } = useTranslation();

  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  const sidebarClasses = cn(
    'border-border bg-card flex h-full flex-col border-r',
    'transition-[width] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]',
    collapsed ? COLLAPSED_WIDTH : 'w-48',
    className,
  );

  const iconButtonClasses = cn(
    'flex size-8 shrink-0 items-center justify-center rounded-md',
    'text-muted-foreground transition-colors',
    'hover:bg-accent hover:text-accent-foreground',
  );

  return (
    <aside data-component={SIDEBAR_NAME} className={sidebarClasses}>
      {/* Header: logo + brand + collapse toggle */}
      <div className="border-border flex h-12 shrink-0 items-center gap-2 overflow-hidden border-b px-1.5">
        {!collapsed && (
          <>
            <div className="bg-primary size-5 shrink-0 rounded" />
            <span className="text-foreground flex-1 truncate text-sm font-bold tracking-tight">
              {t('common.appName')}
            </span>
          </>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          className={iconButtonClasses}
          aria-label={collapsed ? t('nav.sidebar.expand') : t('nav.sidebar.collapse')}
          title={collapsed ? t('common.action.expand') : t('common.action.collapse')}
        >
          {collapsed ? (
            <PanelRightClose className="size-4" />
          ) : (
            <PanelRightOpen className="size-4" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col gap-px overflow-x-hidden overflow-y-auto px-1.5 py-2">
        {NAV_ITEMS.map((item) => {
          const isActive = currentPath.startsWith(item.to);
          const Icon = item.icon;
          const label = t(item.labelKey);

          const linkClasses = cn(
            'flex items-center rounded-md text-xs',
            'overflow-hidden transition-colors',
            collapsed ? 'size-8 justify-center' : 'h-8 gap-2 px-2',
            isActive
              ? 'bg-accent text-foreground font-medium'
              : 'text-muted-foreground hover:bg-row-hover',
          );

          return (
            <Link
              key={item.to}
              to={item.to}
              className={linkClasses}
              title={collapsed ? label : undefined}
            >
              <Icon
                className={cn('size-4 shrink-0', isActive ? 'text-primary' : 'text-text-dimmed')}
              />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
};

Sidebar.displayName = SIDEBAR_NAME;
