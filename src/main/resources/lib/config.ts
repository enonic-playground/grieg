// App config comes from $XP_HOME/config/com.enonic.app.grieg.cfg.

const DEFAULT_PROJECT = 'default';
const DEFAULT_BRANCH = 'draft';
const DEFAULT_USER = 'su';
const DEFAULT_ID_PROVIDER = 'system';

export type McpConfig = {
  token?: string;
  project: string;
  branch: string;
  user: string;
  idProvider: string;
  allowedOrigins: string[];
};

function value(key: string): string | undefined {
  const raw = app.config[key]?.trim();
  return raw == null || raw === '' ? undefined : raw;
}

function list(key: string): string[] {
  return (value(key) ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

export function getMcpConfig(): McpConfig {
  return {
    token: value('mcp.token'),
    project: value('mcp.project') ?? DEFAULT_PROJECT,
    branch: value('mcp.branch') ?? DEFAULT_BRANCH,
    user: value('mcp.user') ?? DEFAULT_USER,
    idProvider: value('mcp.idProvider') ?? DEFAULT_ID_PROVIDER,
    allowedOrigins: list('mcp.allowedOrigins'),
  };
}
