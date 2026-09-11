import { cva, type VariantProps } from 'class-variance-authority';

import type { ComponentProps, ReactElement } from 'react';

import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center whitespace-nowrap rounded border border-transparent px-1.5 py-0.5 font-medium font-mono text-[10px] tracking-[0.04em]',
  {
    variants: {
      variant: {
        default: 'bg-secondary text-secondary-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        destructive: 'bg-destructive text-destructive-foreground',
        outline: 'border-border text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export type BadgeProps = ComponentProps<'div'> & VariantProps<typeof badgeVariants>;

const BADGE_NAME = 'Badge';

export const Badge = ({ className, variant, ...props }: BadgeProps): ReactElement => {
  return (
    <div
      data-component={BADGE_NAME}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
};

Badge.displayName = BADGE_NAME;

export { badgeVariants };
