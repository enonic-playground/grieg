import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { WorkflowStep } from '../../lib/api/workflows';
import type { ApiError } from '../../types/api';
import type { StepsDraft } from './use-steps-draft';
import type { ReactElement } from 'react';

import {
  saveMutationKey,
  updateWorkflow,
  WORKFLOWS_QUERY_KEY,
  workflowQueryKey,
} from '../../lib/api/workflows';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { inputClasses } from '../ui/input';
import { toSteps } from './use-steps-draft';

const PLACEHOLDER_EXAMPLE = '{{steps.<id>.output}}';

export type StepsEditorCardProps = {
  workflowId: string;
  draft: StepsDraft;
};

const STEPS_EDITOR_CARD_NAME = 'StepsEditorCard';

export const StepsEditorCard = ({ workflowId, draft }: StepsEditorCardProps): ReactElement => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const uid = useId();

  const save = useMutation({
    mutationKey: saveMutationKey(workflowId),
    mutationFn: (steps: WorkflowStep[]) => updateWorkflow(workflowId, { steps }),
    onSuccess: (workflow) => {
      queryClient.setQueryData(workflowQueryKey(workflowId), workflow);
      void queryClient.invalidateQueries({ queryKey: WORKFLOWS_QUERY_KEY, exact: true });
    },
  });

  const steps = toSteps(draft.steps);
  const error = save.error as ApiError | null;
  const stepIndex = error?.code === 'INVALID_STEPS' ? error.step?.index : undefined;
  // An edit may move or fix the step the error names, so show it only for the draft it was about.
  const showError = error != null && JSON.stringify(save.variables) === JSON.stringify(steps);

  const renderSteps = (): ReactElement => {
    if (draft.steps.length === 0) {
      return <p className="text-muted-foreground text-sm">{t('workflows.steps.empty')}</p>;
    }

    return (
      <ol className="flex flex-col gap-3">
        {draft.steps.map((step, index) => {
          const invalid = showError && stepIndex === index;
          const idField = `${uid}-${step.key}-id`;
          const promptField = `${uid}-${step.key}-prompt`;
          const modelField = `${uid}-${step.key}-model`;
          const errorId = `${uid}-${step.key}-error`;

          return (
            <li
              key={step.key}
              className={cn(
                'flex flex-col gap-2 rounded-md border p-3',
                invalid && 'border-destructive',
              )}
            >
              <div className="flex items-end gap-2">
                <span className="text-muted-foreground pb-1.5 font-mono text-xs">{index + 1}.</span>
                <label className="flex w-40 flex-col gap-1 text-xs" htmlFor={idField}>
                  <span className="text-muted-foreground">{t('workflows.steps.field.id')}</span>
                  <input
                    id={idField}
                    className={cn(inputClasses, 'font-mono')}
                    value={step.id}
                    onChange={(event) => draft.change(index, 'id', event.target.value)}
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1 text-xs" htmlFor={modelField}>
                  <span className="text-muted-foreground">{t('workflows.steps.field.model')}</span>
                  <input
                    id={modelField}
                    className={cn(inputClasses, 'font-mono')}
                    value={step.model}
                    placeholder={t('workflows.steps.placeholder.model')}
                    onChange={(event) => draft.change(index, 'model', event.target.value)}
                  />
                </label>
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t('workflows.steps.action.up')}
                    title={t('workflows.steps.action.up')}
                    disabled={index === 0}
                    onClick={() => draft.move(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t('workflows.steps.action.down')}
                    title={t('workflows.steps.action.down')}
                    disabled={index === draft.steps.length - 1}
                    onClick={() => draft.move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t('workflows.steps.action.remove')}
                    title={t('workflows.steps.action.remove')}
                    onClick={() => draft.remove(index)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <label className="flex flex-col gap-1 text-xs" htmlFor={promptField}>
                <span className="text-muted-foreground">{t('workflows.steps.field.prompt')}</span>
                <textarea
                  id={promptField}
                  rows={4}
                  className={cn(inputClasses, 'resize-y font-mono')}
                  value={step.prompt}
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid ? errorId : undefined}
                  onChange={(event) => draft.change(index, 'prompt', event.target.value)}
                />
              </label>
              {invalid && (
                <p id={errorId} role="alert" className="text-destructive text-xs">
                  {error.message}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    );
  };

  return (
    <Card data-component={STEPS_EDITOR_CARD_NAME}>
      <CardHeader className="p-5">
        <CardTitle className="text-sm">{t('workflows.steps.title')}</CardTitle>
        <CardDescription className="text-xs">
          {t('workflows.steps.description', { placeholder: PLACEHOLDER_EXAMPLE })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-5 pt-0">
        {renderSteps()}
        {showError && stepIndex == null && (
          <p role="alert" className="text-destructive text-xs">
            {error.message}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button onClick={draft.add}>
            <Plus />
            {t('workflows.steps.action.add')}
          </Button>
          <div className="flex-1" />
          <span className="text-muted-foreground text-xs" aria-live="polite">
            {draft.dirty ? t('workflows.steps.unsaved') : ''}
          </span>
          <Button onClick={draft.reset} disabled={!draft.dirty || save.isPending}>
            {t('workflows.steps.action.reset')}
          </Button>
          <Button
            variant="primary"
            onClick={() => save.mutate(steps)}
            disabled={!draft.dirty || save.isPending}
          >
            {t('common.action.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

StepsEditorCard.displayName = STEPS_EDITOR_CARD_NAME;
