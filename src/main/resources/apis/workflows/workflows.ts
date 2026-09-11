import type { Request, Response } from '@enonic-types/core';

import { errorResponse, getParam, jsonResponse, parseBody, requireAdmin } from '../../lib/api';
import {
  createWorkflow,
  deleteWorkflow,
  getById,
  list,
  updateWorkflow,
  type WorkflowInput,
} from '../../lib/workflows';

export function get(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const id = getParam(req, 'id');
  if (id == null) return jsonResponse({ workflows: list() });

  const workflow = getById(id);
  if (workflow == null) return errorResponse(404, `No workflow with id ${id}`, 'NOT_FOUND');
  return jsonResponse(workflow);
}

export function post(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const input = parseBody<WorkflowInput>(req);
  if (input?.name == null) {
    return errorResponse(400, 'Body must be a JSON object with a `name`', 'BAD_REQUEST');
  }

  return jsonResponse(createWorkflow(input), 201);
}

export function put(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const id = getParam(req, 'id');
  if (id == null) return errorResponse(400, 'Missing `id` parameter', 'BAD_REQUEST');

  const input = parseBody<Partial<WorkflowInput>>(req);
  if (input == null) return errorResponse(400, 'Body must be a JSON object', 'BAD_REQUEST');

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
