import type { PrincipalKey } from '@enonic-types/core';

// App config comes from $XP_HOME/config/com.enonic.app.grieg.cfg.

const DEFAULT_PROJECT = 'default';
const DEFAULT_BRANCH = 'draft';
const DEFAULT_PRINCIPAL = 'role:system.admin';

export type McpConfig = {
  token?: string;
  project: string;
  branch: string;
  principal: PrincipalKey;
};

function value(key: string): string | undefined {
  const raw = app.config[key];
  return raw == null || raw === '' ? undefined : raw;
}

export function getMcpConfig(): McpConfig {
  return {
    token: value('mcp.token'),
    project: value('mcp.project') ?? DEFAULT_PROJECT,
    branch: value('mcp.branch') ?? DEFAULT_BRANCH,
    principal: (value('mcp.principal') ?? DEFAULT_PRINCIPAL) as PrincipalKey,
  };
}
