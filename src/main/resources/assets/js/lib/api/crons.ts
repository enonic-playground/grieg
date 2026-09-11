import { queryOptions } from '@tanstack/react-query';

import { getConfig } from '../config';
import { apiFetch } from './client';

export type CronJob = {
  name: string;
  description?: string;
  enabled: boolean;
  cron?: string;
  timeZone?: string;
  descriptor: string;
  lastRun?: string;
};

type CronList = {
  jobs: CronJob[];
};

export function fetchCronJobs(): Promise<CronJob[]> {
  const { apiUris } = getConfig();
  return apiFetch<CronList>(apiUris.crons).then((result) => result.jobs);
}

export function cronJobsQueryOptions() {
  return queryOptions({
    queryKey: ['crons'],
    queryFn: fetchCronJobs,
  });
}
