import * as SeparatorPrimitive from '@radix-ui/react-separator';

import type { ComponentProps, ReactElement } from 'react';

import { cn } from '../../lib/utils';

const SEPARATOR_NAME = 'Separator';

export const Separator = ({
  ref,
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: ComponentProps<typeof SeparatorPrimitive.Root>): ReactElement => {
  return (
    <SeparatorPrimitive.Root
      ref={ref}
      data-component={SEPARATOR_NAME}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'bg-border shrink-0',
        orientation === 'horizontal' ? 'h-[1px] w-full' : 'h-full w-[1px]',
        className,
      )}
      {...props}
    />
  );
};

Separator.displayName = SEPARATOR_NAME;
