import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { TimelineState, TimelineStep } from '../../lib/timeline';
import type { ReactElement } from 'react';

import { counter, duration } from '../../lib/format';
import { useElapsed } from '../../lib/use-elapsed';
import { cn } from '../../lib/utils';

const MARKER_CLASSES: Record<TimelineState, string> = {
  done: 'bg-success/15 text-success',
  failed: 'bg-destructive/15 text-destructive',
  running: 'bg-info/15 text-info',
  pending: 'border border-dashed text-muted-foreground',
  skipped: 'bg-muted text-muted-foreground',
};

type OutputProps = {
  label: string;
  text: string;
  error?: boolean;
  className?: string;
};

export const Output = ({ label, text, error = false, className }: OutputProps): ReactElement => (
  <div className={cn('flex flex-col gap-1', className)}>
    <span className="text-muted-foreground text-[10px] font-semibold tracking-[0.08em] uppercase">
      {label}
    </span>
    <pre
      className={cn(
        'bg-muted max-h-64 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap',
        error && 'text-destructive',
      )}
    >
      {text}
    </pre>
  </div>
);

export const Clock = ({ since }: { since: number }): ReactElement => (
  <>{counter(useElapsed(since))}</>
);

const RunningFor = ({ since }: { since: number }): ReactElement => {
  const { t } = useTranslation();
  return (
    <span className="text-info tabular-nums">
      {t('workflows.runs.state.running')} · <Clock since={since} />
    </span>
  );
};

type StepItemProps = {
  step: TimelineStep;
  index: number;
  last: boolean;
  final: boolean;
};

const STEP_ITEM_NAME = 'TimelineStep';

const StepItem = ({ step, index, last, final }: StepItemProps): ReactElement => {
  const { t } = useTranslation();
  // A step that finishes on screen, or turns out to hold the run's result, opens.
  const [open, setOpen] = useState(step.state !== 'done' || final);
  const [wasFinal, setWasFinal] = useState(final);
  if (final !== wasFinal) {
    setWasFinal(final);
    if (final) setOpen(true);
  }
  const finished = step.state === 'done' || step.state === 'failed';
  const label = (
    <span
      className={cn(
        'truncate text-xs font-medium',
        (step.state === 'pending' || step.state === 'skipped') && 'text-muted-foreground',
      )}
    >
      {t('workflows.runs.step', { id: step.id })}
    </span>
  );

  return (
    <li
      data-component={STEP_ITEM_NAME}
      data-step={step.id}
      data-state={step.state}
      className="relative pb-3 pl-8 last:pb-0"
    >
      {!last && <span aria-hidden className="bg-border absolute top-6 bottom-1 left-[10px] w-px" />}
      <span
        aria-hidden
        className={cn(
          'absolute top-0 left-0 flex size-[21px] items-center justify-center rounded-full text-[10px] font-semibold',
          MARKER_CLASSES[step.state],
        )}
      >
        {step.state === 'running' ? (
          <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
        ) : (
          index + 1
        )}
      </span>
      {finished ? (
        <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
          <summary className="flex cursor-pointer items-center gap-2 py-0.5">
            {label}
            <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
              {step.ms != null && duration(step.ms)}
            </span>
          </summary>
          <div className="motion-safe:animate-fade-in pt-1">
            {step.output != null && (
              <Output label={t('workflows.runs.output')} text={step.output} />
            )}
            {step.error != null && (
              <Output label={t('workflows.runs.error')} text={step.error} error />
            )}
          </div>
        </details>
      ) : (
        <div className="flex items-center gap-2 py-0.5">
          {label}
          <span className="text-muted-foreground ml-auto shrink-0 text-xs">
            {step.state === 'running' && step.since != null ? (
              <RunningFor since={step.since} />
            ) : (
              t(`workflows.runs.state.${step.state}`)
            )}
          </span>
        </div>
      )}
    </li>
  );
};

StepItem.displayName = STEP_ITEM_NAME;

export type RunTimelineProps = {
  steps: TimelineStep[];
  finished: boolean;
};

const RUN_TIMELINE_NAME = 'RunTimeline';

export const RunTimeline = ({ steps, finished }: RunTimelineProps): ReactElement => {
  const lastRecorded = steps.findLastIndex(
    (step) => step.state === 'done' || step.state === 'failed',
  );
  return (
    <ol data-component={RUN_TIMELINE_NAME} className="flex flex-col">
      {steps.map((step, index) => (
        <StepItem
          key={`${step.id}-${index}`}
          step={step}
          index={index}
          last={index === steps.length - 1}
          final={finished && index === lastRecorded}
        />
      ))}
    </ol>
  );
};

RunTimeline.displayName = RUN_TIMELINE_NAME;
