import { useEffect } from 'react';

import type { RunDetail, RunStep, ToolResults } from '../shapes';
import type { ReactElement } from 'react';

import { cn } from '../../js/lib/utils';
import { useCard } from '../card-context';
import { Dot, Empty, Meta, Row, RunStatusLabel, SectionLabel, Tag } from '../components';
import { dateTime, duration, elapsed, relativeTime, shortUser } from '../format';

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

const StepItem = ({ step, index, last }: { step: RunStep; index: number; last: boolean }) => {
  const failed = step.error != null;
  return (
    <li className="relative pb-3 pl-7 last:pb-0">
      {!last && <span aria-hidden className="bg-border absolute top-5 bottom-0 left-[9px] w-px" />}
      <span
        aria-hidden
        className={cn(
          'absolute top-0.5 left-0 flex size-[19px] items-center justify-center rounded-full text-[10px] font-semibold',
          failed ? 'bg-danger-subtle text-danger' : 'bg-success-subtle text-success',
        )}
      >
        {index + 1}
      </span>
      <details open={failed}>
        <summary className="hover:text-foreground flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
          <span className="truncate font-mono text-xs font-medium">{step.id}</span>
          <span className="text-dimmed ml-auto shrink-0 text-xs tabular-nums">
            {duration(step.ms)}
          </span>
        </summary>
        {failed ? (
          <Output text={step.error ?? ''} error />
        ) : (
          step.output != null && <Output text={step.output} truncated={step.truncated} />
        )}
      </details>
    </li>
  );
};

function usePolling(run: RunDetail): void {
  const { refetch } = useCard();
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
  }, [refetch, status, workflowId, id]);
}

export const RunDetailView = ({ data }: { data: RunDetail }): ReactElement => {
  const { locale } = useCard();
  usePolling(data);
  const took = elapsed(data.startedAt, data.finishedAt);
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
          <Dot />
          <span title={data.user}>as {shortUser(data.user)}</span>
        </Meta>
        {runError != null && <Output text={runError} error />}
      </div>

      <SectionLabel>Steps</SectionLabel>
      {data.steps.length === 0 ? (
        <p className="text-muted-foreground px-4 text-xs">
          {data.status === 'running' ? 'Waiting for the first step…' : 'No steps ran.'}
        </p>
      ) : (
        <ol className="px-4">
          {data.steps.map((step, index) => (
            <StepItem
              key={`${step.id}-${index}`}
              step={step}
              index={index}
              last={index === data.steps.length - 1}
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
