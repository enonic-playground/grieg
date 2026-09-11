import type { Request, Response } from '@enonic-types/core';

import { getMcpConfig } from '../../lib/config';
import {
  dispatch,
  ErrorCode,
  failure,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from '../../lib/mcp';
import { CONTENT_TOOLS } from '../../lib/tools';

const BEARER_PREFIX = 'Bearer ';
const NO_CONTENT = 202;

function jsonRpc(payload: JsonRpcResponse | JsonRpcResponse[]): Response {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  };
}

function unauthorized(message: string): Response {
  return {
    status: 401,
    contentType: 'application/json',
    headers: { 'WWW-Authenticate': 'Bearer' },
    body: JSON.stringify({ status: 401, message, code: 'UNAUTHORIZED' }),
  };
}

// The descriptor lets everyone reach this endpoint, so the token is the only gate. An
// unset token disables the endpoint outright rather than leaving it open.
function checkToken(req: Request): Response | undefined {
  const { token } = getMcpConfig();
  if (token == null) {
    return unauthorized('MCP endpoint is disabled: set `mcp.token` in the app config');
  }

  const header = req.headers?.Authorization ?? req.headers?.authorization;
  if (header == null || !header.startsWith(BEARER_PREFIX)) {
    return unauthorized('Missing bearer token');
  }

  if (header.slice(BEARER_PREFIX.length) !== token) {
    return unauthorized('Invalid bearer token');
  }

  return undefined;
}

function handle(message: JsonRpcRequest): JsonRpcResponse | undefined {
  if (message?.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return failure(message?.id ?? null, ErrorCode.INVALID_REQUEST, 'Not a JSON-RPC 2.0 request');
  }

  return dispatch(message, CONTENT_TOOLS, { name: app.name, version: app.version });
}

export function post(req: Request): Response {
  const denied = checkToken(req);
  if (denied != null) return denied;

  let payload: JsonRpcRequest | JsonRpcRequest[];
  try {
    payload = JSON.parse(req.body ?? '');
  } catch {
    return jsonRpc(failure(null, ErrorCode.PARSE_ERROR, 'Body is not valid JSON'));
  }

  if (Array.isArray(payload)) {
    const responses = payload.map(handle).filter((r) => r != null);
    return responses.length === 0 ? { status: NO_CONTENT } : jsonRpc(responses);
  }

  const response = handle(payload);
  // Notifications carry no id and get no body.
  return response == null ? { status: NO_CONTENT } : jsonRpc(response);
}
