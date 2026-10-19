import * as authLib from '/lib/xp/auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Grant } from '../../main/resources/lib/grants';
import type { Request, Response } from '@enonic-types/core';

import * as grantsApi from '../../main/resources/apis/grants/grants';
import * as grantsLib from '../../main/resources/lib/grants';

vi.mock('../../main/resources/lib/grants', () => ({
  listGrants: vi.fn(),
  revokeGrant: vi.fn(),
}));

vi.mock('../../main/resources/lib/keys', () => ({
  MCP_ROLE_NAME: 'com.enonic.app.grieg.mcp',
  MCP_ROLE: 'role:com.enonic.app.grieg.mcp',
}));

const getUser = vi.mocked(authLib.getUser);
const hasRole = vi.mocked(authLib.hasRole);
const listGrants = vi.mocked(grantsLib.listGrants);
const revokeGrant = vi.mocked(grantsLib.revokeGrant);

const ALICE = 'user:system:alice';
const BOB = 'user:system:bob';
const ID = 'a'.repeat(64);

const MEMBER = ['com.enonic.app.grieg.mcp'];
const ADMIN = ['system.admin'];

function grant(owner: string, overrides: Partial<Grant> = {}): Grant {
  return {
    id: ID,
    owner,
    clientId: 'client-x',
    redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    created: '2026-10-01T00:00:00.000Z',
    expires: '2026-12-30T00:00:00.000Z',
    ends: '2026-11-30T00:00:00.000Z',
    ...overrides,
  };
}

function request(params: Record<string, string> = {}): Request {
  return { params } as unknown as Request;
}

function body(response: Response): unknown {
  return JSON.parse(response.body as string);
}

function signIn(login: string, roles: string[]): void {
  getUser.mockReturnValue({ key: `user:system:${login}` } as never);
  hasRole.mockImplementation((role) => roles.includes(role));
}

const info = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('log', { info, error: vi.fn(), warning: vi.fn() });
});

describe('grants API: own grants', () => {
  it('should list the caller’s grants with the client named, without owner or redirect URI', () => {
    signIn('alice', MEMBER);
    listGrants.mockReturnValue([grant(ALICE, { lastUsed: '2026-10-02T00:00:00.000Z' })]);

    const response = grantsApi.get(request({ owner: BOB }));

    expect(listGrants).toHaveBeenCalledWith(ALICE);
    expect(response.headers).toEqual({ 'Cache-Control': 'no-store' });
    expect(body(response)).toEqual({
      data: {
        grants: [
          {
            id: ID,
            client: 'ChatGPT',
            clientId: 'client-x',
            created: '2026-10-01T00:00:00.000Z',
            expires: '2026-11-30T00:00:00.000Z',
            lastUsed: '2026-10-02T00:00:00.000Z',
          },
        ],
      },
    });
  });

  it('should revoke only a grant the caller owns', () => {
    signIn('alice', MEMBER);
    revokeGrant.mockReturnValue(true);

    const response = grantsApi.delete(request({ id: ID }));

    expect(revokeGrant).toHaveBeenCalledWith(ID, ALICE);
    expect(body(response)).toEqual({ data: { revoked: true } });
  });

  it('should answer 404 for a grant that is gone or another user’s', () => {
    signIn('alice', MEMBER);
    revokeGrant.mockReturnValue(false);

    expect(grantsApi.delete(request({ id: ID })).status).toBe(404);
  });

  it('should answer 400 when no grant is named', () => {
    signIn('alice', MEMBER);

    expect(grantsApi.delete(request()).status).toBe(400);
    expect(grantsApi.delete(request({ id: '' })).status).toBe(400);
    expect(revokeGrant).not.toHaveBeenCalled();
  });

  it.each([[[]], [ADMIN]])(
    'should refuse a caller with roles %j, lacking the MCP role',
    (roles) => {
      signIn('alice', roles);

      expect(grantsApi.get(request()).status).toBe(403);
      expect(grantsApi.delete(request({ id: ID })).status).toBe(403);
      expect(listGrants).not.toHaveBeenCalled();
      expect(revokeGrant).not.toHaveBeenCalled();
    },
  );

  it('should refuse an anonymous caller', () => {
    getUser.mockReturnValue(null);
    hasRole.mockReturnValue(true);

    expect(grantsApi.get(request()).status).toBe(403);
    expect(grantsApi.delete(request({ id: ID })).status).toBe(403);
    expect(listGrants).not.toHaveBeenCalled();
    expect(revokeGrant).not.toHaveBeenCalled();
  });
});

describe('grants API: admin', () => {
  it('should list every grant with its owner for an admin', () => {
    signIn('admin', ADMIN);
    listGrants.mockReturnValue([
      grant(ALICE, { redirectUri: 'https://claude.ai/api/mcp/auth_callback' }),
      grant(BOB, { id: 'b'.repeat(64), redirectUri: 'http://localhost:6274/callback' }),
    ]);

    const response = grantsApi.get(request({ all: 'true' }));

    expect(listGrants).toHaveBeenCalledWith();
    expect(response.headers).toEqual({ 'Cache-Control': 'no-store' });
    const dates = { created: '2026-10-01T00:00:00.000Z', expires: '2026-11-30T00:00:00.000Z' };
    expect(body(response)).toEqual({
      data: {
        grants: [
          { owner: ALICE, id: ID, client: 'Claude', clientId: 'client-x', ...dates },
          {
            owner: BOB,
            id: 'b'.repeat(64),
            client: 'localhost:6274',
            clientId: 'client-x',
            ...dates,
          },
        ],
      },
    });
  });

  it('should let an admin revoke another user’s grant, logging who did it but not the id', () => {
    signIn('admin', ADMIN);
    revokeGrant.mockReturnValue(true);

    expect(grantsApi.delete(request({ id: ID, owner: BOB })).status).toBe(200);
    expect(revokeGrant).toHaveBeenCalledWith(ID, BOB);
    const logged = String(info.mock.calls[0][0]);
    expect(logged).toContain('user:system:admin');
    expect(logged).toContain(BOB);
    expect(logged).not.toContain(ID);
  });

  it('should answer 404 on the admin path when the grant is not that owner’s', () => {
    signIn('admin', ADMIN);
    revokeGrant.mockReturnValue(false);

    expect(grantsApi.delete(request({ id: ID, owner: ALICE })).status).toBe(404);
    expect(info).not.toHaveBeenCalled();
  });

  it('should refuse the admin paths to a member who is not an admin', () => {
    signIn('alice', MEMBER);

    expect(grantsApi.get(request({ all: 'true' })).status).toBe(403);
    expect(grantsApi.delete(request({ id: ID, owner: BOB })).status).toBe(403);
    expect(listGrants).not.toHaveBeenCalled();
    expect(revokeGrant).not.toHaveBeenCalled();
  });
});
