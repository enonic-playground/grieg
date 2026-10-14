import { getUser } from '/lib/xp/auth';
import { submitTask } from '/lib/xp/task';

import type { Request, Response } from '@enonic-types/core';

import { errorResponse, getParam, jsonResponse, parseBody, requireAdmin } from '../../lib/api';
import { RUN_TASK, claimRun, createRun, finishRun, listRuns } from '../../lib/runs';
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

function startRun(workflow: Workflow): Response {
  const user = getUser()?.key ?? 'user:system:anonymous';
  const run = createRun({ workflow, trigger: 'manual', user });
  if (run.status !== 'running') {
    return jsonResponse({ runId: run.id, status: run.status }, 200);
  }

  let taskId: string;
  try {
    taskId = submitTask({
      descriptor: RUN_TASK,
      config: { workflowId: workflow.id, runId: run.id },
    });
  } catch {
    finishRun(workflow, run.id, { status: 'failed', error: 'The run task could not be started' });
    log.error(`Workflow run ${run.id} could not be submitted`);
    return errorResponse(500, 'The run task could not be started', 'TASK_FAILED');
  }
  try {
    claimRun(run.id, taskId);
  } catch {
    log.warning(`Workflow run ${run.id} could not be stamped with its task`);
  }
  return jsonResponse({ runId: run.id, taskId, status: run.status }, 202);
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
    return startRun(workflow);
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

function handleDelete(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const id = getParam(req, 'id');
  if (id == null) return errorResponse(400, 'Missing `id` parameter', 'BAD_REQUEST');

  if (!deleteWorkflow(id)) return errorResponse(404, `No workflow with id ${id}`, 'NOT_FOUND');
  return jsonResponse({ id });
}

// `delete` is a keyword, so the handler is exported under an alias XP can look up.
export { handleDelete as delete };
