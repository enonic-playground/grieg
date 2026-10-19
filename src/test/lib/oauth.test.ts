import { describe, expect, it } from 'vitest';

import {
  authorizationServerMetadata,
  bearerChallenge,
  ENDPOINTS,
  protectedResourceMetadata,
  publishesDiscovery,
  wellKnownDocument,
  type Endpoint,
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

  it('should publish nothing from the endpoints served today', () => {
    expect(publishesDiscovery(true, ENDPOINTS)).toBe(false);
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
  it('should list authorize and token under the issuer, with S256 and no registration', () => {
    expect(authorizationServerMetadata(ORIGIN, APP, SERVED)).toEqual({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
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
