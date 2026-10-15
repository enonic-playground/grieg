import { getUser } from '/lib/xp/auth';
import { create, deleteJob, get as getJob, list as listJobs, modify } from '/lib/xp/scheduler';

import type { ScheduledJob, UserKey } from '/lib/xp/scheduler';
import type { Request, Response } from '@enonic-types/core';

import { errorResponse, getParam, jsonResponse, parseBody, requireAdmin } from '../../lib/api';
import { RUN_TASK } from '../../lib/runs';
import {
  DEFAULT_TIME_ZONE,
  scheduleInputError,
  scheduleName,
  type ScheduleInput,
} from '../../lib/schedule';
import { isTimeZone } from '../../lib/time-zone';
import { getById } from '../../lib/workflows';

type CronJob = {
  name: string;
  description?: string;
  enabled: boolean;
  cron?: string;
  timeZone?: string;
  descriptor: string;
  user?: string;
  workflowId?: string;
  lastRun?: string;
  lastTaskId?: string;
};

type CreateInput = ScheduleInput & { workflowId?: unknown };

function isWorkflowJob(job: ScheduledJob): boolean {
  return job.descriptor === RUN_TASK;
}

function toCronJob(job: ScheduledJob): CronJob {
  const workflowId = isWorkflowJob(job) ? job.config?.workflowId : undefined;
  return {
    name: job.name,
    description: job.description ?? undefined,
    enabled: job.enabled,
    cron: job.schedule.type === 'CRON' ? job.schedule.value : undefined,
    timeZone: job.schedule.type === 'CRON' ? job.schedule.timeZone : undefined,
    descriptor: job.descriptor,
    user: job.user ?? undefined,
    workflowId: typeof workflowId === 'string' ? workflowId : undefined,
    lastRun: job.lastRun ?? undefined,
    lastTaskId: job.lastTaskId ?? undefined,
  };
}

function inputError(input: unknown, required: boolean): Response | undefined {
  const invalid = scheduleInputError(input, required);
  if (invalid != null) return errorResponse(400, invalid, 'BAD_REQUEST');
  const { timeZone } = input as ScheduleInput;
  if (timeZone !== undefined && !isTimeZone(timeZone)) {
    return errorResponse(400, `Unknown time zone ${timeZone}`, 'INVALID_TIME_ZONE');
  }
  return undefined;
}

// Everything but the cron is checked before the scheduler is called, so a refusal naming the
// cron is the only one reported as the caller's mistake.
function schedulerError(e: unknown, name: string): Response {
  const message = e instanceof Error ? e.message : String(e);
  if (/cron/i.test(message)) {
    return errorResponse(400, 'The scheduler refused the cron expression', 'INVALID_CRON');
  }
  log.error(`Scheduled job ${name} could not be saved`);
  return errorResponse(500, 'The schedule could not be saved', 'SCHEDULE_FAILED');
}

function callerKey(): UserKey | undefined {
  return getUser()?.key as UserKey | undefined;
}

export function get(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const workflowId = getParam(req, 'workflowId');
  if (workflowId != null) {
    const job = getJob({ name: scheduleName(workflowId) });
    return jsonResponse(job == null || !isWorkflowJob(job) ? null : toCronJob(job));
  }

  const name = getParam(req, 'name');
  if (name == null) {
    return jsonResponse({ jobs: listJobs().map(toCronJob) });
  }

  const job = getJob({ name });
  if (job == null) return errorResponse(404, `No scheduled job named ${name}`, 'NOT_FOUND');
  return jsonResponse(toCronJob(job));
}

export function post(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const input = parseBody<CreateInput>(req);
  const workflowId = input?.workflowId;
  if (typeof workflowId !== 'string' || workflowId === '') {
    return errorResponse(400, 'Body must name a `workflowId`', 'BAD_REQUEST');
  }
  const invalid = inputError(input, true);
  if (invalid != null) return invalid;
  if (getById(workflowId) == null) {
    return errorResponse(404, `No workflow with id ${workflowId}`, 'NOT_FOUND');
  }

  const name = scheduleName(workflowId);
  if (getJob({ name }) != null) {
    return errorResponse(409, `Workflow ${workflowId} already has a schedule`, 'CONFLICT');
  }

  const { cron = '', timeZone = DEFAULT_TIME_ZONE, enabled = true } = input as ScheduleInput;
  try {
    const job = create({
      name,
      descriptor: RUN_TASK,
      config: { workflowId },
      schedule: { type: 'CRON', value: cron.trim(), timeZone },
      enabled,
      user: callerKey(),
    });
    return jsonResponse(toCronJob(job), 201);
  } catch (e) {
    return schedulerError(e, name);
  }
}

// A workflow schedule is re-owned by whoever saves it. Another application's job only toggles
// `enabled` and keeps its user, so a save here never makes it run as the calling admin.
export function put(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const name = getParam(req, 'name');
  if (name == null) return errorResponse(400, 'Missing `name` parameter', 'BAD_REQUEST');

  const input = parseBody<ScheduleInput>(req);
  const invalid = inputError(input, false);
  if (invalid != null) return invalid;
  const { cron, timeZone, enabled } = input as ScheduleInput;

  const existing = getJob({ name });
  if (existing == null) return errorResponse(404, `No scheduled job named ${name}`, 'NOT_FOUND');

  const own = isWorkflowJob(existing) && existing.schedule.type === 'CRON';
  if (!own && (cron !== undefined || timeZone !== undefined)) {
    return errorResponse(403, 'Only a workflow cron schedule can change its cron', 'FORBIDDEN');
  }

  const user = callerKey();
  try {
    const job = modify({
      name,
      editor: (current) => {
        const next = { ...current, enabled: enabled ?? current.enabled };
        if (!own || current.schedule.type !== 'CRON') return next;
        return {
          ...next,
          schedule: {
            type: 'CRON',
            value: cron?.trim() ?? current.schedule.value,
            timeZone: timeZone ?? current.schedule.timeZone,
          },
          user,
        };
      },
    });
    return jsonResponse(toCronJob(job));
  } catch (e) {
    return schedulerError(e, name);
  }
}

function handleDelete(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const name = getParam(req, 'name');
  if (name == null) return errorResponse(400, 'Missing `name` parameter', 'BAD_REQUEST');

  const job = getJob({ name });
  if (job == null) return errorResponse(404, `No scheduled job named ${name}`, 'NOT_FOUND');
  if (!isWorkflowJob(job)) {
    return errorResponse(403, 'Only a workflow schedule can be deleted here', 'FORBIDDEN');
  }

  deleteJob({ name });
  return jsonResponse({ name });
}

export { handleDelete as delete };
