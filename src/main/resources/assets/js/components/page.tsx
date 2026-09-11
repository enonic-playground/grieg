import type { ComponentProps, ReactElement } from 'react';

import { cn } from '../lib/utils';
import { Skeleton } from './ui/skeleton';

export type PageProps = ComponentProps<'div'>;

const PAGE_NAME = 'Page';

export const Page = ({ children, className, ...props }: PageProps): ReactElement => {
  return (
    <div data-component={PAGE_NAME} className={cn('p-5', className)} {...props}>
      {children}
    </div>
  );
};

Page.displayName = PAGE_NAME;

//
// * PageSkeleton
//

const PAGE_SKELETON_NAME = 'PageSkeleton';

export const PageSkeleton = (): ReactElement => {
  return (
    <div data-component={PAGE_SKELETON_NAME} className="flex flex-col gap-2 p-5">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-2/3" />
    </div>
  );
};

PageSkeleton.displayName = PAGE_SKELETON_NAME;

//
// * PageError
//

export type PageErrorProps = {
  message: string;
};

const PAGE_ERROR_NAME = 'PageError';

export const PageError = ({ message }: PageErrorProps): ReactElement => {
  return (
    <div data-component={PAGE_ERROR_NAME} className="text-destructive p-5 text-sm">
      {message}
    </div>
  );
};

PageError.displayName = PAGE_ERROR_NAME;
