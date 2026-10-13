import * as authLib from '/lib/xp/auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpKey } from '../../main/resources/lib/keys';
import type { Request, Response } from '@enonic-types/core';

import * as keysApi from '../../main/resources/apis/keys/keys';
import * as keysLib from '../../main/resources/lib/keys';

vi.mock('../../main/resources/lib/keys', () => ({
  MCP_ROLE_NAME: 'com.enonic.app.grieg.mcp',
  MCP_ROLE: 'role:com.enonic.app.grieg.mcp',
  generate: vi.fn(),
  findByOwner: vi.fn(),
  list: vi.fn(),
  deleteByOwner: vi.fn(),
}));

const getUser = vi.mocked(authLib.getUser);
const hasRole = vi.mocked(authLib.hasRole);
const generate = vi.mocked(keysLib.generate);
const findByOwner = vi.mocked(keysLib.findByOwner);
const list = vi.mocked(keysLib.list);
const deleteByOwner = vi.mocked(keysLib.deleteByOwner);

const ALICE = 'user:system:alice';
const BOB = 'user:system:bob';
const PLAINTEXT = `grieg_${'a'.repeat(43)}`;

const error = vi.fn();
const info = vi.fn();

function key(owner: string, overrides: Partial<McpKey> = {}): McpKey {
  return {
    id: `id-${owner}`,
    owner,
    display: 'grieg_aaaa…aaaa',
    created: '2026-10-01T00:00:00.000Z',
    expires: '2026-12-30T00:00:00.000Z',
    ...overrides,
  };
}

function request(params: Record<string, string> = {}): Request {
  return {
    params,
    contentType: 'application/json; charset=utf-8',
    body: '{}',
  } as unknown as Request;
}

function body(response: Response): unknown {
  return JSON.parse(response.body as string);
}

function signIn(login: string, roles: string[]): void {
  getUser.mockReturnValue({ key: `user:system:${login}` } as never);
  hasRole.mockImplementation((role) => roles.includes(role));
}

const MEMBER = ['com.enonic.app.grieg.mcp'];
const ADMIN = ['system.admin'];
const ADMIN_MEMBER = [...ADMIN, ...MEMBER];

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('log', { error, info, warning: vi.fn() });
});

describe('keys API: own key', () => {
  it('should return the caller’s key metadata without its id or owner', () => {
    signIn('alice', MEMBER);
    findByOwner.mockReturnValue(key(ALICE, { lastUsed: '2026-10-02T00:00:00.000Z' }));

    const response = keysApi.get(request());

    expect(findByOwner).toHaveBeenCalledWith(ALICE);
    expect(body(response)).toEqual({
      data: {
        display: 'grieg_aaaa…aaaa',
        created: '2026-10-01T00:00:00.000Z',
        expires: '2026-12-30T00:00:00.000Z',
        lastUsed: '2026-10-02T00:00:00.000Z',
      },
    });
  });

  it('should return null when the caller holds no key', () => {
    signIn('alice', MEMBER);
    findByOwner.mockReturnValue(undefined);

    expect(body(keysApi.get(request()))).toEqual({ data: null });
  });

  it('should ignore an owner parameter and act on the caller only', () => {
    signIn('alice', MEMBER);
    generate.mockReturnValue({ key: PLAINTEXT, record: key(ALICE) });

    keysApi.get(request({ owner: BOB }));
    keysApi.post(request({ owner: BOB }));

    expect(findByOwner).toHaveBeenCalledWith(ALICE);
    expect(generate).toHaveBeenCalledWith(ALICE);
  });

  it('should return the plaintext key once, uncacheable, on generate', () => {
    signIn('alice', MEMBER);
    generate.mockReturnValue({ key: PLAINTEXT, record: key(ALICE) });

    const response = keysApi.post(request());

    expect(response.status).toBe(201);
    expect(response.headers).toEqual({ 'Cache-Control': 'no-store' });
    expect(body(response)).toEqual({
      data: {
        key: PLAINTEXT,
        display: 'grieg_aaaa…aaaa',
        created: '2026-10-01T00:00:00.000Z',
        expires: '2026-12-30T00:00:00.000Z',
      },
    });
    findByOwner.mockReturnValue(key(ALICE));
    expect(keysApi.get(request()).body).not.toContain(PLAINTEXT);
  });

  it('should refuse a generate request that is not JSON, as a cross-site form would send', () => {
    signIn('alice', MEMBER);

    for (const contentType of [undefined, 'application/x-www-form-urlencoded', 'text/plain']) {
      const response = keysApi.post({ params: {}, contentType } as unknown as Request);
      expect(response.status).toBe(415);
    }
    expect(generate).not.toHaveBeenCalled();
  });

  it('should answer an error with no key, and log no key, when generate fails', () => {
    signIn('alice', MEMBER);
    generate.mockImplementation(() => {
      throw new Error(`cannot delete /mcp/keys/${'f'.repeat(64)} after ${PLAINTEXT}`);
    });

    const response = keysApi.post(request());

    expect(response.status).toBe(500);
    expect(body(response)).toMatchObject({ code: 'KEY_NOT_GENERATED' });
    expect(response.body).not.toContain('grieg_a');
    const logged = String(error.mock.calls[0][0]);
    expect(logged).toContain(ALICE);
    expect(logged).not.toContain(PLAINTEXT);
    expect(logged).not.toContain('f'.repeat(64));
  });

  it('should delete the caller’s key', () => {
    signIn('alice', MEMBER);
    deleteByOwner.mockReturnValue(true);

    const response = keysApi.delete(request());

    expect(deleteByOwner).toHaveBeenCalledWith(ALICE);
    expect(body(response)).toEqual({ data: { owner: ALICE } });
  });

  it('should answer 404 when the caller has no key to delete', () => {
    signIn('alice', MEMBER);
    deleteByOwner.mockReturnValue(false);

    expect(keysApi.delete(request()).status).toBe(404);
  });

  it('should refuse a caller without the MCP role, admins included', () => {
    for (const roles of [[], ADMIN]) {
      signIn('alice', roles);

      expect(keysApi.get(request()).status).toBe(403);
      expect(keysApi.post(request()).status).toBe(403);
      expect(keysApi.delete(request()).status).toBe(403);
    }
    expect(findByOwner).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(deleteByOwner).not.toHaveBeenCalled();
  });

  it('should refuse an anonymous caller', () => {
    getUser.mockReturnValue(null);
    hasRole.mockReturnValue(true);

    expect(keysApi.post(request()).status).toBe(403);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('keys API: admin', () => {
  it('should list every key with its owner for an admin', () => {
    signIn('admin', ADMIN);
    list.mockReturnValue([key(ALICE), key(BOB)]);

    const response = keysApi.get(request({ all: 'true' }));

    expect(body(response)).toEqual({
      data: {
        keys: [ALICE, BOB].map((owner) => ({
          owner,
          display: 'grieg_aaaa…aaaa',
          created: '2026-10-01T00:00:00.000Z',
          expires: '2026-12-30T00:00:00.000Z',
        })),
      },
    });
  });

  it('should revoke another user’s key for an admin', () => {
    signIn('admin', ADMIN);
    deleteByOwner.mockReturnValue(true);

    const response = keysApi.delete(request({ owner: BOB }));

    expect(deleteByOwner).toHaveBeenCalledWith(BOB);
    expect(body(response)).toEqual({ data: { owner: BOB } });
    expect(info).toHaveBeenCalledWith(`user:system:admin revoked the MCP key of ${BOB}`);
  });

  it('should answer 404 when the revoked owner holds no key', () => {
    signIn('admin', ADMIN_MEMBER);
    deleteByOwner.mockReturnValue(false);

    expect(keysApi.delete(request({ owner: BOB })).status).toBe(404);
  });

  it('should refuse the admin paths to a role member who is not an admin', () => {
    signIn('alice', MEMBER);

    expect(keysApi.get(request({ all: 'true' })).status).toBe(403);
    expect(keysApi.delete(request({ owner: BOB })).status).toBe(403);
    expect(list).not.toHaveBeenCalled();
    expect(deleteByOwner).not.toHaveBeenCalled();
  });
});
