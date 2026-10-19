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

export const CHATGPT_REDIRECT_URI = 'https://chatgpt.com/connector_platform_oauth_redirect';

// Claude's hosted apps (claude.ai, and claude.com, which Anthropic says it may move to) and
// ChatGPT's fixed callback, which ChatGPT uses because grieg returns `iss` (RFC 9207).
export const DEFAULT_REDIRECT_URIS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
  CHATGPT_REDIRECT_URI,
];
const DEFAULT_ACCESS_TOKEN_TTL_S = 60 * 60;
const DEFAULT_REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;
const MIN_TTL_S = 60;

export type OauthConfig = {
  enabled: boolean;
  // Exact matches only.
  redirectUris: string[];
  accessTokenTtlMs: number;
  // Idle lifetime: each refresh extends it, up to the grant's fixed 90 days.
  refreshTokenTtlMs: number;
};

function seconds(key: string, fallback: number): number {
  const parsed = Number(value(key));
  return Number.isInteger(parsed) && parsed >= MIN_TTL_S ? parsed : fallback;
}

export function getOauthConfig(): OauthConfig {
  return {
    enabled: value('oauth.enabled')?.toLowerCase() === 'true',
    redirectUris:
      app.config['oauth.redirectUris'] == null ? DEFAULT_REDIRECT_URIS : list('oauth.redirectUris'),
    accessTokenTtlMs: seconds('oauth.accessTokenTtl', DEFAULT_ACCESS_TOKEN_TTL_S) * 1000,
    refreshTokenTtlMs: seconds('oauth.refreshTokenTtl', DEFAULT_REFRESH_TOKEN_TTL_S) * 1000,
  };
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
