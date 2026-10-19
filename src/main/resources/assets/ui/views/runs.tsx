import { LoaderCircle, RotateCcw, Stethoscope } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { TimelineState, TimelineStep } from '../../js/lib/timeline';
import type { RunDetail, ToolResults } from '../shapes';
import type { ReactElement } from 'react';

import { Button } from '../../js/components/ui/button';
import { counter, dateTime, duration, elapsed, relativeTime, shortUser } from '../../js/lib/format';
import { runTimeline } from '../../js/lib/timeline';
import { useElapsed } from '../../js/lib/use-elapsed';
import { cn } from '../../js/lib/utils';
import { useCard } from '../card-context';
import { Dot, Empty, Meta, Row, RunStatusLabel, SectionLabel, Tag } from '../components';

const POLL_MS = 3000;
// About two minutes; a longer run is left to the refresh button.
const MAX_POLLS = 40;

export const RunListView = ({ data }: { data: ToolResults['run_list'] }): ReactElement => {
  const { open, locale } = useCard();

  if (data.runs.length === 0) return <Empty>No runs yet.</Empty>;
  return (
    <ul>
      {data.runs.map((run) => {
        const took = elapsed(run.startedAt, run.finishedAt);
        return (
          <Row
            key={run.id}
            label={`Run ${run.id}`}
            onOpen={() =>
              open(
                'run_get',
                { workflowId: data.workflowId, runId: run.id },
                `Run ${relativeTime(run.startedAt, locale)}`,
              )
            }
          >
            <div className="flex items-center gap-2">
              <RunStatusLabel status={run.status} />
              <span
                className="text-muted-foreground truncate"
                title={dateTime(run.startedAt, locale)}
              >
                {relativeTime(run.startedAt, locale)}
              </span>
            </div>
            <Meta>
              <Tag>{run.trigger}</Tag>
              <span title={run.user}>as {shortUser(run.user)}</span>
              {took != null && (
                <>
                  <Dot />
                  <span>{took}</span>
                </>
              )}
            </Meta>
            {run.error != null && (
              <p className="text-danger mt-1 line-clamp-2 text-xs">{run.error}</p>
            )}
          </Row>
        );
      })}
    </ul>
  );
};

const Output = ({
  text,
  truncated,
  error,
}: {
  text: string;
  truncated?: boolean;
  error?: boolean;
}) => (
  <>
    <pre
      className={cn(
        'bg-muted mt-1.5 max-h-72 overflow-auto rounded-md px-2.5 py-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap',
        error === true && 'bg-danger-subtle text-danger',
      )}
    >
      {text}
    </pre>
    {truncated === true && (
      <p className="text-dimmed mt-1 text-xs">
        Cut to 4,000 characters; the admin tool shows it whole.
      </p>
    )}
  </>
);

const MARKER_CLASSES: Record<TimelineState, string> = {
  done: 'bg-success-subtle text-success',
  failed: 'bg-danger-subtle text-danger',
  running: 'bg-info-subtle text-info',
  pending: 'border border-dashed text-dimmed',
  skipped: 'bg-muted text-dimmed',
};

const STATE_LABELS: Record<TimelineState, string> = {
  done: 'Done',
  failed: 'Failed',
  running: 'Running',
  pending: 'Waiting',
  skipped: 'Not run',
};

const Clock = ({ since }: { since: number }): ReactElement => (
  <span className="tabular-nums">{counter(useElapsed(since))}</span>
);

const RunningFor = ({ since }: { since: number }): ReactElement => (
  <span className="text-info">
    {STATE_LABELS.running} · <Clock since={since} />
  </span>
);

type StepItemProps = { step: TimelineStep; index: number; last: boolean; final: boolean };

const StepItem = ({ step, index, last, final }: StepItemProps): ReactElement => {
  // A step that finishes on screen, or turns out to hold the run's result, opens.
  const [open, setOpen] = useState(step.state !== 'done' || final);
  const [wasFinal, setWasFinal] = useState(final);
  if (final !== wasFinal) {
    setWasFinal(final);
    if (final) setOpen(true);
  }
  const finished = step.state === 'done' || step.state === 'failed';
  const name = (
    <span
      className={cn(
        'truncate font-mono text-xs font-medium',
        !finished && step.state !== 'running' && 'text-dimmed',
      )}
    >
      {step.id}
    </span>
  );

  return (
    <li data-step={step.id} data-state={step.state} className="relative pb-3 pl-7 last:pb-0">
      {!last && <span aria-hidden className="bg-border absolute top-5 bottom-0 left-[9px] w-px" />}
      <span
        aria-hidden
        className={cn(
          'absolute top-0.5 left-0 flex size-[19px] items-center justify-center rounded-full text-[10px] font-semibold',
          MARKER_CLASSES[step.state],
        )}
      >
        {step.state === 'running' ? (
          <LoaderCircle className="size-3 motion-safe:animate-spin" />
        ) : (
          index + 1
        )}
      </span>
      {finished ? (
        <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
          <summary className="hover:text-foreground flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
            {name}
            <span className="text-dimmed ml-auto shrink-0 text-xs tabular-nums">
              {step.ms != null && duration(step.ms)}
            </span>
          </summary>
          <div className="motion-safe:animate-fade-in">
            {step.state === 'failed' ? (
              <Output text={step.error ?? ''} error />
            ) : (
              step.output != null && <Output text={step.output} truncated={step.truncated} />
            )}
          </div>
        </details>
      ) : (
        <div className="flex items-center gap-2">
          {name}
          <span className="text-dimmed ml-auto shrink-0 text-xs">
            {step.state === 'running' && step.since != null ? (
              <RunningFor since={step.since} />
            ) : (
              STATE_LABELS[step.state]
            )}
          </span>
        </div>
      )}
    </li>
  );
};

function usePolling(run: RunDetail): void {
  // A refresh starts a fresh round, so a run still going past the cap is not left frozen.
  const { refetch, refreshes } = useCard();
  const { status, workflowId, id } = run;

  useEffect(() => {
    if (status !== 'running') return undefined;
    let polls = 0;
    const timer = window.setInterval(() => {
      polls += 1;
      if (polls > MAX_POLLS) {
        window.clearInterval(timer);
        return;
      }
      if (document.visibilityState === 'hidden') return;
      void refetch('run_get', { workflowId, runId: id }, (_current, next) => next);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refetch, status, workflowId, id, refreshes]);
}

// Both go to Claude as a message, so a retry runs behind the host's approval prompt.
const RunActions = ({ run }: { run: RunDetail }): ReactElement => {
  const { ask } = useCard();
  const name = run.workflow.displayName;
  const subject = `the grieg workflow "${name}" (workflowId ${run.workflowId})`;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <Button
        size="sm"
        onClick={() =>
          ask(
            `Diagnose the failed run ${run.id} of ${subject}: read the run with run_get and the workflow with workflow_list, explain why it failed, and propose a fix.`,
            `diagnose run ${run.id} of "${name}"`,
          )
        }
      >
        <Stethoscope />
        Ask Claude to diagnose
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          ask(
            `Run ${subject} again with workflow_run; its run ${run.id} failed.`,
            `run "${name}" again`,
          )
        }
      >
        <RotateCcw />
        Retry
      </Button>
    </div>
  );
};

export const RunDetailView = ({ data }: { data: RunDetail }): ReactElement => {
  const { locale } = useCard();
  usePolling(data);
  const took = elapsed(data.startedAt, data.finishedAt);
  const steps = runTimeline(data, data.workflow);
  const finished = data.status !== 'running';
  const lastRecorded = data.steps.length - 1;
  // A run that failed in a step says `Step <id> failed: <error>`, which the step already shows.
  const runError = data.steps.some(
    (step) => step.error != null && data.error?.endsWith(step.error) === true,
  )
    ? null
    : data.error;

  return (
    <div className="pb-3">
      <div className="px-4 pt-3 pb-1">
        <div className="flex items-center gap-2 text-sm">
          <RunStatusLabel status={data.status} />
          <Tag>{data.trigger}</Tag>
        </div>
        <Meta>
          <span title={data.startedAt}>{dateTime(data.startedAt, locale)}</span>
          {took != null && (
            <>
              <Dot />
              <span>{took}</span>
            </>
          )}
          {data.status === 'running' && (
            <>
              <Dot />
              <Clock since={Date.parse(data.startedAt)} />
            </>
          )}
          <Dot />
          <span title={data.user}>as {shortUser(data.user)}</span>
        </Meta>
        {runError != null && <Output text={runError} error />}
        {data.status === 'failed' && <RunActions run={data} />}
      </div>

      <SectionLabel>Steps</SectionLabel>
      {steps.length === 0 ? (
        <p className="text-muted-foreground px-4 text-xs">
          {data.status === 'running' ? 'Waiting for the first step…' : 'No steps ran.'}
        </p>
      ) : (
        <ol className="px-4">
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
      )}

      {data.output != null && (
        <>
          <SectionLabel>Output</SectionLabel>
          <div className="px-4">
            <Output text={data.output} truncated={data.truncated} />
          </div>
        </>
      )}
    </div>
  );
};
