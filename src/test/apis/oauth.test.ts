import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as OauthLib from '../../main/resources/lib/oauth';
import type { Request } from '@enonic-types/core';

import { get } from '../../main/resources/apis/oauth/oauth';

const served = vi.hoisted(() => ({ endpoints: [] as OauthLib.Endpoint[] }));

vi.mock('../../main/resources/lib/oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof OauthLib>()),
  get ENDPOINTS() {
    return served.endpoints;
  },
}));

const PRM_PATH = '/.well-known/oauth-protected-resource/api/com.enonic.app.grieg:mcp';
const AS_PATH = '/.well-known/oauth-authorization-server/api/com.enonic.app.grieg:oauth';

function withConfig(config: Record<string, string>): void {
  vi.stubGlobal('app', { name: 'com.enonic.app.grieg', version: '1.0.0', config });
}

function request(path: string): Request {
  return { scheme: 'https', host: 'cms.example.com', port: 443, path } as unknown as Request;
}

function body(path: string): unknown {
  return JSON.parse(get(request(path)).body as string);
}

beforeEach(() => {
  served.endpoints = ['authorize', 'token'];
  withConfig({ 'oauth.enabled': 'true' });
});

describe('OAuth well-known API', () => {
  it('should serve both documents for the request origin, uncached', () => {
    const response = get(request(PRM_PATH));

    expect(response.status).toBe(200);
    expect(response.contentType).toBe('application/json');
    expect(response.headers).toEqual({ 'Cache-Control': 'no-store' });
    expect(get(request(AS_PATH)).status).toBe(200);
    expect(body(PRM_PATH)).toMatchObject({
      resource: 'https://cms.example.com/api/com.enonic.app.grieg:mcp',
      authorization_servers: ['https://cms.example.com/api/com.enonic.app.grieg:oauth'],
    });
    expect(body(AS_PATH)).toMatchObject({
      issuer: 'https://cms.example.com/api/com.enonic.app.grieg:oauth',
    });
  });

  it.each([{}, { 'oauth.enabled': 'false' }, { 'oauth.enabled': 'yes' }])(
    'should serve nothing while oauth.enabled is not true (%o)',
    (config) => {
      withConfig(config);

      expect(get(request(PRM_PATH)).status).toBe(404);
      expect(get(request(AS_PATH)).status).toBe(404);
    },
  );

  it('should serve nothing while grieg does not serve both authorize and token', () => {
    served.endpoints = ['authorize'];

    expect(get(request(PRM_PATH)).status).toBe(404);
    expect(get(request(AS_PATH)).status).toBe(404);
  });

  it('should answer 404 for any other well-known document', () => {
    expect(get(request('/.well-known/openid-configuration')).status).toBe(404);
  });
});
