import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReactElement } from 'react';

import { Page, PageError, PageSkeleton } from '../components/page';
import { Badge } from '../components/ui/badge';
import { EmptyState } from '../components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { workflowsQueryOptions } from '../lib/api/workflows';

const WORKFLOWS_PAGE_NAME = 'WorkflowsPage';

const WorkflowsPage = (): ReactElement => {
  const { t } = useTranslation();
  const { data, isPending, error } = useQuery(workflowsQueryOptions());

  if (isPending) return <PageSkeleton />;
  if (error != null) return <PageError message={t('common.state.error')} />;

  if (data.length === 0) {
    return (
      <EmptyState
        icon={Workflow}
        title={t('workflows.empty.title')}
        description={t('workflows.empty.description')}
      />
    );
  }

  return (
    <Page data-component={WORKFLOWS_PAGE_NAME} className="p-0">
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
              <TableCell>{workflow.displayName}</TableCell>
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

export const Route = createFileRoute('/workflows')({
  component: WorkflowsPage,
});
