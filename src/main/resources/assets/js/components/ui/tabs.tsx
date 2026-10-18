import * as TabsPrimitive from '@radix-ui/react-tabs';

import type { ComponentProps, ReactElement } from 'react';

import { cn } from '../../lib/utils';

export const Tabs = TabsPrimitive.Root;

//
// * TabsList
//

const TABS_LIST_NAME = 'TabsList';

export const TabsList = ({
  ref,
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>): ReactElement => {
  return (
    <TabsPrimitive.List
      ref={ref}
      data-component={TABS_LIST_NAME}
      className={cn('bg-muted inline-flex items-center gap-1 rounded-md border p-1', className)}
      {...props}
    />
  );
};

TabsList.displayName = TABS_LIST_NAME;

//
// * TabsTrigger
//

const TABS_TRIGGER_NAME = 'TabsTrigger';

export const TabsTrigger = ({
  ref,
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger>): ReactElement => {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      data-component={TABS_TRIGGER_NAME}
      className={cn(
        'text-muted-foreground ring-offset-background hover:text-foreground focus-visible:ring-ring inline-flex h-7 items-center justify-center gap-1.5 rounded px-3 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        'data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm',
        '[&_svg]:size-3.5 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
};

TabsTrigger.displayName = TABS_TRIGGER_NAME;

//
// * TabsContent
//

const TABS_CONTENT_NAME = 'TabsContent';

export const TabsContent = ({
  ref,
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Content>): ReactElement => {
  return (
    <TabsPrimitive.Content
      ref={ref}
      data-component={TABS_CONTENT_NAME}
      className={cn('focus-visible:outline-none', className)}
      {...props}
    />
  );
};

TabsContent.displayName = TABS_CONTENT_NAME;
