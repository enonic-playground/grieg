import { hasRole } from '/lib/xp/auth';

import type { Request, Response } from '@enonic-types/core';

//
// * Response Helpers
//

export function jsonResponse<T>(data: T, status = 200): Response {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify({ data }),
  };
}

export function errorResponse(status: number, message: string, code?: string): Response {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify({ status, message, code }),
  };
}

//
// * Request Helpers
//

export function getParam(req: Request, name: string): string | undefined {
  const value = req.params?.[name];
  if (value == null) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export function parseBody<T>(req: Request): T | undefined {
  if (req.body == null || req.body === '') return undefined;
  try {
    return JSON.parse(req.body) as T;
  } catch {
    return undefined;
  }
}

export function requireAdmin(): Response | undefined {
  if (!hasRole('system.admin')) {
    return errorResponse(403, 'Admin role required', 'FORBIDDEN');
  }
  return undefined;
}
