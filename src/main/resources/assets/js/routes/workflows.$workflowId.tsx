import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useBlocker } from '@tanstack/react-router';
import { ArrowLeft, Play } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { Workflow } from '../lib/api/workflows';
import type { ApiError } from '../types/api';
import type { ReactElement } from 'react';

import { Page, PageError, PageSkeleton } from '../components/page';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { RunsCard } from '../components/workflows/runs-card';
import { ScheduleCard } from '../components/workflows/schedule-card';
import { ScheduleState } from '../components/workflows/schedule-state';
import { StepsEditorCard } from '../components/workflows/steps-editor-card';
import { useScheduleDraft } from '../components/workflows/use-schedule-draft';
import { useStepsDraft } from '../components/workflows/use-steps-draft';
import { scheduleQueryOptions } from '../lib/api/crons';
import {
  runsQueryKey,
  runWorkflow,
  saveMutationKey,
  workflowQueryOptions,
} from '../lib/api/workflows';

type WorkflowDetailsProps = {
  workflow: Workflow;
};

const WORKFLOW_DETAILS_NAME = 'WorkflowDetails';

const WorkflowDetails = ({ workflow }: WorkflowDetailsProps): ReactElement => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const draft = useStepsDraft(workflow.steps);
  const saving = useIsMutating({ mutationKey: saveMutationKey(workflow.id) }) > 0;
  const scheduleQuery = useQuery(scheduleQueryOptions(workflow.id));
  const scheduleDraft = useScheduleDraft(scheduleQuery.data);

  const run = useMutation({
    mutationFn: () => runWorkflow(workflow.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: runsQueryKey(workflow.id) }),
  });

  const { dirty } = draft;
  const leaveDirty = dirty || scheduleDraft.dirty;
  // Stable while `leaveDirty` holds, so the blocker is not re-registered on every keystroke.
  const isDirty = useCallback(() => leaveDirty, [leaveDirty]);
  const blocker = useBlocker({
    shouldBlockFn: isDirty,
    enableBeforeUnload: isDirty,
    withResolver: true,
  });

  // A run always uses the saved steps, so running is offered only when they are what is shown.
  let runHint: string | undefined;
  if (dirty) runHint = t('workflows.run.hint.dirty');
  else if (workflow.steps.length === 0) runHint = t('workflows.run.hint.empty');

  const runError = (run.error as ApiError | null)?.message;

  return (
    <div data-component={WORKFLOW_DETAILS_NAME} className="flex flex-col gap-5">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-5">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-base font-semibold">{workflow.displayName}</h2>
              <ScheduleState job={scheduleQuery.data} className="text-xs" />
            </div>
            <span className="text-muted-foreground font-mono text-xs">{workflow.name}</span>
            {workflow.description != null && (
              <p className="text-muted-foreground text-xs">{workflow.description}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button
              variant="primary"
              onClick={() => run.mutate()}
              disabled={runHint != null || saving || run.isPending}
            >
              <Play />
              {t('workflows.action.run')}
            </Button>
            {runHint != null && <span className="text-muted-foreground text-xs">{runHint}</span>}
            {run.data?.status === 'skipped' && (
              <span role="status" className="text-warning text-xs">
                {t('workflows.run.skipped')}
              </span>
            )}
            {runError != null && (
              <span role="alert" className="text-destructive text-xs">
                {runError}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <StepsEditorCard workflowId={workflow.id} draft={draft} />
      <RunsCard workflow={workflow} />
      <ScheduleCard
        workflowId={workflow.id}
        job={scheduleQuery.data}
        failed={scheduleQuery.data === undefined && scheduleQuery.error != null}
        draft={scheduleDraft}
      />

      {blocker.status === 'blocked' && (
        <ConfirmDialog
          title={t('workflows.confirm.leave.title')}
          description={t('workflows.confirm.leave.description')}
          confirmLabel={t('workflows.confirm.leave.action')}
          onConfirm={blocker.proceed}
          onCancel={blocker.reset}
        />
      )}
    </div>
  );
};

WorkflowDetails.displayName = WORKFLOW_DETAILS_NAME;

const WORKFLOW_PAGE_NAME = 'WorkflowPage';

const WorkflowPage = (): ReactElement => {
  const { t } = useTranslation();
  const { workflowId } = Route.useParams();
  const { data, isPending, error } = useQuery(workflowQueryOptions(workflowId));

  const notFound = (error as ApiError | null)?.status === 404;

  const renderBody = (): ReactElement => {
    if (isPending) return <PageSkeleton />;
    // A failed background refetch keeps the cached workflow, so an unsaved draft survives it.
    if (data == null) {
      return <PageError message={t(notFound ? 'workflows.notFound' : 'common.state.error')} />;
    }
    // Keyed so another workflow starts from its own saved steps.
    return <WorkflowDetails key={data.id} workflow={data} />;
  };

  return (
    <Page data-component={WORKFLOW_PAGE_NAME} className="flex max-w-5xl flex-col gap-3">
      <Link
        to="/workflows"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 self-start text-xs"
      >
        <ArrowLeft className="size-3.5" />
        {t('workflows.action.back')}
      </Link>
      {renderBody()}
    </Page>
  );
};

WorkflowPage.displayName = WORKFLOW_PAGE_NAME;

export const Route = createFileRoute('/workflows/$workflowId')({
  component: WorkflowPage,
});
