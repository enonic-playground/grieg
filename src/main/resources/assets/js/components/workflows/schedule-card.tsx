import { useMutation, useQueryClient } from '@tanstack/react-query';
import { rootRouteId, useRouteContext } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CronJob, ScheduleInput } from '../../lib/api/crons';
import type { ApiError } from '../../types/api';
import type { ScheduleDraft } from './use-schedule-draft';
import type { ReactElement } from 'react';

import {
  CRONS_QUERY_KEY,
  createSchedule,
  deleteSchedule,
  scheduleQueryKey,
  updateSchedule,
} from '../../lib/api/crons';
import { cn } from '../../lib/utils';
import { PageError, PageSkeleton } from '../page';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { inputClasses } from '../ui/input';
import { RelativeTime } from '../ui/relative-time';
import { same } from './use-schedule-draft';

const CRON_EXAMPLE = '0 2 * * *';

export type ScheduleCardProps = {
  workflowId: string;
  // `undefined` while loading, `null` when the workflow has no schedule.
  job: CronJob | null | undefined;
  failed: boolean;
  draft: ScheduleDraft;
};

const SCHEDULE_CARD_NAME = 'ScheduleCard';

export const ScheduleCard = ({
  workflowId,
  job,
  failed,
  draft,
}: ScheduleCardProps): ReactElement => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const uid = useId();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { config } = useRouteContext({ from: rootRouteId });
  // Saving re-owns the job, so an unchanged schedule owned by someone else can still be saved.
  const takeOver = job != null && job.user !== config.user?.key;

  const onSaved = (saved: CronJob | null): void => {
    queryClient.setQueryData(scheduleQueryKey(workflowId), saved);
    void queryClient.invalidateQueries({ queryKey: CRONS_QUERY_KEY, exact: true });
  };

  const save = useMutation({
    mutationFn: (input: ScheduleInput) =>
      job == null ? createSchedule(workflowId, input) : updateSchedule(job.name, input),
    onSuccess: onSaved,
  });

  const remove = useMutation({
    mutationFn: (name: string) => deleteSchedule(name),
    onSuccess: () => onSaved(null),
  });

  const runSave = (): void => {
    remove.reset();
    save.mutate({ ...draft.fields, cron: draft.fields.cron.trim() });
  };

  const runDelete = (): void => {
    if (job == null) return;
    save.reset();
    remove.mutate(job.name, { onSettled: () => setConfirmDelete(false) });
  };

  // A save error is about the fields it was sent with, so an edit since then hides it.
  const saveError =
    save.variables != null && same(save.variables, draft.fields) ? save.error : null;
  const error = (saveError ?? remove.error) as ApiError | null;

  const renderBody = (): ReactElement => {
    if (failed) return <PageError message={t('common.state.error')} />;
    if (job === undefined) return <PageSkeleton />;

    const { fields } = draft;
    const cronField = `${uid}-cron`;
    const timeZoneField = `${uid}-time-zone`;
    const enabledField = `${uid}-enabled`;
    const pending = save.isPending || remove.isPending;

    return (
      <>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex w-48 flex-col gap-1 text-xs" htmlFor={cronField}>
            <span className="text-muted-foreground">{t('workflows.schedule.field.cron')}</span>
            <input
              id={cronField}
              className={cn(inputClasses, 'font-mono')}
              value={fields.cron}
              placeholder={CRON_EXAMPLE}
              onChange={(event) => draft.change('cron', event.target.value)}
            />
          </label>
          <label className="flex w-56 flex-col gap-1 text-xs" htmlFor={timeZoneField}>
            <span className="text-muted-foreground">{t('workflows.schedule.field.timeZone')}</span>
            <input
              id={timeZoneField}
              className={cn(inputClasses, 'font-mono')}
              value={fields.timeZone}
              onChange={(event) => draft.change('timeZone', event.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 pb-1.5 text-xs" htmlFor={enabledField}>
            <input
              id={enabledField}
              type="checkbox"
              checked={fields.enabled}
              onChange={(event) => draft.change('enabled', event.target.checked)}
            />
            {t('workflows.schedule.field.enabled')}
          </label>
        </div>
        {job != null && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-xs">
            <dt className="text-muted-foreground">{t('workflows.schedule.field.user')}</dt>
            <dd>{job.user ?? '-'}</dd>
            <dt className="text-muted-foreground">{t('workflows.schedule.field.lastRun')}</dt>
            <dd>
              {job.lastRun != null ? (
                <RelativeTime iso={job.lastRun} />
              ) : (
                t('workflows.schedule.never')
              )}
            </dd>
          </dl>
        )}
        <div className="flex items-center gap-2">
          {job != null && (
            <Button variant="destructive" onClick={() => setConfirmDelete(true)} disabled={pending}>
              {t('common.action.delete')}
            </Button>
          )}
          <div className="flex-1" />
          <span className="text-muted-foreground text-xs" aria-live="polite">
            {draft.dirty
              ? t('workflows.schedule.unsaved')
              : takeOver
                ? t('workflows.schedule.takeOver')
                : ''}
          </span>
          <Button onClick={draft.reset} disabled={!draft.dirty || pending}>
            {t('workflows.schedule.action.reset')}
          </Button>
          <Button
            variant="primary"
            onClick={runSave}
            disabled={(!draft.dirty && !takeOver) || fields.cron.trim() === '' || pending}
          >
            {t(job == null ? 'common.action.create' : 'common.action.save')}
          </Button>
        </div>
      </>
    );
  };

  return (
    <Card data-component={SCHEDULE_CARD_NAME}>
      <CardHeader className="p-5">
        <CardTitle className="text-sm">{t('workflows.schedule.title')}</CardTitle>
        <CardDescription className="text-xs">{t('workflows.schedule.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-5 pt-0">
        {renderBody()}
        {error != null && (
          <p role="alert" className="text-destructive text-xs">
            {error.message}
          </p>
        )}
      </CardContent>

      {confirmDelete && (
        <ConfirmDialog
          title={t('workflows.schedule.confirm.delete.title')}
          description={t('workflows.schedule.confirm.delete.description')}
          confirmLabel={t('common.action.delete')}
          pending={remove.isPending}
          onConfirm={runDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Card>
  );
};

ScheduleCard.displayName = SCHEDULE_CARD_NAME;
