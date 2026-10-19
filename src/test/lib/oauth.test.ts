import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  authorizationResponse,
  authorizationServerMetadata,
  bearerChallenge,
  ENDPOINTS,
  matchRefresh,
  protectedResourceMetadata,
  publishesDiscovery,
  validateAuthorizeRequest,
  verifyPkce,
  wellKnownDocument,
  withQuery,
  type Endpoint,
  type Params,
} from '../../main/resources/lib/oauth';

const APP = 'com.enonic.app.grieg';
const ORIGIN = 'https://cms.example.com';
const ISSUER = `${ORIGIN}/api/com.enonic.app.grieg:oauth`;
const SERVED: Endpoint[] = ['authorize', 'token'];

const PRM_PATH = '/.well-known/oauth-protected-resource/api/com.enonic.app.grieg:mcp';
const AS_PATH = '/.well-known/oauth-authorization-server/api/com.enonic.app.grieg:oauth';

describe('publishesDiscovery', () => {
  it('should publish only while enabled and serving both authorize and token', () => {
    expect(publishesDiscovery(true, SERVED)).toBe(true);
    expect(publishesDiscovery(false, SERVED)).toBe(false);
    expect(publishesDiscovery(true, ['authorize', 'register'])).toBe(false);
    expect(publishesDiscovery(true, ['token'])).toBe(false);
  });

  it('should publish from the endpoints served today, which include authorize and token', () => {
    expect(publishesDiscovery(true, ENDPOINTS)).toBe(true);
  });
});

describe('bearerChallenge', () => {
  it('should point at the path-suffixed protected resource metadata of the MCP endpoint', () => {
    expect(bearerChallenge(ORIGIN, APP)).toBe(`Bearer resource_metadata="${ORIGIN}${PRM_PATH}"`);
  });
});

describe('protectedResourceMetadata', () => {
  it('should name the MCP endpoint as the resource and grieg as its authorization server', () => {
    expect(protectedResourceMetadata(ORIGIN, APP)).toEqual({
      resource: `${ORIGIN}/api/com.enonic.app.grieg:mcp`,
      authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'],
      resource_name: 'Grieg',
    });
  });
});

describe('authorizationServerMetadata', () => {
  it('should list authorize and token under the issuer, for public S256 clients with iss', () => {
    expect(authorizationServerMetadata(ORIGIN, APP, SERVED)).toEqual({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['offline_access'],
      token_endpoint_auth_methods_supported: ['none'],
      authorization_response_iss_parameter_supported: true,
    });
  });

  it('should list the registration endpoint once it is served', () => {
    expect(
      authorizationServerMetadata(ORIGIN, APP, [...SERVED, 'register']).registration_endpoint,
    ).toBe(`${ISSUER}/register`);
  });
});

describe('wellKnownDocument', () => {
  it('should serve the protected resource metadata at the root and at the API path', () => {
    const expected = protectedResourceMetadata(ORIGIN, APP);

    expect(wellKnownDocument(PRM_PATH, ORIGIN, APP, SERVED)).toEqual(expected);
    expect(
      wellKnownDocument(
        '/api/com.enonic.app.grieg:oauth/well-known/oauth-protected-resource/api/com.enonic.app.grieg:mcp',
        ORIGIN,
        APP,
        SERVED,
      ),
    ).toEqual(expected);
  });

  it('should serve the authorization server metadata at the path-inserted issuer URL', () => {
    const expected = authorizationServerMetadata(ORIGIN, APP, SERVED);

    expect(wellKnownDocument(AS_PATH, ORIGIN, APP, SERVED)).toEqual(expected);
    expect(
      wellKnownDocument(
        '/api/com.enonic.app.grieg:oauth/well-known/oauth-authorization-server/api/com.enonic.app.grieg:oauth',
        ORIGIN,
        APP,
        SERVED,
      ),
    ).toEqual(expected);
  });

  it.each([
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/',
    '/.well-known/oauth-protected-resource/api/com.enonic.app.other:mcp',
    '/.well-known/oauth-protected-resource/api/com.enonic.app.grieg:mcp/extra',
    '/.well-known/oauth-authorization-server',
    '/.well-known/openid-configuration',
    '/.well-known/openid-configuration/api/com.enonic.app.grieg:oauth',
    '/.well-known/security.txt',
    '/api/com.enonic.app.grieg:oauth/oauth-protected-resource/api/com.enonic.app.grieg:mcp',
  ])('should serve nothing at %s', (path) => {
    expect(wellKnownDocument(path, ORIGIN, APP, SERVED)).toBeUndefined();
  });
});

const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const ALLOWED = [CLAUDE, 'https://chatgpt.com/connector_platform_oauth_redirect'];
const VERIFIER = 'v'.repeat(43);

function s256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('base64url');
}

function authorizeParams(overrides: Params = {}): Params {
  return {
    response_type: 'code',
    client_id: 'claude',
    redirect_uri: CLAUDE,
    code_challenge: s256(VERIFIER),
    code_challenge_method: 'S256',
    state: 'xyz',
    resource: `${ORIGIN}/api/com.enonic.app.grieg:mcp`,
    scope: 'offline_access',
    ...overrides,
  };
}

function check(overrides: Params = {}) {
  return validateAuthorizeRequest(authorizeParams(overrides), ORIGIN, APP, ALLOWED);
}

describe('validateAuthorizeRequest', () => {
  it('should accept a code request with S256 for the MCP resource', () => {
    expect(check()).toEqual({
      ok: true,
      request: {
        clientId: 'claude',
        redirectUri: CLAUDE,
        challenge: s256(VERIFIER),
        resource: `${ORIGIN}/api/com.enonic.app.grieg:mcp`,
        state: 'xyz',
        scope: 'offline_access',
      },
    });
  });

  it('should accept a request without resource and bind it to the MCP endpoint', () => {
    expect(check({ resource: undefined })).toMatchObject({
      ok: true,
      request: { resource: `${ORIGIN}/api/com.enonic.app.grieg:mcp` },
    });
  });

  it.each([
    ['an unlisted redirect_uri', { redirect_uri: 'https://evil.example/cb' }],
    ['a redirect_uri that only starts with an allowed one', { redirect_uri: `${CLAUDE}/x` }],
    ['a redirect_uri with an added query', { redirect_uri: `${CLAUDE}?next=x` }],
    ['no redirect_uri', { redirect_uri: undefined }],
    ['a repeated redirect_uri', { redirect_uri: [CLAUDE, CLAUDE] }],
    ['no client_id', { client_id: undefined }],
    ['a client_id with spaces', { client_id: 'my client' }],
    ['a client_id over 255 characters', { client_id: 'c'.repeat(256) }],
  ])('should refuse %s on a page, without redirecting', (_name, overrides) => {
    const result = check(overrides);

    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('fatal');
    expect(result).not.toHaveProperty('redirectUri');
  });

  it.each([
    ['unsupported_response_type', { response_type: 'token' }],
    ['invalid_request', { code_challenge_method: 'plain' }],
    ['invalid_request', { code_challenge_method: undefined }],
    ['invalid_request', { code_challenge: undefined }],
    ['invalid_request', { code_challenge: 'short' }],
    ['invalid_request', { scope: ['a', 'b'] }],
    ['invalid_request', { state: 's'.repeat(1025) }],
    ['invalid_target', { resource: `${ORIGIN}/api/com.enonic.app.other:mcp` }],
  ])('should redirect %s back to the client with its state', (error, overrides) => {
    expect(check(overrides)).toMatchObject({
      ok: false,
      redirectUri: CLAUDE,
      error,
      state: overrides.state ?? 'xyz',
    });
  });

  it('should drop a repeated state rather than echo either value', () => {
    expect(check({ state: ['a', 'b'] })).toMatchObject({
      ok: false,
      error: 'invalid_request',
      state: undefined,
    });
  });
});

describe('authorizationResponse', () => {
  it('should add the code, state and issuer to the redirect URI, encoded', () => {
    expect(authorizationResponse(CLAUDE, ISSUER, { code: 'c1' }, 'a b&c')).toBe(
      `${CLAUDE}?code=c1&state=a%20b%26c&iss=${encodeURIComponent(ISSUER)}`,
    );
  });

  it('should carry the issuer on an error, and omit an absent state', () => {
    expect(
      authorizationResponse(
        CLAUDE,
        ISSUER,
        { error: 'access_denied', description: 'no' },
        undefined,
      ),
    ).toBe(`${CLAUDE}?error=access_denied&error_description=no&iss=${encodeURIComponent(ISSUER)}`);
  });

  it('should append to a redirect URI that already has a query', () => {
    expect(withQuery('https://a.example/cb?x=1', { code: 'c' })).toBe(
      'https://a.example/cb?x=1&code=c',
    );
  });
});

describe('verifyPkce', () => {
  it('should accept only the verifier whose S256 transform is the challenge', () => {
    expect(verifyPkce(VERIFIER, s256(VERIFIER), s256)).toBe(true);
    expect(verifyPkce('w'.repeat(43), s256(VERIFIER), s256)).toBe(false);
    expect(verifyPkce(undefined, s256(VERIFIER), s256)).toBe(false);
  });

  it('should refuse a verifier outside RFC 7636 even when its transform matches', () => {
    const short = 'v'.repeat(42);

    expect(verifyPkce(short, s256(short), s256)).toBe(false);
  });
});

describe('matchRefresh', () => {
  const NOW = new Date('2026-10-19T12:00:00.000Z');
  const state = {
    refresh: 'current',
    previousRefresh: 'previous',
    rotated: '2026-10-19T11:59:40.000Z',
  };

  it('should tell the current token from any other, which counts as reuse', () => {
    expect(matchRefresh(state, 'current', NOW)).toBe('current');
    expect(matchRefresh(state, 'other', NOW)).toBe('reused');
  });

  it('should treat the previous token within 30 s of rotation as a lost race', () => {
    expect(matchRefresh(state, 'previous', NOW)).toBe('raced');
  });

  it('should treat the previous token after 30 s as reuse', () => {
    expect(matchRefresh(state, 'previous', new Date('2026-10-19T12:00:10.000Z'))).toBe('reused');
  });
});
