import { getVersion } from '/lib/xp/admin';

import type { Request, Response } from '@enonic-types/core';

import { jsonResponse, requireAdmin } from '../../lib/api';
import { getMcpConfig } from '../../lib/config';

type SystemInfo = {
  xpVersion: string;
  appName: string;
  appVersion: string;
  mcpKeys: boolean;
  mcpSharedToken: boolean;
  mcpProject: string;
  mcpBranch: string;
};

export function get(_req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const mcp = getMcpConfig();

  const info: SystemInfo = {
    xpVersion: getVersion(),
    appName: app.name,
    appVersion: app.version,
    mcpKeys: true,
    mcpSharedToken: mcp.token != null && mcp.user != null,
    mcpProject: mcp.project,
    mcpBranch: mcp.branch,
  };

  return jsonResponse(info);
}
