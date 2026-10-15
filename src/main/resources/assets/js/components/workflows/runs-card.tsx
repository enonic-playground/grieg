import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Run, RunStatus } from '../../lib/api/workflows';
import type { ReactElement } from 'react';

import { runsQueryOptions } from '../../lib/api/workflows';
import { formatDateTime } from '../../lib/expiry';
import { cn } from '../../lib/utils';
import { PageError, PageSkeleton } from '../page';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';

const RUN_COLUMNS = 'grid grid-cols-[5rem_5.5rem_minmax(0,1fr)_11rem_4rem] gap-3';

const STATUS_CLASSES: Record<RunStatus, string> = {
  running: 'text-info',
  done: 'text-success',
  failed: 'text-destructive',
  skipped: 'text-muted-foreground',
};

function formatDuration(run: Run): string {
  if (run.finishedAt == null) return '-';
  const ms = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

type OutputProps = {
  label: string;
  text: string;
  error?: boolean;
};

const Output = ({ label, text, error = false }: OutputProps): ReactElement => (
  <div className="flex flex-col gap-1">
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

type RunItemProps = {
  run: Run;
};

const RUN_ITEM_NAME = 'RunItem';

const RunItem = ({ run }: RunItemProps): ReactElement => {
  const { t, i18n } = useTranslation();
  // Owned here, so a panel stays as the user left it when its run finishes.
  const [open, setOpen] = useState(run.status === 'running');

  return (
    <li data-component={RUN_ITEM_NAME} className="border-b last:border-0">
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary
          className={cn(
            RUN_COLUMNS,
            'hover:bg-row-hover cursor-pointer items-center px-5 py-2 text-xs',
          )}
        >
          <span className={cn('font-mono font-semibold', STATUS_CLASSES[run.status])}>
            {t(`workflows.runs.status.${run.status}`)}
          </span>
          <Badge variant="outline" className="justify-self-start">
            {t(`workflows.runs.trigger.${run.trigger}`)}
          </Badge>
          <span className="truncate font-mono" title={run.user}>
            {run.user}
          </span>
          <span>{formatDateTime(run.startedAt, i18n.language)}</span>
          <span className="text-muted-foreground text-right font-mono">{formatDuration(run)}</span>
        </summary>
        <div className="flex flex-col gap-3 px-5 pb-4">
          {run.steps.map((step) => (
            <div key={step.id} className="flex flex-col gap-1">
              <span className="text-xs font-medium">
                {t('workflows.runs.step', { id: step.id })}{' '}
                <span className="text-muted-foreground font-mono">
                  {t('workflows.runs.stepMs', { ms: step.ms })}
                </span>
              </span>
              {step.output != null && (
                <Output label={t('workflows.runs.output')} text={step.output} />
              )}
              {step.error != null && (
                <Output label={t('workflows.runs.error')} text={step.error} error />
              )}
            </div>
          ))}
          {run.error != null && (
            <Output label={t('workflows.runs.runError')} text={run.error} error />
          )}
          {run.output != null && <Output label={t('workflows.runs.runOutput')} text={run.output} />}
        </div>
      </details>
    </li>
  );
};

RunItem.displayName = RUN_ITEM_NAME;

export type RunsCardProps = {
  workflowId: string;
};

const RUNS_CARD_NAME = 'RunsCard';

export const RunsCard = ({ workflowId }: RunsCardProps): ReactElement => {
  const { t } = useTranslation();
  const { data, isPending, error } = useQuery(runsQueryOptions(workflowId));

  const renderBody = (): ReactElement => {
    if (isPending) return <PageSkeleton />;
    if (error != null) return <PageError message={t('common.state.error')} />;
    if (data.length === 0) {
      return <p className="text-muted-foreground px-5 pb-5 text-sm">{t('workflows.runs.empty')}</p>;
    }

    return (
      <div>
        <div
          className={cn(
            RUN_COLUMNS,
            'bg-muted text-muted-foreground px-5 py-2 text-[10px] font-semibold tracking-[0.08em] uppercase',
          )}
        >
          <span>{t('workflows.runs.column.status')}</span>
          <span>{t('workflows.runs.column.trigger')}</span>
          <span>{t('workflows.runs.column.user')}</span>
          <span>{t('workflows.runs.column.started')}</span>
          <span className="text-right">{t('workflows.runs.column.duration')}</span>
        </div>
        <ul>
          {data.map((run) => (
            <RunItem key={run.id} run={run} />
          ))}
        </ul>
      </div>
    );
  };

  return (
    <Card data-component={RUNS_CARD_NAME}>
      <CardHeader className="p-5">
        <CardTitle className="text-sm">{t('workflows.runs.title')}</CardTitle>
        <CardDescription className="text-xs">{t('workflows.runs.description')}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">{renderBody()}</CardContent>
    </Card>
  );
};

RunsCard.displayName = RUNS_CARD_NAME;
