import { CircleCheck, CircleDashed, CircleX, LoaderCircle } from 'lucide-react';
import { useState } from 'react';

import type { RunStatus } from './shapes';
import type { ComponentProps, ReactElement, ReactNode } from 'react';

import { Button } from '../js/components/ui/button';
import { cn } from '../js/lib/utils';

const RUN_STATUS: Record<RunStatus, { label: string; className: string; icon: ReactElement }> = {
  running: {
    label: 'Running',
    className: 'text-info',
    icon: <LoaderCircle className="animate-spin" aria-hidden />,
  },
  done: { label: 'Done', className: 'text-success', icon: <CircleCheck aria-hidden /> },
  failed: { label: 'Failed', className: 'text-danger', icon: <CircleX aria-hidden /> },
  skipped: {
    label: 'Skipped',
    className: 'text-muted-foreground',
    icon: <CircleDashed aria-hidden />,
  },
};

type RunStatusLabelProps = { status: RunStatus; className?: string };

export const RunStatusLabel = ({ status, className }: RunStatusLabelProps): ReactElement => {
  const { label, className: tone, icon } = RUN_STATUS[status] ?? RUN_STATUS.skipped;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-medium whitespace-nowrap [&_svg]:size-3.5',
        tone,
        className,
      )}
    >
      {icon}
      {label}
    </span>
  );
};

type PillProps = { tone: 'success' | 'muted' | 'danger' | 'info'; children: ReactNode };

const PILL_TONES: Record<PillProps['tone'], string> = {
  success: 'bg-success-subtle text-success',
  muted: 'bg-muted text-muted-foreground',
  danger: 'bg-danger-subtle text-danger',
  info: 'bg-info-subtle text-info',
};

export const Pill = ({ tone, children }: PillProps): ReactElement => (
  <span
    className={cn(
      'inline-flex items-center rounded-full px-2 py-px text-xs font-medium whitespace-nowrap',
      PILL_TONES[tone],
    )}
  >
    {children}
  </span>
);

export const EnabledPill = ({ enabled }: { enabled: boolean }): ReactElement => (
  <Pill tone={enabled ? 'success' : 'muted'}>{enabled ? 'On' : 'Off'}</Pill>
);

// A row whose main area drills down; `actions` sit beside it, outside the button.
type RowProps = {
  onOpen?: () => void;
  label?: string;
  children: ReactNode;
  actions?: ReactNode;
};

export const Row = ({ onOpen, label, children, actions }: RowProps): ReactElement => (
  <li className="group flex items-center gap-2 border-b px-4 py-2.5 last:border-0">
    {onOpen == null ? (
      <div className="min-w-0 flex-1">{children}</div>
    ) : (
      <button
        type="button"
        aria-label={label}
        className="hover:bg-accent focus-visible:ring-ring -mx-2 min-w-0 flex-1 rounded-md px-2 py-1 text-left focus-visible:ring-2 focus-visible:outline-none"
        onClick={onOpen}
      >
        {children}
      </button>
    )}
    {actions != null && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
  </li>
);

export const Meta = ({ children }: { children: ReactNode }): ReactElement => (
  <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
    {children}
  </div>
);

export const Tag = ({ children }: { children: ReactNode }): ReactElement => (
  <span className="bg-muted text-muted-foreground inline-flex rounded px-1.5 font-mono text-[11px] leading-4 whitespace-nowrap">
    {children}
  </span>
);

export const Dot = (): ReactElement => (
  <span aria-hidden className="text-dimmed">
    ·
  </span>
);

export const Mono = ({ className, ...props }: ComponentProps<'span'>): ReactElement => (
  <span className={cn('font-mono text-[0.92em]', className)} {...props} />
);

export const Empty = ({ children }: { children: ReactNode }): ReactElement => (
  <p className="text-muted-foreground px-4 py-6 text-center text-sm">{children}</p>
);

type ShowMoreProps = { left: number; onMore: () => Promise<void> };

export const ShowMore = ({ left, onMore }: ShowMoreProps): ReactElement => {
  const [loading, setLoading] = useState(false);
  const more = () => {
    setLoading(true);
    void onMore().finally(() => setLoading(false));
  };
  return (
    <div className="flex justify-center p-2">
      <Button size="sm" variant="ghost" disabled={loading} onClick={more}>
        {loading ? 'Loading…' : `Show more (${left} left)`}
      </Button>
    </div>
  );
};

export const SectionLabel = ({ children }: { children: ReactNode }): ReactElement => (
  <h3 className="text-dimmed px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wider uppercase">
    {children}
  </h3>
);
