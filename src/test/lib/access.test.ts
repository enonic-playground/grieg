import { describe, expect, it } from 'vitest';

import type { Access } from '../../main/resources/lib/access';
import type { McpConfig } from '../../main/resources/lib/config';

import { checkAccess, originOf } from '../../main/resources/lib/access';

const CONFIG: McpConfig = {
  token: 'secret',
  project: 'default',
  branch: 'draft',
  user: 'editor',
  idProvider: 'system',
  allowedOrigins: [],
  allowedHosts: [],
};

const AUTH = { Authorization: 'Bearer secret' };

type Self = [scheme: string, host: string, port: number];

const LOCAL: Self = ['http', 'localhost', 8080];

function check(
  headers: Record<string, string>,
  config: Partial<McpConfig> = {},
  { cookieNames = [], self = LOCAL }: { cookieNames?: string[]; self?: Self } = {},
): Access {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return checkAccess(
    { header: (name) => lower[name.toLowerCase()], cookieNames, origin: originOf(...self) },
    { ...CONFIG, ...config },
  );
}

function rejection(access: Access) {
  if (!('rejection' in access)) throw new Error('expected a rejection');
  return access.rejection;
}

describe('checkAccess: cookies', () => {
  it('should refuse a Cookie header even with a valid bearer, naming cookies but not values', () => {
    const denied = rejection(check({ ...AUTH, Cookie: 'JSESSIONID=abc123; theme=dark' }));

    expect(denied.status).toBe(403);
    expect(denied.reason).toContain('JSESSIONID, theme');
    expect(denied.reason).not.toContain('abc123');
  });

  it('should refuse cookies XP parsed even when the header lookup misses them', () => {
    const denied = rejection(check(AUTH, {}, { cookieNames: ['JSESSIONID'] }));

    expect(denied.status).toBe(403);
    expect(denied.reason).toContain('JSESSIONID');
  });

  it('should refuse cookies before reporting a disabled endpoint', () => {
    expect(rejection(check({ Cookie: 'a=b' }, { token: undefined })).status).toBe(403);
  });

  it('should report an empty Cookie header as unnamed', () => {
    expect(rejection(check({ ...AUTH, Cookie: '' })).reason).toContain('(unnamed)');
  });
});

describe('checkAccess: Origin and Host', () => {
  it('should admit a request without Origin whatever its host', () => {
    expect(check(AUTH, {}, { self: ['http', 'evil.example.com', 80] })).toEqual({ config: CONFIG });
  });

  it('should admit an Origin listed in mcp.allowedOrigins regardless of the request host', () => {
    const access = check(
      { ...AUTH, Origin: 'https://app.example.com' },
      { allowedOrigins: ['https://app.example.com'] },
      { self: ['http', 'xp.internal', 8080] },
    );

    expect(access).toHaveProperty('config');
  });

  it.each<[string, string, Self]>([
    ['localhost with a port', 'http://localhost:8080', LOCAL],
    ['127.0.0.1', 'http://127.0.0.1:8080', ['http', '127.0.0.1', 8080]],
    ['IPv6 loopback', 'http://[::1]:8080', ['http', '::1', 8080]],
    ['mixed case', 'http://LocalHost:8080', ['http', 'LOCALHOST', 8080]],
    ['an explicit default port', 'https://localhost:443', ['https', 'localhost', 443]],
  ])('should admit a same-origin request on a trusted host: %s', (_label, origin, self) => {
    expect(check({ ...AUTH, Origin: origin }, {}, { self })).toHaveProperty('config');
  });

  it('should admit a same-origin request on a host listed in mcp.allowedHosts', () => {
    const access = check(
      { ...AUTH, Origin: 'https://cms.example.com' },
      { allowedHosts: ['CMS.example.com'] },
      { self: ['https', 'cms.example.com', 443] },
    );

    expect(access).toHaveProperty('config');
  });

  it.each<[string, string, string, Self]>([
    [
      'with a port',
      'cms.example.com:8080',
      'http://cms.example.com:8080',
      ['http', 'cms.example.com', 8080],
    ],
    [
      'as a bare IPv6 address',
      '2001:DB8::1',
      'http://[2001:db8::1]:8080',
      ['http', '2001:db8::1', 8080],
    ],
  ])('should match an mcp.allowedHosts entry written %s', (_label, entry, origin, self) => {
    expect(check({ ...AUTH, Origin: origin }, { allowedHosts: [entry] }, { self })).toHaveProperty(
      'config',
    );
  });

  it('should refuse a rebinding pair where Origin and Host both name the attacker', () => {
    const denied = rejection(
      check(
        { ...AUTH, Origin: 'http://evil.example.com:8080' },
        {},
        { self: ['http', 'evil.example.com', 8080] },
      ),
    );

    expect(denied).toMatchObject({ status: 403, message: 'Host not allowed: evil.example.com' });
    expect(denied.reason).toContain("Host 'evil.example.com' is not trusted");
    expect(denied.reason).toContain('`mcp.allowedHosts`');
  });

  it('should refuse a cross-origin request on a trusted host', () => {
    const denied = rejection(check({ ...AUTH, Origin: 'http://evil.example.com' }));

    expect(denied).toMatchObject({
      status: 403,
      message: 'Origin not allowed: http://evil.example.com',
    });
    expect(denied.reason).toContain('`mcp.allowedOrigins`');
  });

  it('should refuse a same-host Origin on a different port', () => {
    const denied = rejection(check({ ...AUTH, Origin: 'http://localhost:3000' }));

    expect(denied).toMatchObject({
      status: 403,
      message: 'Origin not allowed: http://localhost:3000',
    });
  });

  it('should refuse an http Origin for an https request on a trusted host', () => {
    const denied = rejection(
      check(
        { ...AUTH, Origin: 'http://cms.example.com' },
        { allowedHosts: ['cms.example.com'] },
        { self: ['https', 'cms.example.com', 443] },
      ),
    );

    expect(denied).toMatchObject({
      status: 403,
      message: 'Origin not allowed: http://cms.example.com',
    });
  });

  it.each([
    ['the opaque null origin', 'null'],
    ['an origin with a path', 'http://localhost:8080/page'],
  ])('should refuse %s', (_label, origin) => {
    expect(rejection(check({ ...AUTH, Origin: origin })).status).toBe(403);
  });

  it('should refuse a bad Origin before reporting a disabled endpoint', () => {
    const denied = rejection(check({ Origin: 'http://evil.example.com' }, { token: undefined }));

    expect(denied.status).toBe(403);
  });
});

describe('checkAccess: configuration and bearer', () => {
  it('should disable the endpoint while mcp.token is unset', () => {
    const denied = rejection(check(AUTH, { token: undefined }));

    expect(denied).toEqual({
      status: 401,
      reason: 'endpoint is disabled, set `mcp.token` in the app config',
    });
  });

  it('should disable the endpoint while mcp.user is unset, even with a valid bearer', () => {
    const denied = rejection(check(AUTH, { user: undefined }));

    expect(denied).toEqual({
      status: 401,
      reason: 'endpoint is disabled, set `mcp.user` in the app config',
    });
  });

  it.each([
    ['missing', {}, 'missing bearer token'],
    ['not a bearer', { Authorization: 'Basic secret' }, 'missing bearer token'],
    ['wrong', { Authorization: 'Bearer nope' }, 'invalid bearer token'],
  ])('should refuse a %s token', (_label, headers, reason) => {
    expect(rejection(check(headers))).toEqual({ status: 401, reason });
  });
});
