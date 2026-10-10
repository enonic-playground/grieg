import { getToolUrl } from '/lib/xp/admin';

import type { Request, Response } from '@enonic-types/core';

import { checkAccess, originOf, type Rejection } from '../../lib/access';
import { getMcpConfig } from '../../lib/config';
import { handle, type HttpReply, type Server } from '../../lib/mcp';
import { createContentTools, serverInstructions } from '../../lib/tools';

const CONTENT_STUDIO = 'com.enonic.app.contentstudio';

function toResponse({ status, body }: HttpReply): Response {
  return body == null
    ? { status }
    : { status, contentType: 'application/json', body: JSON.stringify(body) };
}

// On the default port XP turns a 401, and an anonymous 403, into its login page, so the reason
// only reaches the log.
function deny(req: Request, rejection: Rejection): Response {
  log.warning(`MCP request from ${req.remoteAddress} rejected: ${rejection.reason}`);
  if (rejection.status === 403) {
    return toResponse({
      status: 403,
      body: { jsonrpc: '2.0', id: null, error: { code: -32_600, message: rejection.message } },
    });
  }
  return {
    status: 401,
    contentType: 'application/json',
    headers: { 'WWW-Authenticate': 'Bearer' },
    body: JSON.stringify({ status: 401, message: 'Unauthorized', code: 'UNAUTHORIZED' }),
  };
}

function contentStudioEditBase(origin: string, project: string): string {
  const toolUrl = getToolUrl(CONTENT_STUDIO, 'main');
  const absolute = toolUrl.startsWith('/') ? `${origin}${toolUrl}` : toolUrl;
  return `${absolute}/${project}/edit`;
}

export function post(req: Request): Response {
  const origin = originOf(req.scheme, req.host, req.port);
  const access = checkAccess(
    {
      header: (name) => req.getHeader(name) ?? undefined,
      cookieNames: Object.keys(req.cookies ?? {}),
      origin,
    },
    getMcpConfig(),
  );
  if ('rejection' in access) return deny(req, access.rejection);
  const { config } = access;

  const server: Server = {
    info: {
      name: app.name,
      title: 'Grieg',
      version: app.version,
      description: 'Enonic XP content tools: search, read and update content',
    },
    instructions: serverInstructions(config),
    tools: createContentTools(config, contentStudioEditBase(origin, config.project)),
  };

  const reply = handle(
    { body: req.body, header: (name) => req.getHeader(name) ?? undefined },
    server,
  );
  return toResponse(reply);
}
