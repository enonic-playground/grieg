import { get as getJob, list as listJobs, modify } from '/lib/xp/scheduler';

import type { ScheduledJob } from '/lib/xp/scheduler';
import type { Request, Response } from '@enonic-types/core';

import { errorResponse, getParam, jsonResponse, parseBody, requireAdmin } from '../../lib/api';

type CronJob = {
  name: string;
  description?: string;
  enabled: boolean;
  cron?: string;
  timeZone?: string;
  descriptor: string;
  lastRun?: string;
  lastTaskId?: string;
};

function toCronJob(job: ScheduledJob | null): CronJob | undefined {
  if (job == null) return undefined;
  return {
    name: job.name,
    description: job.description ?? undefined,
    enabled: job.enabled,
    cron: job.schedule.type === 'CRON' ? job.schedule.value : undefined,
    timeZone: job.schedule.type === 'CRON' ? job.schedule.timeZone : undefined,
    descriptor: job.descriptor,
    lastRun: job.lastRun ?? undefined,
    lastTaskId: job.lastTaskId ?? undefined,
  };
}

export function get(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const name = getParam(req, 'name');
  if (name == null) {
    return jsonResponse({ jobs: listJobs().map(toCronJob) });
  }

  const job = toCronJob(getJob({ name }));
  if (job == null) return errorResponse(404, `No scheduled job named ${name}`, 'NOT_FOUND');
  return jsonResponse(job);
}

// Only `enabled` is writable for now: creating jobs needs a task descriptor, which arrives
// with the workflow runner.
export function put(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const name = getParam(req, 'name');
  if (name == null) return errorResponse(400, 'Missing `name` parameter', 'BAD_REQUEST');

  const input = parseBody<{ enabled?: boolean }>(req);
  if (typeof input?.enabled !== 'boolean') {
    return errorResponse(400, 'Body must be `{ "enabled": boolean }`', 'BAD_REQUEST');
  }

  const enabled = input.enabled;
  const job = toCronJob(
    modify({
      name,
      editor: (current) => ({ ...current, enabled }),
    }),
  );

  if (job == null) return errorResponse(404, `No scheduled job named ${name}`, 'NOT_FOUND');
  return jsonResponse(job);
}
