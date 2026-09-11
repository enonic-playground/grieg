import type { ComponentProps, ReactElement } from 'react';

import { cn } from '../../lib/utils';

const SKELETON_NAME = 'Skeleton';

export const Skeleton = ({ className, ...props }: ComponentProps<'div'>): ReactElement => {
  return (
    <div
      data-component={SKELETON_NAME}
      className={cn('bg-muted animate-pulse rounded-md', className)}
      {...props}
    />
  );
};

Skeleton.displayName = SKELETON_NAME;
