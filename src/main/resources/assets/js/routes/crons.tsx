import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReactElement } from 'react';

import { Page, PageError, PageSkeleton } from '../components/page';
import { Badge } from '../components/ui/badge';
import { EmptyState } from '../components/ui/empty-state';
import { RelativeTime } from '../components/ui/relative-time';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { cronJobsQueryOptions } from '../lib/api/crons';
import { workflowsQueryOptions } from '../lib/api/workflows';
import { describeCron } from '../lib/cron';
import { requireAdmin } from '../lib/guards';

const CRONS_PAGE_NAME = 'CronsPage';

const CronsPage = (): ReactElement => {
  const { t } = useTranslation();
  const { data, isPending, error } = useQuery(cronJobsQueryOptions());
  const workflows = useQuery(workflowsQueryOptions()).data;

  if (isPending) return <PageSkeleton />;
  if (error != null) return <PageError message={t('common.state.error')} />;

  if (data.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title={t('crons.empty.title')}
        description={t('crons.empty.description')}
      />
    );
  }

  return (
    <Page data-component={CRONS_PAGE_NAME} className="p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('crons.column.name')}</TableHead>
            <TableHead>{t('crons.column.cron')}</TableHead>
            <TableHead>{t('crons.column.descriptor')}</TableHead>
            <TableHead>{t('crons.column.user')}</TableHead>
            <TableHead>{t('crons.column.lastRun')}</TableHead>
            <TableHead>{t('crons.column.state')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((job) => {
            const workflowName = workflows?.find(
              (workflow) => workflow.id === job.workflowId,
            )?.displayName;
            const words = describeCron(job.cron);
            return (
              <TableRow key={job.name}>
                <TableCell>
                  {job.workflowId == null ? (
                    <span className="font-mono">{job.name}</span>
                  ) : (
                    <Link
                      to="/workflows/$workflowId"
                      params={{ workflowId: job.workflowId }}
                      className="text-primary hover:underline"
                      title={job.name}
                    >
                      {workflowName ?? job.name}
                    </Link>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span>{words ?? <span className="font-mono">{job.cron ?? '-'}</span>}</span>
                    <span className="text-muted-foreground">
                      {words != null && <span className="font-mono">{job.cron}</span>}
                      {words != null && job.timeZone != null && ' · '}
                      {job.timeZone}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="font-mono">{job.descriptor}</TableCell>
                <TableCell>{job.user ?? '-'}</TableCell>
                <TableCell>
                  {job.lastRun != null ? <RelativeTime iso={job.lastRun} /> : '-'}
                </TableCell>
                <TableCell>
                  <Badge variant={job.enabled ? 'default' : 'outline'}>
                    {t(job.enabled ? 'common.state.enabled' : 'common.state.disabled')}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Page>
  );
};

CronsPage.displayName = CRONS_PAGE_NAME;

export const Route = createFileRoute('/crons')({
  beforeLoad: requireAdmin,
  component: CronsPage,
});
