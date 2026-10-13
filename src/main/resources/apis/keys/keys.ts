import { getUser, hasRole } from '/lib/xp/auth';

import type { Request, Response } from '@enonic-types/core';

import { errorResponse, getParam, jsonResponse, requireAdmin } from '../../lib/api';
import {
  deleteByOwner,
  findByOwner,
  generate,
  list,
  MCP_ROLE,
  MCP_ROLE_NAME,
  type GeneratedKey,
  type McpKey,
} from '../../lib/keys';
import { redactKeys } from '../../lib/text';

type KeyInfo = {
  display: string;
  created: string;
  expires: string;
  lastUsed?: string;
};

type OwnedKeyInfo = KeyInfo & { owner: string };

function toInfo({ display, created, expires, lastUsed }: McpKey): KeyInfo {
  return { display, created, expires, lastUsed };
}

function toOwnedInfo(key: McpKey): OwnedKeyInfo {
  return { owner: key.owner, ...toInfo(key) };
}

// The owner always comes from the session: no request parameter can name whose key to act on.
// Admins too need the role to hold a key of their own.
function requireOwner(): string | Response {
  const user = getUser();
  if (user == null || !hasRole(MCP_ROLE_NAME)) {
    return errorResponse(403, `The ${MCP_ROLE} role is required`, 'FORBIDDEN');
  }
  return user.key;
}

export function get(req: Request): Response {
  if (getParam(req, 'all') === 'true') {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;
    return jsonResponse({ keys: list().map(toOwnedInfo) });
  }

  const owner = requireOwner();
  if (typeof owner !== 'string') return owner;

  const key = findByOwner(owner);
  return jsonResponse(key == null ? null : toInfo(key));
}

// A cross-site form can POST with the session cookie but cannot send JSON without a CORS
// preflight, so requiring JSON stops another site from rotating the caller's key.
function isJson(req: Request): boolean {
  return req.contentType?.split(';')[0].trim().toLowerCase() === 'application/json';
}

// Generates or regenerates the caller's key. The plaintext is in this response only.
export function post(req: Request): Response {
  const owner = requireOwner();
  if (typeof owner !== 'string') return owner;
  if (!isJson(req)) {
    return errorResponse(415, 'Send the request as `application/json`', 'UNSUPPORTED_MEDIA_TYPE');
  }

  let generated: GeneratedKey;
  try {
    generated = generate(owner);
  } catch (e) {
    log.error(`Could not generate an MCP key for ${owner}: ${redactKeys(String(e))}`);
    return errorResponse(
      500,
      'Could not generate a key; the current key, if any, still works',
      'KEY_NOT_GENERATED',
    );
  }

  const { key, record } = generated;
  return {
    ...jsonResponse({ key, ...toInfo(record) }, 201),
    headers: { 'Cache-Control': 'no-store' },
  };
}

function handleDelete(req: Request): Response {
  const target = getParam(req, 'owner');
  if (target != null) {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;
    if (!deleteByOwner(target)) {
      return errorResponse(404, `No MCP key owned by ${target}`, 'NOT_FOUND');
    }
    log.info(`${getUser()?.key ?? 'An admin'} revoked the MCP key of ${target}`);
    return jsonResponse({ owner: target });
  }

  const owner = requireOwner();
  if (typeof owner !== 'string') return owner;
  if (!deleteByOwner(owner)) return errorResponse(404, 'You hold no MCP key', 'NOT_FOUND');
  return jsonResponse({ owner });
}

export { handleDelete as delete };
