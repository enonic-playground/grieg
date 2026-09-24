import { getToolUrl } from '/lib/xp/admin';

import type { Request, Response } from '@enonic-types/core';

import { getMcpConfig, type McpConfig } from '../../lib/config';
import { handle, safeEqual, type HttpReply, type Server } from '../../lib/mcp';
import { createContentTools, serverInstructions } from '../../lib/tools';

const BEARER_PREFIX = 'Bearer ';
const CONTENT_STUDIO = 'com.enonic.app.contentstudio';

function toResponse({ status, body }: HttpReply): Response {
  return body == null
    ? { status }
    : { status, contentType: 'application/json', body: JSON.stringify(body) };
}

// XP swaps the body of a 401 for its login page, so the reason only reaches the log.
function unauthorized(req: Request, reason: string): Response {
  log.warning(`MCP request from ${req.remoteAddress} rejected: ${reason}`);
  return {
    status: 401,
    contentType: 'application/json',
    headers: { 'WWW-Authenticate': 'Bearer' },
    body: JSON.stringify({ status: 401, message: 'Unauthorized', code: 'UNAUTHORIZED' }),
  };
}

// The descriptor lets everyone reach this endpoint, so the token is the only gate. An
// unset token disables the endpoint outright rather than leaving it open.
function checkToken(req: Request, config: McpConfig): Response | undefined {
  if (config.token == null) {
    return unauthorized(req, 'endpoint is disabled, set `mcp.token` in the app config');
  }

  const header = req.getHeader('Authorization');
  if (header == null || !header.startsWith(BEARER_PREFIX)) {
    return unauthorized(req, 'missing bearer token');
  }
  if (!safeEqual(header.slice(BEARER_PREFIX.length), config.token)) {
    return unauthorized(req, 'invalid bearer token');
  }
  return undefined;
}

function checkOrigin(req: Request, config: McpConfig): Response | undefined {
  const origin = req.getHeader('Origin');
  if (origin == null || config.allowedOrigins.includes(origin)) return undefined;

  log.warning(`MCP request rejected: Origin '${origin}' is not in \`mcp.allowedOrigins\``);
  return toResponse({
    status: 403,
    body: { jsonrpc: '2.0', error: { code: -32_600, message: `Origin not allowed: ${origin}` } },
  });
}

function contentStudioEditBase(req: Request, project: string): string {
  const toolUrl = getToolUrl(CONTENT_STUDIO, 'main');
  const isDefaultPort =
    (req.scheme === 'http' && req.port === 80) || (req.scheme === 'https' && req.port === 443);
  const origin = `${req.scheme}://${req.host}${isDefaultPort ? '' : `:${req.port}`}`;
  const absolute = toolUrl.startsWith('/') ? `${origin}${toolUrl}` : toolUrl;
  return `${absolute}/${project}/edit`;
}

export function post(req: Request): Response {
  const config = getMcpConfig();

  const denied = checkOrigin(req, config) ?? checkToken(req, config);
  if (denied != null) return denied;

  const server: Server = {
    info: {
      name: app.name,
      title: 'Grieg',
      version: app.version,
      description: 'Enonic XP content tools: search, read and update content',
    },
    instructions: serverInstructions(config),
    tools: createContentTools(config, contentStudioEditBase(req, config.project)),
  };

  const reply = handle(
    { body: req.body, header: (name) => req.getHeader(name) ?? undefined },
    server,
  );
  return toResponse(reply);
}
