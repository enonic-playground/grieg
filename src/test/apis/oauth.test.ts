import * as authLib from '/lib/xp/auth';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as OauthLib from '../../main/resources/lib/oauth';
import type { Request, Response } from '@enonic-types/core';

import * as oauthApi from '../../main/resources/apis/oauth/oauth';
import * as grantsLib from '../../main/resources/lib/grants';

const served = vi.hoisted(() => {
  // The controller resolves its view when it loads.
  (globalThis as Record<string, unknown>).resolve = (path: string) => path;
  return { endpoints: [] as OauthLib.Endpoint[] };
});

vi.mock('../../main/resources/lib/oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof OauthLib>()),
  get ENDPOINTS() {
    return served.endpoints;
  },
}));

vi.mock('../../main/resources/lib/grants', () => ({
  issueCode: vi.fn(),
  exchangeCode: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('../../main/resources/lib/keys', () => ({
  MCP_ROLE_NAME: 'com.enonic.app.grieg.mcp',
  MCP_ROLE: 'role:com.enonic.app.grieg.mcp',
  checkOwner: vi.fn(),
}));

const getUser = vi.mocked(authLib.getUser);
const hasRole = vi.mocked(authLib.hasRole);
const issueCode = vi.mocked(grantsLib.issueCode);
const exchangeCode = vi.mocked(grantsLib.exchangeCode);
const refresh = vi.mocked(grantsLib.refresh);

const ORIGIN = 'https://cms.example.com';
const ISSUER = `${ORIGIN}/api/com.enonic.app.grieg:oauth`;
const PRM_PATH = '/.well-known/oauth-protected-resource/api/com.enonic.app.grieg:mcp';
const AS_PATH = '/.well-known/oauth-authorization-server/api/com.enonic.app.grieg:oauth';
const AUTHORIZE = '/api/com.enonic.app.grieg:oauth/authorize';
const TOKEN = '/api/com.enonic.app.grieg:oauth/token';
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const CHALLENGE = createHash('sha256').update('v'.repeat(43)).digest('base64url');

const warning = vi.fn();
const logError = vi.fn();

function withConfig(config: Record<string, string>): void {
  vi.stubGlobal('app', { name: 'com.enonic.app.grieg', version: '1.0.0', config });
}

function request(
  path: string,
  params: Record<string, string | string[]> = {},
  headers: Record<string, string> = {},
  method = 'GET',
): Request {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    scheme: 'https',
    host: 'cms.example.com',
    port: 443,
    method,
    path,
    params,
    remoteAddress: '203.0.113.9',
    getHeader: (name: string) => lower[name.toLowerCase()] ?? null,
  } as unknown as Request;
}

function json(response: Response): Record<string, unknown> {
  return JSON.parse(response.body as string) as Record<string, unknown>;
}

function authorizeParams(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    response_type: 'code',
    client_id: 'claude',
    redirect_uri: CLAUDE,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'xyz',
    ...overrides,
  };
}

function signIn(roles: string[] = ['com.enonic.app.grieg.mcp']): void {
  getUser.mockReturnValue({ key: 'user:system:alice', displayName: 'Alice' } as never);
  hasRole.mockImplementation((role) => roles.includes(role));
}

function approve(headers: Record<string, string> = { Origin: ORIGIN }, decision = 'approve') {
  return oauthApi.post(request(AUTHORIZE, { ...authorizeParams(), decision }, headers, 'POST'));
}

beforeEach(() => {
  vi.resetAllMocks();
  served.endpoints = ['authorize', 'token'];
  withConfig({ 'oauth.enabled': 'true' });
  vi.stubGlobal('log', { warning, info: vi.fn(), error: logError });
});

describe('OAuth well-known API', () => {
  it('should serve both documents for the request origin, uncached', () => {
    const response = oauthApi.get(request(PRM_PATH));

    expect(response.status).toBe(200);
    expect(response.contentType).toBe('application/json');
    expect(response.headers).toEqual({ 'Cache-Control': 'no-store' });
    expect(json(response)).toMatchObject({
      resource: 'https://cms.example.com/api/com.enonic.app.grieg:mcp',
      authorization_servers: [ISSUER],
    });
    expect(json(oauthApi.get(request(AS_PATH)))).toMatchObject({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
    });
  });

  it.each([{}, { 'oauth.enabled': 'false' }, { 'oauth.enabled': 'yes' }])(
    'should serve nothing while oauth.enabled is not true (%o)',
    (config) => {
      withConfig(config);

      expect(oauthApi.get(request(PRM_PATH)).status).toBe(404);
      expect(oauthApi.get(request(AUTHORIZE, authorizeParams())).status).toBe(404);
      expect(oauthApi.post(request(TOKEN, {}, {}, 'POST')).status).toBe(404);
    },
  );

  it('should serve nothing while grieg does not serve both authorize and token', () => {
    served.endpoints = ['authorize'];

    expect(oauthApi.get(request(PRM_PATH)).status).toBe(404);
    expect(oauthApi.get(request(AS_PATH)).status).toBe(404);
  });

  it('should answer 404 for any other path', () => {
    expect(oauthApi.get(request('/.well-known/openid-configuration')).status).toBe(404);
    expect(oauthApi.get(request(TOKEN)).status).toBe(404);
  });
});

describe('OAuth authorize: GET', () => {
  it('should ask XP for a login when nobody is signed in', () => {
    getUser.mockReturnValue(null);

    const response = oauthApi.get(request(AUTHORIZE, authorizeParams()));

    expect(response.status).toBe(401);
    expect(response.body).toBeTruthy();
  });

  it('should show an error page, not redirect, for a redirect_uri off the allow-list', () => {
    signIn();

    const response = oauthApi.get(
      request(AUTHORIZE, authorizeParams({ redirect_uri: 'https://evil.example/cb' })),
    );

    expect(response.status).toBe(400);
    expect(response.redirect).toBeUndefined();
    expect(json(response)).toMatchObject({ error: true });
  });

  it('should follow oauth.redirectUris rather than the defaults when it is set', () => {
    withConfig({ 'oauth.enabled': 'true', 'oauth.redirectUris': 'https://a.example/cb' });
    signIn();

    expect(oauthApi.get(request(AUTHORIZE, authorizeParams())).status).toBe(400);
    const configured = authorizeParams({ redirect_uri: 'https://a.example/cb' });
    expect(oauthApi.get(request(AUTHORIZE, configured)).status).toBe(200);
  });

  it('should send a bad request back to the client with its state and the issuer', () => {
    const response = oauthApi.get(
      request(AUTHORIZE, authorizeParams({ code_challenge_method: 'plain' })),
    );

    expect(response.redirect).toMatch(
      new RegExp(`^${CLAUDE}\\?error=invalid_request&error_description=[^&]+&state=xyz&iss=`),
    );
    expect(response.redirect).toContain(`iss=${encodeURIComponent(ISSUER)}`);
  });

  it('should refuse a signed-in user without the MCP role on a page that names it', () => {
    signIn([]);

    const response = oauthApi.get(request(AUTHORIZE, authorizeParams()));

    expect(response.status).toBe(403);
    expect(String(json(response).message)).toContain('role:com.enonic.app.grieg.mcp');
    expect(issueCode).not.toHaveBeenCalled();
  });

  it('should show the consent page with the client, user and the request to post back', () => {
    signIn();

    // A GET only ever shows the page, whatever it carries.
    const response = oauthApi.get(
      request(AUTHORIZE, { ...authorizeParams(), decision: 'approve' }),
    );

    expect(response.status).toBe(200);
    expect(json(response)).toMatchObject({
      client: 'Claude',
      clientId: 'claude',
      instance: ORIGIN,
      user: 'Alice (user:system:alice)',
      redirectHost: 'https://claude.ai',
      action: AUTHORIZE,
      fields: expect.arrayContaining([
        { name: 'redirect_uri', value: CLAUDE },
        { name: 'code_challenge', value: CHALLENGE },
        { name: 'state', value: 'xyz' },
      ]),
    });
    expect(issueCode).not.toHaveBeenCalled();
  });

  it('should keep the consent page out of frames and caches', () => {
    signIn();

    const { headers } = oauthApi.get(request(AUTHORIZE, authorizeParams()));

    expect(headers).toMatchObject({
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
    });
    expect(headers?.['Content-Security-Policy']).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://claude.ai; frame-ancestors 'none'; base-uri 'none'",
    );
  });
});

describe('OAuth authorize: consent POST', () => {
  it('should issue a code for the signed-in user and redirect with it, the state and iss', () => {
    signIn();
    issueCode.mockReturnValue('the-code');

    const response = approve();

    expect(issueCode).toHaveBeenCalledWith(
      'user:system:alice',
      expect.objectContaining({ clientId: 'claude', redirectUri: CLAUDE, challenge: CHALLENGE }),
    );
    expect(response.redirect).toBe(
      `${CLAUDE}?code=the-code&state=xyz&iss=${encodeURIComponent(ISSUER)}`,
    );
  });

  it('should accept a same-origin POST that sends Sec-Fetch-Site but no Origin', () => {
    signIn();
    issueCode.mockReturnValue('the-code');

    expect(approve({ 'Sec-Fetch-Site': 'same-origin' }).redirect).toContain('code=the-code');
  });

  it.each([
    ['a cross-site Origin', { Origin: 'https://evil.example' }],
    ['an Origin on another port', { Origin: 'https://cms.example.com:8443' }],
    ['a null Origin', { Origin: 'null' }],
    ['a cross-site fetch without Origin', { 'Sec-Fetch-Site': 'cross-site' }],
    ['no Origin and no Sec-Fetch-Site', {}],
  ])('should refuse %s and issue nothing', (_name, headers) => {
    signIn();

    const response = approve(headers);

    expect(response.status).toBe(403);
    expect(issueCode).not.toHaveBeenCalled();
  });

  it.each(['deny', '', 'APPROVE'])(
    'should redirect access_denied for the decision %j',
    (decision) => {
      signIn();

      const response = approve({ Origin: ORIGIN }, decision);

      expect(response.redirect).toMatch(new RegExp(`^${CLAUDE}\\?error=access_denied&`));
      expect(issueCode).not.toHaveBeenCalled();
    },
  );

  it('should validate the posted request again, so an edited form cannot redirect elsewhere', () => {
    signIn();

    const response = oauthApi.post(
      request(
        AUTHORIZE,
        { ...authorizeParams({ redirect_uri: 'https://evil.example/cb' }), decision: 'approve' },
        { Origin: ORIGIN },
        'POST',
      ),
    );

    expect(response.status).toBe(400);
    expect(issueCode).not.toHaveBeenCalled();
  });

  it('should refuse the approval of a user who lost the MCP role', () => {
    signIn([]);

    expect(approve().status).toBe(403);
    expect(issueCode).not.toHaveBeenCalled();
  });

  it('should send server_error to the client when the code cannot be stored', () => {
    signIn();
    issueCode.mockImplementation(() => {
      throw new Error('repo down');
    });

    expect(approve().redirect).toMatch(new RegExp(`^${CLAUDE}\\?error=server_error&`));
  });
});

describe('OAuth token', () => {
  function token(params: Record<string, string | string[]>): Response {
    return oauthApi.post(request(TOKEN, params, {}, 'POST'));
  }

  const TOKENS = {
    access_token: `grieg_${'a'.repeat(43)}`,
    token_type: 'Bearer' as const,
    expires_in: 3600,
    refresh_token: 'r',
  };

  it('should exchange a code with its verifier, uncached', () => {
    exchangeCode.mockReturnValue(TOKENS);

    const response = token({
      grant_type: 'authorization_code',
      code: 'c',
      redirect_uri: CLAUDE,
      client_id: 'claude',
      code_verifier: 'v',
      resource: `${ORIGIN}/api/com.enonic.app.grieg:mcp`,
    });

    expect(exchangeCode).toHaveBeenCalledWith(
      {
        code: 'c',
        clientId: 'claude',
        redirectUri: CLAUDE,
        verifier: 'v',
        resource: `${ORIGIN}/api/com.enonic.app.grieg:mcp`,
      },
      expect.objectContaining({ accessTokenTtlMs: 3_600_000, checkOwner: expect.any(Function) }),
    );
    expect(response.status).toBe(200);
    expect(response.headers).toEqual({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    expect(json(response)).toEqual(TOKENS);
  });

  it('should rotate a refresh token for its client', () => {
    refresh.mockReturnValue(TOKENS);

    token({ grant_type: 'refresh_token', refresh_token: 'r', client_id: 'claude' });

    expect(refresh).toHaveBeenCalledWith(
      { refreshToken: 'r', clientId: 'claude', resource: undefined },
      expect.objectContaining({ refreshTokenTtlMs: 2_592_000_000 }),
    );
  });

  it('should answer a refused grant with the RFC 6749 error body', () => {
    exchangeCode.mockReturnValue({ status: 400, error: 'invalid_grant', description: 'used' });

    const response = token({
      grant_type: 'authorization_code',
      code: 'c',
      redirect_uri: CLAUDE,
      client_id: 'claude',
    });

    expect(response.status).toBe(400);
    expect(json(response)).toEqual({ error: 'invalid_grant', error_description: 'used' });
  });

  it.each([
    ['unsupported_grant_type', { grant_type: 'client_credentials' }],
    ['unsupported_grant_type', {}],
    ['invalid_request', { grant_type: 'authorization_code', code: 'c', client_id: 'claude' }],
    ['invalid_request', { grant_type: 'refresh_token', refresh_token: 'r' }],
    [
      'invalid_request',
      {
        grant_type: 'authorization_code',
        code: 'c',
        redirect_uri: CLAUDE,
        client_id: 'claude',
        code_verifier: ['a', 'b'],
      },
    ],
  ])('should answer %s for %o without reaching the store', (error, params) => {
    const response = token(params);

    expect(response.status).toBe(400);
    expect(json(response).error).toBe(error);
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('should answer server_error when the store fails, keeping keys out of reply and log', () => {
    refresh.mockImplementation(() => {
      throw new Error(`repo down at grieg_${'k'.repeat(43)}`);
    });

    const response = token({ grant_type: 'refresh_token', refresh_token: 'r', client_id: 'c' });

    expect(response.status).toBe(500);
    expect(json(response).error).toBe('server_error');
    expect(response.body).not.toContain('kkkk');
    expect(logError).toHaveBeenCalledTimes(1);
    expect(String(logError.mock.calls[0][0])).not.toContain('kkkk');
  });

  it('should refuse a repeated parameter as such', () => {
    const response = token({
      grant_type: 'refresh_token',
      refresh_token: 'r',
      client_id: 'c',
      resource: ['a', 'b'],
    });

    expect(json(response)).toEqual({
      error: 'invalid_request',
      error_description: 'A parameter was sent more than once',
    });
  });
});
