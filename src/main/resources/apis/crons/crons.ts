import { getUser } from '/lib/xp/auth';

import type { UserKey } from '/lib/xp/scheduler';
import type { Request, Response } from '@enonic-types/core';

import { errorResponse, getParam, jsonResponse, parseBody, requireAdmin } from '../../lib/api';
import {
  createSchedule,
  getCron,
  getWorkflowSchedule,
  listCrons,
  removeSchedule,
  updateJob,
  type CronErrorCode,
  type CronOutcome,
} from '../../lib/crons';

const STATUS: Record<CronErrorCode, number> = {
  BAD_REQUEST: 400,
  INVALID_TIME_ZONE: 400,
  INVALID_CRON: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  FORBIDDEN: 403,
  SCHEDULE_FAILED: 500,
};

function toResponse<T>(outcome: CronOutcome<T>, status = 200): Response {
  if (!outcome.ok) return errorResponse(STATUS[outcome.code], outcome.message, outcome.code);
  return jsonResponse(outcome.value, status);
}

function callerKey(): UserKey | undefined {
  return getUser()?.key as UserKey | undefined;
}

export function get(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const workflowId = getParam(req, 'workflowId');
  if (workflowId != null) return jsonResponse(getWorkflowSchedule(workflowId) ?? null);

  const name = getParam(req, 'name');
  if (name == null) return jsonResponse({ jobs: listCrons() });
  return toResponse(getCron(name));
}

export function post(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const input = parseBody<{ workflowId?: unknown }>(req);
  const workflowId = input?.workflowId;
  if (typeof workflowId !== 'string' || workflowId === '') {
    return errorResponse(400, 'Body must name a `workflowId`', 'BAD_REQUEST');
  }
  return toResponse(createSchedule(workflowId, input, callerKey()), 201);
}

export function put(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const name = getParam(req, 'name');
  if (name == null) return errorResponse(400, 'Missing `name` parameter', 'BAD_REQUEST');
  return toResponse(updateJob(name, parseBody(req), callerKey()));
}

function handleDelete(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const name = getParam(req, 'name');
  if (name == null) return errorResponse(400, 'Missing `name` parameter', 'BAD_REQUEST');
  return toResponse(removeSchedule(name));
}

export { handleDelete as delete };
