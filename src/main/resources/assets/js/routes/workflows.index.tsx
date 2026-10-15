import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Plus, Workflow } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReactElement } from 'react';

import { Page, PageError, PageSkeleton } from '../components/page';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { EmptyState } from '../components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { CreateWorkflowCard } from '../components/workflows/create-workflow-card';
import { workflowsQueryOptions } from '../lib/api/workflows';

const WORKFLOWS_PAGE_NAME = 'WorkflowsPage';

const WorkflowsPage = (): ReactElement => {
  const { t } = useTranslation();
  const { data, isPending, error } = useQuery(workflowsQueryOptions());
  const [creating, setCreating] = useState(false);

  if (isPending) return <PageSkeleton />;
  if (error != null) return <PageError message={t('common.state.error')} />;

  const newButton = (
    <Button variant="primary" onClick={() => setCreating(true)}>
      <Plus />
      {t('workflows.action.new')}
    </Button>
  );
  const createCard = creating && (
    <div className="max-w-3xl p-5 pb-0">
      <CreateWorkflowCard onCancel={() => setCreating(false)} />
    </div>
  );

  if (data.length === 0) {
    return (
      <Page data-component={WORKFLOWS_PAGE_NAME} className="p-0">
        {createCard}
        <EmptyState
          icon={Workflow}
          title={t('workflows.empty.title')}
          description={t('workflows.empty.description')}
          action={!creating && newButton}
        />
      </Page>
    );
  }

  return (
    <Page data-component={WORKFLOWS_PAGE_NAME} className="p-0">
      {createCard}
      {!creating && <div className="flex justify-end px-5 pt-3 pb-2">{newButton}</div>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('workflows.column.name')}</TableHead>
            <TableHead>{t('workflows.column.steps')}</TableHead>
            <TableHead>{t('workflows.column.state')}</TableHead>
            <TableHead>{t('workflows.column.modified')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((workflow) => (
            <TableRow key={workflow.id}>
              <TableCell>
                <Link
                  to="/workflows/$workflowId"
                  params={{ workflowId: workflow.id }}
                  className="text-primary hover:underline"
                >
                  {workflow.displayName}
                </Link>
              </TableCell>
              <TableCell>{workflow.steps.length}</TableCell>
              <TableCell>
                <Badge variant={workflow.enabled ? 'default' : 'outline'}>
                  {t(workflow.enabled ? 'common.state.enabled' : 'common.state.disabled')}
                </Badge>
              </TableCell>
              <TableCell>{workflow.modifiedAt}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Page>
  );
};

WorkflowsPage.displayName = WORKFLOWS_PAGE_NAME;

export const Route = createFileRoute('/workflows/')({
  component: WorkflowsPage,
});
