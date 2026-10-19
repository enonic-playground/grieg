// OAuth discovery for the MCP endpoint: RFC 9728 protected resource metadata and RFC 8414
// authorization server metadata.

const WELL_KNOWN = '/.well-known';
const PROTECTED_RESOURCE = 'oauth-protected-resource';
const AUTHORIZATION_SERVER = 'oauth-authorization-server';

export type Endpoint = 'authorize' | 'token' | 'register';

// The endpoints `apis/oauth` serves; the metadata names no other.
export const ENDPOINTS: readonly Endpoint[] = [];

type Document = Record<string, unknown>;

export function mcpPath(appName: string): string {
  return `/api/${appName}:mcp`;
}

export function issuerPath(appName: string): string {
  return `/api/${appName}:oauth`;
}

// The MCP spec requires protected resource metadata to name an authorization server, and one
// without both of these cannot issue a token, so until then nothing is published.
export function publishesDiscovery(enabled: boolean, endpoints: readonly Endpoint[]): boolean {
  return enabled && endpoints.includes('authorize') && endpoints.includes('token');
}

export function bearerChallenge(origin: string, appName: string): string {
  return `Bearer resource_metadata="${origin}${WELL_KNOWN}/${PROTECTED_RESOURCE}${mcpPath(appName)}"`;
}

export function protectedResourceMetadata(origin: string, appName: string): Document {
  return {
    resource: `${origin}${mcpPath(appName)}`,
    authorization_servers: [`${origin}${issuerPath(appName)}`],
    bearer_methods_supported: ['header'],
    resource_name: 'Grieg',
  };
}

export function authorizationServerMetadata(
  origin: string,
  appName: string,
  endpoints: readonly Endpoint[],
): Document {
  const issuer = `${origin}${issuerPath(appName)}`;
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    ...(endpoints.includes('register') ? { registration_endpoint: `${issuer}/register` } : {}),
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
  };
}

// `path` is the request path as the client sent it: the root `/.well-known/...` through a vhost
// mapping, or the API's own `/api/<app>:oauth/well-known/...` without one. The suffix after the
// document name is the path of the resource or issuer it describes (RFC 9728 §3, RFC 8414 §3).
export function wellKnownDocument(
  path: string,
  origin: string,
  appName: string,
  endpoints: readonly Endpoint[],
): Document | undefined {
  const name = documentName(path, appName);
  if (name === `${PROTECTED_RESOURCE}${mcpPath(appName)}`) {
    return protectedResourceMetadata(origin, appName);
  }
  if (name === `${AUTHORIZATION_SERVER}${issuerPath(appName)}`) {
    return authorizationServerMetadata(origin, appName, endpoints);
  }
  return undefined;
}

function documentName(path: string, appName: string): string | undefined {
  for (const prefix of [`${WELL_KNOWN}/`, `${issuerPath(appName)}/well-known/`]) {
    if (path.startsWith(prefix)) return path.slice(prefix.length);
  }
  return undefined;
}
