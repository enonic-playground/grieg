import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { CalendarClock } from 'lucide-react';
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
import { cronJobsQueryOptions } from '../lib/api/crons';

const CRONS_PAGE_NAME = 'CronsPage';

const CronsPage = (): ReactElement => {
  const { t } = useTranslation();
  const { data, isPending, error } = useQuery(cronJobsQueryOptions());

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
            <TableHead>{t('crons.column.lastRun')}</TableHead>
            <TableHead>{t('crons.column.state')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((job) => (
            <TableRow key={job.name}>
              <TableCell>{job.name}</TableCell>
              <TableCell>{job.cron ?? '-'}</TableCell>
              <TableCell>{job.descriptor}</TableCell>
              <TableCell>{job.lastRun ?? '-'}</TableCell>
              <TableCell>
                <Badge variant={job.enabled ? 'default' : 'outline'}>
                  {t(job.enabled ? 'common.state.enabled' : 'common.state.disabled')}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Page>
  );
};

CronsPage.displayName = CRONS_PAGE_NAME;

export const Route = createFileRoute('/crons')({
  component: CronsPage,
});
