// App config comes from $XP_HOME/config/com.enonic.app.grieg.cfg.

const DEFAULT_PROJECT = 'default';
const DEFAULT_BRANCH = 'draft';
const DEFAULT_ID_PROVIDER = 'system';
export const TOOLSETS = ['content', 'nodes', 'workflows'];

export type McpConfig = {
  // Deprecated shared-token mode, on only while `token` and `user` are both set.
  token?: string;
  project: string;
  branch: string;
  user?: string;
  idProvider: string;
  allowedOrigins: string[];
  allowedHosts: string[];
  toolsets: string[];
  readOnly: boolean;
  // Empty means every repository the deny rules leave.
  nodeRepos: string[];
};

// `user` and `idProvider` name the acting user: a key's owner, or `mcp.user` for the shared token.
// `admin` is whether that user held `role:system.admin` when the request was admitted.
export type ToolsConfig = McpConfig & { user: string; credential: 'key' | 'token'; admin: boolean };

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
    user: value('mcp.user'),
    idProvider: value('mcp.idProvider') ?? DEFAULT_ID_PROVIDER,
    allowedOrigins: list('mcp.allowedOrigins'),
    allowedHosts: list('mcp.allowedHosts'),
    // Present but blank means no toolsets, so an operator can switch every tool off.
    toolsets: app.config['mcp.toolsets'] == null ? TOOLSETS : list('mcp.toolsets'),
    readOnly: value('mcp.readOnly')?.toLowerCase() === 'true',
    nodeRepos: list('mcp.nodes.repos'),
  };
}

export type OauthConfig = {
  enabled: boolean;
};

export function getOauthConfig(): OauthConfig {
  return { enabled: value('oauth.enabled')?.toLowerCase() === 'true' };
}

const DEFAULT_VERTEX_MODEL = 'gemini-3.1-flash-lite';

export type VertexConfig = {
  // Unset means Application Default Credentials.
  credentialsPath?: string;
  project?: string;
  model: string;
};

export function getVertexConfig(): VertexConfig {
  return {
    credentialsPath: value('vertex.credentialsPath'),
    project: value('vertex.project'),
    model: value('vertex.model') ?? DEFAULT_VERTEX_MODEL,
  };
}
