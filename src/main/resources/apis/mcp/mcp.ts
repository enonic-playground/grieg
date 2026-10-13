import { getToolUrl } from '/lib/xp/admin';

import type { Request, Response } from '@enonic-types/core';

import { checkAccess, originOf, type Rejection } from '../../lib/access';
import { getMcpConfig, type ToolsConfig } from '../../lib/config';
import { authenticate } from '../../lib/keys';
import { handle, selectTools, type HttpReply, type Server, type Tool } from '../../lib/mcp';
import { createNodeTools } from '../../lib/node-tools';
import { userKey } from '../../lib/run-as';
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
  if (rejection.status !== 401) {
    return toResponse({
      status: rejection.status,
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

let warnedToolsets = '';

// Config is read per request, so the warning is repeated only when the unknown names change.
function warnUnknownToolsets(unknown: string[]): void {
  const names = unknown.join(', ');
  if (names === warnedToolsets) return;
  warnedToolsets = names;
  if (names !== '') log.warning(`MCP ignores unknown toolsets in \`mcp.toolsets\`: ${names}`);
}

let warnedSharedToken = '';

// Logged once per `mcp.user` / `mcp.token` pair, so a config change warns again.
function warnSharedToken(config: ToolsConfig): void {
  const current = `${config.idProvider}:${config.user}:${config.token}`;
  if (current === warnedSharedToken) return;
  warnedSharedToken = current;
  log.warning(
    `MCP admitted a request through the deprecated shared \`mcp.token\`, acting as ${userKey(config)}; ` +
      'give each user a personal key instead and unset `mcp.token` and `mcp.user`',
  );
}

export function post(req: Request): Response {
  const origin = originOf(req.scheme, req.host, req.port);
  const access = checkAccess(
    {
      header: (name) => req.getHeader(name) ?? undefined,
      cookieNames: Object.keys(req.cookies ?? {}),
      origin,
      resolveKey: authenticate,
    },
    getMcpConfig(),
  );
  if ('rejection' in access) return deny(req, access.rejection);
  const { config } = access;
  if (config.credential === 'token') warnSharedToken(config);

  const toolsets: Record<string, Tool[]> = {
    content: createContentTools(config, contentStudioEditBase(origin, config.project)),
    nodes: createNodeTools(config),
  };
  warnUnknownToolsets(config.toolsets.filter((name) => !Object.hasOwn(toolsets, name)));
  const { tools, disabledTools } = selectTools(toolsets, config.toolsets, config.readOnly);

  const server: Server = {
    info: {
      name: app.name,
      title: 'Grieg',
      version: app.version,
      description: 'Enonic XP tools: search, read and update content and repository nodes',
    },
    instructions: serverInstructions(config),
    tools,
    disabledTools,
  };

  const reply = handle(
    { body: req.body, header: (name) => req.getHeader(name) ?? undefined },
    server,
  );
  return toResponse(reply);
}
