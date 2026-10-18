import { Check } from 'lucide-react';

import type { ReactElement, ReactNode } from 'react';

import { cn } from '../../lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';

export type StepCardProps = {
  name: string;
  step: number;
  title: string;
  description: ReactNode;
  done?: boolean;
  children: ReactNode;
};

const STEP_CARD_NAME = 'StepCard';

export const StepCard = ({
  name,
  step,
  title,
  description,
  done = false,
  children,
}: StepCardProps): ReactElement => {
  return (
    <Card data-component={name} data-step={step} data-done={done || undefined}>
      <CardHeader className="flex-row items-start gap-3 space-y-0 p-5">
        <span
          aria-hidden="true"
          className={cn(
            'mt-px flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-semibold transition-colors',
            done
              ? 'border-success bg-success text-white'
              : 'border-primary/40 bg-accent-muted text-primary',
          )}
        >
          {done ? <Check className="size-3.5" strokeWidth={3} /> : step}
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <CardTitle className="text-sm">{title}</CardTitle>
          <CardDescription className="text-xs">{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-5 pt-0 sm:pl-14">{children}</CardContent>
    </Card>
  );
};

StepCard.displayName = STEP_CARD_NAME;
