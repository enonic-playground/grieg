import { render } from '/lib/mustache';
import { getUser, hasRole } from '/lib/xp/auth';

import type { Request, Response } from '@enonic-types/core';

import { normalizeOrigin, originOf } from '../../lib/access';
import { errorResponse } from '../../lib/api';
import { getOauthConfig, type OauthConfig } from '../../lib/config';
import { exchangeCode, issueCode, refresh, type TokenResponse } from '../../lib/grants';
import { randomToken } from '../../lib/key-crypto';
import { checkOwner, MCP_ROLE, MCP_ROLE_NAME } from '../../lib/keys';
import {
  authorizationResponse,
  ENDPOINTS,
  isRegistrationError,
  isRepeated,
  isTokenError,
  issuerOf,
  issuerPath,
  originOfUri,
  param,
  publishesDiscovery,
  tokenError,
  validateAuthorizeRequest,
  validateRegistration,
  wellKnownDocument,
  type AuthorizeRequest,
  type Endpoint,
  type Params,
  type TokenError,
} from '../../lib/oauth';
import { redactKeys } from '../../lib/text';

const VIEW = resolve('./consent.html');

// The authorize parameters the consent form posts back, to be validated again.
const AUTHORIZE_PARAMS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'state',
  'resource',
  'scope',
];

type Context = { config: OauthConfig; origin: string; endpoint?: Endpoint };

function contextOf(req: Request): Context | undefined {
  const config = getOauthConfig();
  if (!publishesDiscovery(config.enabled, ENDPOINTS)) return undefined;
  const base = issuerPath(app.name);
  return {
    config,
    origin: originOf(req.scheme, req.host, req.port),
    endpoint: ENDPOINTS.find((name) => req.path === `${base}/${name}`),
  };
}

const notFound = (): Response => errorResponse(404, 'Not found', 'NOT_FOUND');

function page(status: number, model: Record<string, unknown>, formAction = "'none'"): Response {
  return {
    status,
    contentType: 'text/html; charset=utf-8',
    headers: {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}; frame-ancestors 'none'; base-uri 'none'`,
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    },
    body: render(VIEW, model),
  };
}

function errorPage(status: number, message: string): Response {
  return page(status, { error: true, title: 'Cannot connect to Grieg', message });
}

function redirect(location: string): Response {
  return { redirect: location, headers: { 'Cache-Control': 'no-store' } };
}

function clientName(redirectUri: string): string {
  const host = (originOfUri(redirectUri) ?? redirectUri).replace(/^https?:\/\//i, '');
  if (/^claude\.(ai|com)$/i.test(host)) return 'Claude';
  if (/^chatgpt\.com$/i.test(host)) return 'ChatGPT';
  return host;
}

function consentPage(req: Request, origin: string, request: AuthorizeRequest): Response {
  const user = getUser();
  const fields = AUTHORIZE_PARAMS.map((name) => ({ name, value: param(req.params, name) })).filter(
    (field) => field.value != null,
  );
  const client = clientName(request.redirectUri);
  return page(
    200,
    {
      title: `Connect ${client} to Grieg`,
      client,
      clientId: request.clientId,
      instance: origin,
      user: user == null ? '' : `${user.displayName} (${user.key})`,
      redirectHost: originOfUri(request.redirectUri) ?? request.redirectUri,
      action: req.path,
      fields,
    },
    // Browsers apply `form-action` to the redirect that follows the POST as well.
    `'self' ${originOfUri(request.redirectUri) ?? ''}`.trim(),
  );
}

// The consent POST rides on the XP session cookie, so it must come from this origin. Browsers
// send `Origin` on every POST; `Sec-Fetch-Site` covers the rest.
function isSameOriginPost(req: Request, origin: string): boolean {
  const header = req.getHeader('Origin');
  if (header != null && header !== '' && header !== 'null') {
    return normalizeOrigin(header) === origin;
  }
  return req.getHeader('Sec-Fetch-Site') === 'same-origin';
}

function authorize(req: Request, { config, origin }: Context): Response {
  const check = validateAuthorizeRequest(req.params, origin, app.name, config.redirectUris);
  const issuer = issuerOf(origin, app.name);
  if (!check.ok) {
    if ('fatal' in check) return errorPage(400, check.fatal);
    const { redirectUri, error, description, state } = check;
    return redirect(authorizationResponse(redirectUri, issuer, { error, description }, state));
  }
  const { request } = check;

  // XP answers a 401 for an anonymous user with its login page, which returns to this URL. A 401
  // without a body becomes XP's error page instead.
  const user = getUser();
  if (user == null) return { status: 401, contentType: 'text/plain', body: 'Sign in to continue' };
  if (!hasRole(MCP_ROLE_NAME)) {
    log.info(`OAuth refused ${user.key} at consent: the user does not hold ${MCP_ROLE}`);
    return errorPage(
      403,
      `Your account does not hold the ${MCP_ROLE} role, which connecting an AI client needs. Ask an administrator for it.`,
    );
  }
  if (req.method !== 'POST') return consentPage(req, origin, request);

  if (param(req.params, 'decision') !== 'approve') {
    return redirect(
      authorizationResponse(
        request.redirectUri,
        issuer,
        { error: 'access_denied', description: 'The user denied the request' },
        request.state,
      ),
    );
  }
  let code: string;
  try {
    code = issueCode(user.key, request);
  } catch (e) {
    log.error(`OAuth could not issue a code for ${user.key}: ${redactKeys(String(e))}`);
    return redirect(
      authorizationResponse(
        request.redirectUri,
        issuer,
        { error: 'server_error', description: 'The authorization could not be stored' },
        request.state,
      ),
    );
  }
  return redirect(authorizationResponse(request.redirectUri, issuer, { code }, request.state));
}

function tokenReply(result: TokenResponse | TokenError): Response {
  const headers = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
  if (!isTokenError(result)) {
    return { status: 200, contentType: 'application/json', headers, body: JSON.stringify(result) };
  }
  return {
    status: result.status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify({ error: result.error, error_description: result.description }),
  };
}

const TOKEN_PARAMS = [
  'grant_type',
  'code',
  'redirect_uri',
  'client_id',
  'code_verifier',
  'refresh_token',
  'resource',
];

function token(params: Params, config: OauthConfig): TokenResponse | TokenError {
  if (TOKEN_PARAMS.some((name) => isRepeated(params, name))) {
    return tokenError('invalid_request', 'A parameter was sent more than once');
  }
  const deps = { ...config, checkOwner };
  const clientId = param(params, 'client_id');
  const resource = param(params, 'resource');
  const grantType = param(params, 'grant_type');

  if (grantType === 'authorization_code') {
    const code = param(params, 'code');
    const redirectUri = param(params, 'redirect_uri');
    if (code == null || redirectUri == null || clientId == null) {
      return tokenError('invalid_request', 'code, redirect_uri and client_id are required');
    }
    const verifier = param(params, 'code_verifier');
    return exchangeCode({ code, clientId, redirectUri, verifier, resource }, deps);
  }
  if (grantType === 'refresh_token') {
    const refreshToken = param(params, 'refresh_token');
    if (refreshToken == null || clientId == null) {
      return tokenError('invalid_request', 'refresh_token and client_id are required');
    }
    return refresh({ refreshToken, clientId, resource }, deps);
  }
  return tokenError(
    'unsupported_grant_type',
    'Only authorization_code and refresh_token are supported',
  );
}

// Anonymous by RFC 7591: never log the request's metadata, which is the caller's own text.
function register(req: Request, { config }: Context): Response {
  const headers = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
  const registration = validateRegistration(req.body, config.redirectUris);
  if (isRegistrationError(registration)) {
    return {
      status: 400,
      contentType: 'application/json',
      headers,
      body: JSON.stringify({
        error: registration.error,
        error_description: registration.description,
      }),
    };
  }
  return {
    status: 201,
    contentType: 'application/json',
    headers,
    body: JSON.stringify({
      client_id: `client-${randomToken()}`,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      ...registration,
    }),
  };
}

export function get(req: Request): Response {
  const context = contextOf(req);
  if (context == null) return notFound();
  if (context.endpoint === 'authorize') return authorize(req, context);
  if (context.endpoint != null) return notFound();

  const document = wellKnownDocument(req.path, context.origin, app.name, ENDPOINTS);
  if (document == null) return notFound();
  return {
    status: 200,
    contentType: 'application/json',
    headers: { 'Cache-Control': 'no-store' },
    body: JSON.stringify(document),
  };
}

export function post(req: Request): Response {
  const context = contextOf(req);
  if (context == null) return notFound();
  if (context.endpoint === 'authorize') {
    if (!isSameOriginPost(req, context.origin)) {
      log.warning(
        `OAuth refused a consent POST from ${req.remoteAddress}: Origin '${req.getHeader('Origin') ?? ''}' is not ${context.origin}`,
      );
      return errorPage(403, 'This approval did not come from the consent page.');
    }
    return authorize(req, context);
  }
  if (context.endpoint === 'register') return register(req, context);
  if (context.endpoint !== 'token') return notFound();
  try {
    return tokenReply(token(req.params, context.config));
  } catch (e) {
    log.error(`OAuth token request failed: ${redactKeys(String(e))}`);
    return tokenReply(tokenError('server_error', 'The token request failed; try again'));
  }
}
