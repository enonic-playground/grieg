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
  // The user the job runs as; for a workflow schedule, the admin who last saved it.
  user?: string;
  // Set only on a workflow schedule.
  workflowId?: string;
  lastRun?: string;
};

export type ScheduleInput = {
  cron: string;
  timeZone: string;
  enabled: boolean;
};

type CronList = {
  jobs: CronJob[];
};

export const CRONS_QUERY_KEY = ['crons'] as const;

export function scheduleQueryKey(workflowId: string) {
  return [...CRONS_QUERY_KEY, 'workflow', workflowId] as const;
}

export function fetchCronJobs(): Promise<CronJob[]> {
  const { apiUris } = getConfig();
  return apiFetch<CronList>(apiUris.crons).then((result) => result.jobs);
}

export function fetchSchedule(workflowId: string): Promise<CronJob | null> {
  return apiFetch<CronJob | null>(getConfig().apiUris.crons, { params: { workflowId } });
}

export function createSchedule(workflowId: string, input: ScheduleInput): Promise<CronJob> {
  return apiFetch<CronJob>(getConfig().apiUris.crons, {
    method: 'POST',
    body: { workflowId, ...input },
  });
}

export function updateSchedule(name: string, input: ScheduleInput): Promise<CronJob> {
  return apiFetch<CronJob>(getConfig().apiUris.crons, {
    method: 'PUT',
    params: { name },
    body: input,
  });
}

export function deleteSchedule(name: string): Promise<{ name: string }> {
  return apiFetch<{ name: string }>(getConfig().apiUris.crons, {
    method: 'DELETE',
    params: { name },
  });
}

export function cronJobsQueryOptions() {
  return queryOptions({
    queryKey: CRONS_QUERY_KEY,
    queryFn: fetchCronJobs,
  });
}

export function scheduleQueryOptions(workflowId: string) {
  return queryOptions({
    queryKey: scheduleQueryKey(workflowId),
    queryFn: () => fetchSchedule(workflowId),
  });
}
