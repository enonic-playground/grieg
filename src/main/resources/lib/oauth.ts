// The protocol side of grieg's authorization server for the MCP endpoint: RFC 9728 and RFC 8414
// discovery, authorization request validation, PKCE and the authorization response.

import { safeEqual } from './mcp';

const WELL_KNOWN = '/.well-known';
const PROTECTED_RESOURCE = 'oauth-protected-resource';
const AUTHORIZATION_SERVER = 'oauth-authorization-server';

export type Endpoint = 'authorize' | 'token' | 'register';

// The endpoints `apis/oauth` serves; the metadata names no other.
export const ENDPOINTS: readonly Endpoint[] = ['authorize', 'token'];

export const OFFLINE_ACCESS = 'offline_access';

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
    // Claude asks for a refresh token only when this lists `offline_access`.
    scopes_supported: [OFFLINE_ACCESS],
    // Public clients only; RFC 8414 would otherwise default to `client_secret_basic`.
    token_endpoint_auth_methods_supported: ['none'],
    // RFC 9207: ChatGPT uses its fixed redirect URI only with an issuer-identifying server.
    authorization_response_iss_parameter_supported: true,
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

//
// * Authorization and token requests
//

export type Params = Record<string, string | string[] | undefined>;

export type AuthorizeRequest = {
  clientId: string;
  redirectUri: string;
  challenge: string;
  resource: string;
  state?: string;
  scope?: string;
};

// `fatal` is shown to the user and never redirected: the redirect URI is not trusted yet.
export type AuthorizeCheck =
  | { ok: true; request: AuthorizeRequest }
  | { ok: false; fatal: string }
  | { ok: false; redirectUri: string; state?: string; error: string; description: string };

// Without registration a client_id is an unverified label, bound to the grant and checked again
// at the token endpoint; the exact redirect URI is what admits a client.
const CLIENT_ID_PATTERN = /^[\x21-\x7E]{1,255}$/;
// The S256 challenge is the base64url SHA-256 of the verifier, 32 bytes without padding.
const CHALLENGE_PATTERN = /^[\w-]{43}$/;
const VERIFIER_PATTERN = /^[\w.~-]{43,128}$/;
const MAX_STATE_LENGTH = 1024;

type Single = { value?: string; repeated: boolean };

// RFC 6749 §3.1: a parameter sent more than once is an invalid request.
function single(params: Params, name: string): Single {
  const raw = params[name];
  if (Array.isArray(raw)) {
    return raw.length > 1 ? { repeated: true } : { value: raw[0] || undefined, repeated: false };
  }
  return { value: raw === '' ? undefined : raw, repeated: false };
}

export function param(params: Params, name: string): string | undefined {
  return single(params, name).value;
}

export function isRepeated(params: Params, name: string): boolean {
  return single(params, name).repeated;
}

export function resourceOf(origin: string, appName: string): string {
  return `${origin}${mcpPath(appName)}`;
}

export function issuerOf(origin: string, appName: string): string {
  return `${origin}${issuerPath(appName)}`;
}

export function validateAuthorizeRequest(
  params: Params,
  origin: string,
  appName: string,
  redirectUris: readonly string[],
): AuthorizeCheck {
  const clientId = single(params, 'client_id');
  if (clientId.repeated || clientId.value == null || !CLIENT_ID_PATTERN.test(clientId.value)) {
    return { ok: false, fatal: 'The request names no valid client_id.' };
  }
  const redirect = single(params, 'redirect_uri');
  if (redirect.repeated || redirect.value == null || !redirectUris.includes(redirect.value)) {
    return { ok: false, fatal: 'The redirect_uri is not one this server accepts.' };
  }
  const redirectUri = redirect.value;
  const stateParam = single(params, 'state');
  const state = stateParam.value;
  const fail = (error: string, description: string): AuthorizeCheck => ({
    ok: false,
    redirectUri,
    state: stateParam.repeated ? undefined : state,
    error,
    description,
  });

  const names = ['state', 'response_type', 'code_challenge', 'code_challenge_method', 'resource'];
  if (names.some((name) => isRepeated(params, name)) || isRepeated(params, 'scope')) {
    return fail('invalid_request', 'A parameter was sent more than once.');
  }
  if (state != null && state.length > MAX_STATE_LENGTH) {
    return fail('invalid_request', 'The state parameter is too long.');
  }
  if (param(params, 'response_type') !== 'code') {
    return fail('unsupported_response_type', 'Only response_type=code is supported.');
  }
  const challenge = param(params, 'code_challenge');
  if (param(params, 'code_challenge_method') !== 'S256' || challenge == null) {
    return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
  }
  if (!CHALLENGE_PATTERN.test(challenge)) {
    return fail('invalid_request', 'The code_challenge is not an S256 challenge.');
  }
  const resource = resourceOf(origin, appName);
  const requested = param(params, 'resource');
  if (requested != null && requested !== resource) {
    return fail('invalid_target', `The only resource is ${resource}.`);
  }
  return {
    ok: true,
    request: {
      clientId: clientId.value,
      redirectUri,
      challenge,
      resource,
      state,
      scope: param(params, 'scope'),
    },
  };
}

// No `URL` in XP's script engine. A configured redirect URI may already carry a query.
export function withQuery(uri: string, query: Record<string, string | undefined>): string {
  const pairs = Object.entries(query)
    .filter((entry): entry is [string, string] => entry[1] != null)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  if (pairs.length === 0) return uri;
  return `${uri}${uri.includes('?') ? '&' : '?'}${pairs.join('&')}`;
}

// Every authorization response carries `iss` (RFC 9207), errors included.
export function authorizationResponse(
  redirectUri: string,
  issuer: string,
  result: { code: string } | { error: string; description?: string },
  state: string | undefined,
): string {
  return withQuery(redirectUri, {
    ...('code' in result
      ? { code: result.code }
      : { error: result.error, error_description: result.description }),
    state,
    iss: issuer,
  });
}

// `hash` is the S256 transform, injected so this module stays free of JVM calls.
export function verifyPkce(
  verifier: string | undefined,
  challenge: string,
  hash: (text: string) => string,
): boolean {
  return (
    verifier != null && VERIFIER_PATTERN.test(verifier) && safeEqual(hash(verifier), challenge)
  );
}

// Scheme, host and port of an absolute URI.
export function originOfUri(uri: string): string | undefined {
  return /^https?:\/\/[^/?#]+/i.exec(uri)?.[0];
}

export type TokenError = {
  status: number;
  error:
    | 'invalid_request'
    | 'invalid_grant'
    | 'unsupported_grant_type'
    | 'invalid_target'
    | 'server_error';
  description: string;
};

export function tokenError(error: TokenError['error'], description: string): TokenError {
  return { status: error === 'server_error' ? 500 : 400, error, description };
}

export function isTokenError(result: object): result is TokenError {
  return 'error' in result;
}

//
// * Refresh token rotation
//

// A refresh token presented again this soon after its rotation lost a race against its own
// client's other refresh, so it is refused without revoking the grant. Any other token on a real
// grant id is a retired or forged one, and only a holder of that grant's tokens knows the id.
export const REFRESH_GRACE_MS = 30 * 1000;

export type RefreshState = {
  refresh: string;
  previousRefresh?: string;
  rotated?: string;
};

export type RefreshMatch = 'current' | 'raced' | 'reused';

export function matchRefresh(state: RefreshState, digest: string, now: Date): RefreshMatch {
  if (safeEqual(digest, state.refresh)) return 'current';
  if (state.previousRefresh == null || !safeEqual(digest, state.previousRefresh)) return 'reused';
  const rotated = state.rotated == null ? Number.NaN : Date.parse(state.rotated);
  return now.getTime() - rotated < REFRESH_GRACE_MS ? 'raced' : 'reused';
}
