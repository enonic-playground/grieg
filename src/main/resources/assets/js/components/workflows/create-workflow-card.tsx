import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApiError } from '../../types/api';
import type { FormEvent, ReactElement } from 'react';

import { createWorkflow, WORKFLOWS_QUERY_KEY, workflowQueryKey } from '../../lib/api/workflows';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { inputClasses } from '../ui/input';

export type CreateWorkflowCardProps = {
  onCancel: () => void;
};

const CREATE_WORKFLOW_CARD_NAME = 'CreateWorkflowCard';

export const CreateWorkflowCard = ({ onCancel }: CreateWorkflowCardProps): ReactElement => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const hintId = useId();
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');

  const create = useMutation({
    mutationFn: createWorkflow,
    onSuccess: (workflow) => {
      queryClient.setQueryData(workflowQueryKey(workflow.id), workflow);
      void queryClient.invalidateQueries({ queryKey: WORKFLOWS_QUERY_KEY, exact: true });
      void navigate({ to: '/workflows/$workflowId', params: { workflowId: workflow.id } });
    },
  });

  const createError = (create.error as ApiError | null)?.message;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = displayName.trim();
    create.mutate({ name: name.trim(), ...(trimmed !== '' && { displayName: trimmed }) });
  };

  return (
    <Card data-component={CREATE_WORKFLOW_CARD_NAME}>
      <CardHeader className="p-5">
        <CardTitle className="text-sm">{t('workflows.create.title')}</CardTitle>
        <CardDescription className="text-xs">{t('workflows.create.description')}</CardDescription>
      </CardHeader>
      <CardContent className="p-5 pt-0">
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 text-xs">
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground">{t('workflows.create.field.name')}</span>
                <input
                  className={cn(inputClasses, 'font-mono')}
                  value={name}
                  required
                  aria-describedby={hintId}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <span id={hintId} className="text-muted-foreground">
                {t('workflows.create.hint.name')}
              </span>
            </div>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">
                {t('workflows.create.field.displayName')}
              </span>
              <input
                className={inputClasses}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
          </div>
          {createError != null && (
            <p role="alert" className="text-destructive text-xs">
              {createError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={onCancel} disabled={create.isPending}>
              {t('common.action.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={create.isPending}>
              {t('common.action.create')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

CreateWorkflowCard.displayName = CREATE_WORKFLOW_CARD_NAME;
