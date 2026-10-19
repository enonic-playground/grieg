import { getUser, hasRole } from '/lib/xp/auth';

import type { Request, Response } from '@enonic-types/core';

import { errorResponse, getParam, jsonResponse, requireAdmin } from '../../lib/api';
import { listGrants, revokeGrant, type Grant } from '../../lib/grants';
import { MCP_ROLE, MCP_ROLE_NAME } from '../../lib/keys';
import { clientName } from '../../lib/oauth';

// A grant id is half of a refresh token, so only its owner or an admin may ever see it.
type GrantInfo = {
  id: string;
  client: string;
  clientId: string;
  created: string;
  expires: string;
  lastUsed?: string;
};

type OwnedGrantInfo = GrantInfo & { owner: string };

// `expires` is when the grant stops working, which an idle refresh token can bring forward.
function toInfo({ id, redirectUri, clientId, created, ends, lastUsed }: Grant): GrantInfo {
  return { id, client: clientName(redirectUri), clientId, created, expires: ends, lastUsed };
}

function toOwnedInfo(grant: Grant): OwnedGrantInfo {
  return { owner: grant.owner, ...toInfo(grant) };
}

// The owner always comes from the session: no request parameter can name whose grants to act on.
function requireOwner(): string | Response {
  const user = getUser();
  if (user == null || !hasRole(MCP_ROLE_NAME)) {
    return errorResponse(403, `The ${MCP_ROLE} role is required`, 'FORBIDDEN');
  }
  return user.key;
}

// The ids in a list are half-credentials, so no cache may keep one.
function listResponse<T>(grants: T[]): Response {
  return { ...jsonResponse({ grants }), headers: { 'Cache-Control': 'no-store' } };
}

export function get(req: Request): Response {
  if (getParam(req, 'all') === 'true') {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;
    return listResponse(listGrants().map(toOwnedInfo));
  }

  const owner = requireOwner();
  if (typeof owner !== 'string') return owner;
  return listResponse(listGrants(owner).map(toInfo));
}

// `?id=` revokes one of the caller's grants; with `owner=`, an admin revokes that user's.
function handleDelete(req: Request): Response {
  const id = getParam(req, 'id');
  if (id == null || id === '') return errorResponse(400, 'Name the grant to revoke', 'BAD_REQUEST');

  const target = getParam(req, 'owner');
  if (target != null) {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;
    if (!revokeGrant(id, target)) return errorResponse(404, 'No such grant', 'NOT_FOUND');
    // The audit entry names the grant's owner, so this line is what records the admin.
    log.info(`${getUser()?.key ?? 'An admin'} revoked an OAuth grant of ${target}`);
    return jsonResponse({ revoked: true });
  }

  const owner = requireOwner();
  if (typeof owner !== 'string') return owner;
  if (!revokeGrant(id, owner)) return errorResponse(404, 'No such grant', 'NOT_FOUND');
  return jsonResponse({ revoked: true });
}

export { handleDelete as delete };
