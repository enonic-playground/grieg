import { getToolUrl } from '/lib/xp/admin';

import type { Request, Response } from '@enonic-types/core';

import { checkAccess, originOf, type Rejection } from '../../lib/access';
import { getMcpConfig, type ToolsConfig } from '../../lib/config';
import { authenticate, isAdmin } from '../../lib/keys';
import { handle, selectTools, type HttpReply, type Server, type Tool } from '../../lib/mcp';
import { createNodeTools } from '../../lib/node-tools';
import { userKey } from '../../lib/run-as';
import { createContentTools, serverInstructions } from '../../lib/tools';
import { ADMIN_ROLE, createWorkflowTools, WORKFLOWS_TOOLSET } from '../../lib/workflow-tools';

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

function adminToolUrl(origin: string, application: string): string {
  const toolUrl = getToolUrl(application, 'main');
  return toolUrl.startsWith('/') ? `${origin}${toolUrl}` : toolUrl;
}

function contentStudioEditBase(origin: string, project: string): string {
  return `${adminToolUrl(origin, CONTENT_STUDIO)}/${project}/edit`;
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
      isAdmin,
    },
    getMcpConfig(),
  );
  if ('rejection' in access) return deny(req, access.rejection);
  const { config } = access;
  if (config.credential === 'token') warnSharedToken(config);

  const toolsets: Record<string, Tool[]> = {
    content: createContentTools(config, contentStudioEditBase(origin, config.project)),
    nodes: createNodeTools(config),
    [WORKFLOWS_TOOLSET]: createWorkflowTools(config, adminToolUrl(origin, app.name)),
  };
  warnUnknownToolsets(config.toolsets.filter((name) => !Object.hasOwn(toolsets, name)));
  const selection = selectTools(toolsets, config.toolsets, config.readOnly);
  const { disabledTools } = selection;
  const adminOnly = new Set(
    config.admin ? [] : toolsets[WORKFLOWS_TOOLSET].map((tool) => tool.name),
  );
  for (const { name } of selection.tools.filter((tool) => adminOnly.has(tool.name))) {
    disabledTools[name] = `${name} requires ${ADMIN_ROLE}, which ${userKey(config)} does not hold.`;
  }
  const tools = selection.tools.filter(({ name }) => !adminOnly.has(name));

  const server: Server = {
    info: {
      name: app.name,
      title: 'Grieg',
      version: app.version,
      description:
        'Enonic XP tools: search, read and update content and repository nodes, and run and schedule workflows',
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
