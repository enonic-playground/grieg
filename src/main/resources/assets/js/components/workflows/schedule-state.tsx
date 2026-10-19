import { useTranslation } from 'react-i18next';

import type { CronJob } from '../../lib/api/crons';
import type { ReactElement } from 'react';

import { describeCron } from '../../lib/cron';
import { cn } from '../../lib/utils';

export type ScheduleStateProps = {
  // `undefined` while loading, `null` when the workflow has no schedule.
  job: CronJob | null | undefined;
  className?: string;
};

const SCHEDULE_STATE_NAME = 'ScheduleState';

export const ScheduleState = ({ job, className }: ScheduleStateProps): ReactElement | null => {
  const { t } = useTranslation();

  const classes = cn('inline-flex min-w-0 items-center gap-1.5', className);

  if (job === undefined) return null;

  if (job === null) {
    return (
      <span data-component={SCHEDULE_STATE_NAME} className={cn(classes, 'text-muted-foreground')}>
        {t('workflows.schedule.state.none')}
      </span>
    );
  }

  const words = describeCron(job.cron);
  const when =
    words ?? (job.cron == null ? undefined : <span className="font-mono">{job.cron}</span>);
  const title = [job.cron, job.timeZone].filter(Boolean).join(' · ');

  return (
    <span data-component={SCHEDULE_STATE_NAME} className={classes} title={title || undefined}>
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          job.enabled ? 'bg-success' : 'bg-text-dimmed',
        )}
      />
      {job.enabled ? (
        <span className="truncate">{when ?? t('workflows.schedule.state.scheduled')}</span>
      ) : (
        <>
          <span>{t('workflows.schedule.state.paused')}</span>
          {when != null && <span className="text-muted-foreground truncate">{when}</span>}
        </>
      )}
    </span>
  );
};

ScheduleState.displayName = SCHEDULE_STATE_NAME;
