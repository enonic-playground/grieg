import type { LucideIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { cn } from '../../lib/utils';

export type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  className?: string;
};

const EMPTY_STATE_NAME = 'EmptyState';

export const EmptyState = ({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps): ReactElement => {
  return (
    <div
      data-component={EMPTY_STATE_NAME}
      className={cn('flex flex-col items-center justify-center py-12 text-center', className)}
    >
      <Icon className="text-muted-foreground mb-4 size-12" />
      <h3 className="text-foreground mb-1 text-lg font-semibold">{title}</h3>
      <p className="text-muted-foreground mb-4 max-w-sm text-sm">{description}</p>
      {action != null && action}
    </div>
  );
};

EmptyState.displayName = EMPTY_STATE_NAME;
