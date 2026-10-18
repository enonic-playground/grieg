// Shared by `apis/crons` and the MCP cron tools; callers check that the caller is an admin.

import { create, deleteJob, get as getJob, list as listJobs, modify } from '/lib/xp/scheduler';

import type { ScheduledJob, UserKey } from '/lib/xp/scheduler';

import { RUN_TASK } from './runs';
import {
  DEFAULT_TIME_ZONE,
  scheduleInputError,
  scheduleName,
  type ScheduleInput,
} from './schedule';
import { isTimeZone } from './time-zone';
import { getById } from './workflows';

export type CronJob = {
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

export type CronErrorCode =
  | 'BAD_REQUEST'
  | 'INVALID_TIME_ZONE'
  | 'INVALID_CRON'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'SCHEDULE_FAILED';

export type CronOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; code: CronErrorCode; message: string };

function failure(code: CronErrorCode, message: string): CronOutcome<never> {
  return { ok: false, code, message };
}

function isWorkflowJob(job: ScheduledJob): boolean {
  return job.descriptor === RUN_TASK;
}

export function toCronJob(job: ScheduledJob): CronJob {
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

function inputError(input: unknown, required: boolean): CronOutcome<never> | undefined {
  const invalid = scheduleInputError(input, required);
  if (invalid != null) return failure('BAD_REQUEST', invalid);
  const { timeZone } = input as ScheduleInput;
  if (timeZone !== undefined && !isTimeZone(timeZone)) {
    return failure('INVALID_TIME_ZONE', `Unknown time zone ${timeZone}`);
  }
  return undefined;
}

// Everything but the cron is checked before the scheduler is called, so a refusal naming the
// cron is the only one reported as the caller's mistake.
function schedulerError(e: unknown, name: string): CronOutcome<never> {
  const message = e instanceof Error ? e.message : String(e);
  if (/cron/i.test(message)) {
    return failure('INVALID_CRON', 'The scheduler refused the cron expression');
  }
  log.error(`Scheduled job ${name} could not be saved`);
  return failure('SCHEDULE_FAILED', 'The schedule could not be saved');
}

export function listCrons(): CronJob[] {
  return listJobs().map(toCronJob);
}

export function getCron(name: string): CronOutcome<CronJob> {
  const job = getJob({ name });
  if (job == null) return failure('NOT_FOUND', `No scheduled job named ${name}`);
  return { ok: true, value: toCronJob(job) };
}

export function getWorkflowSchedule(workflowId: string): CronJob | undefined {
  const job = getJob({ name: scheduleName(workflowId) });
  return job == null || !isWorkflowJob(job) ? undefined : toCronJob(job);
}

export function createSchedule(
  workflowId: string,
  input: unknown,
  user: UserKey | undefined,
): CronOutcome<CronJob> {
  const invalid = inputError(input, true);
  if (invalid != null) return invalid;
  if (getById(workflowId) == null) {
    return failure('NOT_FOUND', `No workflow with id ${workflowId}`);
  }

  const name = scheduleName(workflowId);
  if (getJob({ name }) != null) {
    return failure('CONFLICT', `Workflow ${workflowId} already has a schedule`);
  }

  const { cron = '', timeZone = DEFAULT_TIME_ZONE, enabled = true } = input as ScheduleInput;
  try {
    const job = create({
      name,
      descriptor: RUN_TASK,
      config: { workflowId },
      schedule: { type: 'CRON', value: cron.trim(), timeZone },
      enabled,
      user,
    });
    return { ok: true, value: toCronJob(job) };
  } catch (e) {
    return schedulerError(e, name);
  }
}

// A workflow schedule is re-owned by whoever saves it. Another application's job only toggles
// `enabled` and keeps its user, so a save here never makes it run as the calling admin.
export function updateJob(
  name: string,
  input: unknown,
  user: UserKey | undefined,
): CronOutcome<CronJob> {
  const invalid = inputError(input, false);
  if (invalid != null) return invalid;
  const { cron, timeZone, enabled } = input as ScheduleInput;

  const existing = getJob({ name });
  if (existing == null) return failure('NOT_FOUND', `No scheduled job named ${name}`);

  const own = isWorkflowJob(existing) && existing.schedule.type === 'CRON';
  if (!own && (cron !== undefined || timeZone !== undefined)) {
    return failure('FORBIDDEN', 'Only a workflow cron schedule can change its cron');
  }

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
    return { ok: true, value: toCronJob(job) };
  } catch (e) {
    return schedulerError(e, name);
  }
}

export function saveWorkflowSchedule(
  workflowId: string,
  input: unknown,
  user: UserKey | undefined,
): CronOutcome<CronJob> {
  const name = scheduleName(workflowId);
  const existing = getJob({ name });
  if (existing == null) return createSchedule(workflowId, input, user);
  if (!isWorkflowJob(existing)) {
    return failure('CONFLICT', `The job ${name} belongs to another application`);
  }
  return updateJob(name, input, user);
}

export function removeSchedule(name: string): CronOutcome<{ name: string }> {
  const job = getJob({ name });
  if (job == null) return failure('NOT_FOUND', `No scheduled job named ${name}`);
  if (!isWorkflowJob(job)) {
    return failure('FORBIDDEN', 'Only a workflow schedule can be deleted here');
  }

  deleteJob({ name });
  return { ok: true, value: { name } };
}
