import { getUser } from '/lib/xp/auth';

import type { Request, Response } from '@enonic-types/core';

import { errorResponse, getParam, jsonResponse, parseBody, requireAdmin } from '../../lib/api';
import { removeSchedule } from '../../lib/crons';
import { startRun } from '../../lib/run-start';
import { listRuns } from '../../lib/runs';
import { scheduleName } from '../../lib/schedule';
import { validateSteps } from '../../lib/steps';
import {
  createWorkflow,
  deleteWorkflow,
  getById,
  list,
  updateWorkflow,
  type Workflow,
  type WorkflowInput,
} from '../../lib/workflows';

function stepsError(steps: unknown): Response | undefined {
  if (steps === undefined) return undefined;
  const invalid = validateSteps(steps);
  if (invalid == null) return undefined;
  if (invalid.index < 0) return errorResponse(400, invalid.message, 'INVALID_STEPS');
  return errorResponse(400, `Step ${invalid.index + 1}: ${invalid.message}`, 'INVALID_STEPS', {
    step: { index: invalid.index, id: invalid.id },
  });
}

function startWorkflow(workflow: Workflow): Response {
  const started = startRun(workflow, getUser()?.key ?? 'user:system:anonymous');
  if (!started.ok) return errorResponse(500, started.message, 'TASK_FAILED');
  const { runId, taskId, status } = started;
  if (status !== 'running') return jsonResponse({ runId, status }, 200);
  return jsonResponse({ runId, taskId, status }, 202);
}

export function get(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const id = getParam(req, 'id');
  if (id == null) return jsonResponse({ workflows: list() });

  const workflow = getById(id);
  if (workflow == null) return errorResponse(404, `No workflow with id ${id}`, 'NOT_FOUND');
  if (getParam(req, 'runs') === 'true') return jsonResponse({ runs: listRuns(workflow) });
  return jsonResponse(workflow);
}

export function post(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const action = getParam(req, 'action');
  if (action === 'run') {
    const id = getParam(req, 'id');
    if (id == null) return errorResponse(400, 'Missing `id` parameter', 'BAD_REQUEST');
    const workflow = getById(id);
    if (workflow == null) return errorResponse(404, `No workflow with id ${id}`, 'NOT_FOUND');
    return startWorkflow(workflow);
  }
  if (action != null) return errorResponse(400, `Unknown action ${action}`, 'BAD_REQUEST');

  const input = parseBody<WorkflowInput>(req);
  if (input?.name == null) {
    return errorResponse(400, 'Body must be a JSON object with a `name`', 'BAD_REQUEST');
  }
  const invalid = stepsError(input.steps);
  if (invalid != null) return invalid;

  return jsonResponse(createWorkflow(input), 201);
}

export function put(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const id = getParam(req, 'id');
  if (id == null) return errorResponse(400, 'Missing `id` parameter', 'BAD_REQUEST');

  const input = parseBody<Partial<WorkflowInput>>(req);
  if (input == null) return errorResponse(400, 'Body must be a JSON object', 'BAD_REQUEST');
  const invalid = stepsError(input.steps);
  if (invalid != null) return invalid;

  const workflow = updateWorkflow(id, input);
  if (workflow == null) return errorResponse(404, `No workflow with id ${id}`, 'NOT_FOUND');
  return jsonResponse(workflow);
}

// Best effort: a schedule left behind fires into a missing workflow, which the task only logs.
function deleteSchedule(workflowId: string): void {
  const name = scheduleName(workflowId);
  try {
    removeSchedule(name);
  } catch {
    log.warning(`Scheduled job ${name} of a deleted workflow could not be deleted`);
  }
}

function handleDelete(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const id = getParam(req, 'id');
  if (id == null) return errorResponse(400, 'Missing `id` parameter', 'BAD_REQUEST');

  if (!deleteWorkflow(id)) return errorResponse(404, `No workflow with id ${id}`, 'NOT_FOUND');
  deleteSchedule(id);
  return jsonResponse({ id });
}

// `delete` is a keyword, so the handler is exported under an alias XP can look up.
export { handleDelete as delete };
