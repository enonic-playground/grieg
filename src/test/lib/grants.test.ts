import * as auditLib from '/lib/xp/auditlog';
import * as nodeLib from '/lib/xp/node';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OwnerCheck } from '../../main/resources/lib/grants';
import type { AuthorizeRequest } from '../../main/resources/lib/oauth';

import {
  exchangeCode,
  initGrantStore,
  issueCode,
  listGrants,
  refresh,
  resolveAccess,
  revokeGrant,
} from '../../main/resources/lib/grants';

const random = vi.hoisted(() => ({ next: 0 }));

vi.mock('../../main/resources/lib/key-crypto', () => ({
  // Distinct 43-character tokens, so every code, key and refresh token differs.
  randomToken: () => `t${String(++random.next).padStart(42, '0')}`,
  sha256Hex: (text: string) => createHash('sha256').update(text, 'utf8').digest('hex'),
  sha256Base64Url: (text: string) => createHash('sha256').update(text, 'utf8').digest('base64url'),
}));

const connect = vi.mocked(nodeLib.connect);
const auditLog = vi.mocked(auditLib.log);

type StoredNode = Record<string, unknown> & { _id: string; _name: string; _path: string };

// An in-memory stand-in for a lib-node connection: paths, ids, parent-path and owner queries.
function createStore() {
  const nodes = new Map<string, StoredNode>();
  let ids = 0;
  const find = (key: string): StoredNode | undefined =>
    key.startsWith('/') ? [...nodes.values()].find((node) => node._path === key) : nodes.get(key);
  const termsOf = (query: unknown): Record<string, string> =>
    Object.fromEntries(
      [...JSON.stringify(query).matchAll(/"field":"([^"]+)","value":"([^"]+)"/g)].map((m) => [
        m[1],
        m[2],
      ]),
    );
  const connection = {
    exists: vi.fn((key: string) => find(key) != null),
    create: vi.fn((params: Record<string, unknown>) => {
      const parent = params._parentPath as string;
      const path = `${parent === '/' ? '' : parent}/${params._name as string}`;
      if (find(path) != null) throw new Error(`Node already exists at ${path}`);
      const node = { ...params, _id: `n${++ids}`, _path: path } as StoredNode;
      nodes.set(node._id, node);
      return { ...node };
    }),
    get: vi.fn((keys: string | string[]) => {
      if (Array.isArray(keys)) return keys.map(find).filter((node) => node != null);
      const node = find(keys);
      return node == null ? null : { ...node };
    }),
    update: vi.fn(({ key, editor }: { key: string; editor: (n: StoredNode) => StoredNode }) => {
      const node = find(key);
      if (node == null) throw new Error(`No node ${key}`);
      const edited = editor({ ...node });
      nodes.set(node._id, edited);
      return edited;
    }),
    delete: vi.fn((...keys: (string | string[])[]) => {
      const deleted: string[] = [];
      for (const key of keys.flat()) {
        const node = find(key);
        if (node != null && nodes.delete(node._id)) deleted.push(node._id);
      }
      return deleted;
    }),
    query: vi.fn(({ query }: { query: unknown }) => {
      const terms = termsOf(query);
      const hits = [...nodes.values()].filter(
        (node) =>
          node._path === `${terms._parentPath}/${node._name}` &&
          (terms.owner == null || node.owner === terms.owner),
      );
      return { total: hits.length, count: hits.length, hits: hits.map((n) => ({ id: n._id })) };
    }),
    refresh: vi.fn(),
    applyPermissions: vi.fn(),
  };
  return { nodes, connection, find };
}

let store: ReturnType<typeof createStore>;

const OWNER = 'user:system:alice';
const ORIGIN = 'https://cms.example.com';
const RESOURCE = `${ORIGIN}/api/com.enonic.app.grieg:mcp`;
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'v'.repeat(43);
const T0 = new Date('2026-10-19T12:00:00.000Z');
const HOUR = 3_600_000;

const allowed: OwnerCheck = () => ({ admin: false });
const lifetimes = { accessTokenTtlMs: HOUR, refreshTokenTtlMs: 30 * 24 * HOUR };
const deps = { ...lifetimes, checkOwner: allowed };

const warning = vi.fn();

function s256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('base64url');
}

function request(overrides: Partial<AuthorizeRequest> = {}): AuthorizeRequest {
  return {
    clientId: 'claude',
    redirectUri: CLAUDE,
    challenge: s256(VERIFIER),
    resource: RESOURCE,
    state: 'xyz',
    ...overrides,
  };
}

function at(ms: number): Date {
  return new Date(T0.getTime() + ms);
}

function exchange(code: string, overrides: Record<string, string | undefined> = {}, now = T0) {
  return exchangeCode(
    { code, clientId: 'claude', redirectUri: CLAUDE, verifier: VERIFIER, ...overrides },
    deps,
    now,
  );
}

function tokens(now = T0) {
  const result = exchange(issueCode(OWNER, request(), now), {}, now);
  if ('error' in result) throw new Error(result.error);
  return result;
}

function nodesUnder(parent: string): StoredNode[] {
  return [...store.nodes.values()].filter((node) => node._path.startsWith(`${parent}/`));
}

beforeEach(() => {
  vi.clearAllMocks();
  random.next = 0;
  store = createStore();
  connect.mockReturnValue(store.connection as never);
  vi.stubGlobal('log', { warning, info: vi.fn(), error: vi.fn() });
  initGrantStore(T0);
});

describe('initGrantStore', () => {
  it('should create the admin-only folders for grants, codes and access keys', () => {
    const folders = [
      '/mcp',
      '/mcp/oauth',
      '/mcp/oauth/grants',
      '/mcp/oauth/codes',
      '/mcp/oauth/access',
    ];
    for (const path of folders) {
      expect(store.find(path)?._permissions, path).toEqual([
        expect.objectContaining({ principal: 'role:system.admin' }),
      ]);
    }
  });
});

describe('issueCode', () => {
  it('should store the code only as its digest, bound to the owner, client and challenge', () => {
    const code = issueCode(OWNER, request(), T0);

    const [node] = nodesUnder('/mcp/oauth/codes');
    expect(node).toMatchObject({
      _name: createHash('sha256').update(code).digest('hex'),
      owner: OWNER,
      clientId: 'claude',
      redirectUri: CLAUDE,
      challenge: s256(VERIFIER),
      resource: RESOURCE,
      expires: '2026-10-19T12:01:00.000Z',
    });
    expect(JSON.stringify(node)).not.toContain(code);
  });
});

describe('exchangeCode', () => {
  it('should issue a grieg_ access key for an hour and a refresh token', () => {
    const result = tokens();

    expect(result).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });
    expect(result.access_token).toMatch(/^grieg_[\w-]{43}$/);
    expect(result.refresh_token).toMatch(/^[\da-f]{64}\.[\w-]{43}$/);
    expect(resolveAccess(result.access_token, T0)).toEqual({ owner: OWNER, clientId: 'claude' });
  });

  it('should store neither token in plaintext', () => {
    const result = tokens();

    const stored = JSON.stringify([...store.nodes.values()]);
    expect(stored).not.toContain(result.access_token);
    expect(stored).not.toContain(result.refresh_token.split('.')[1]);
  });

  it('should record the grant with its client, redirect and a 90-day end, and audit it', () => {
    tokens();

    expect(listGrants(OWNER)).toEqual([
      expect.objectContaining({
        owner: OWNER,
        clientId: 'claude',
        redirectUri: CLAUDE,
        created: T0.toISOString(),
        expires: '2027-01-17T12:00:00.000Z',
      }),
    ]);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'grieg.oauth.grant', user: OWNER }),
    );
  });

  it.each([
    ['a wrong verifier', { verifier: 'w'.repeat(43) }],
    ['no verifier', { verifier: undefined }],
    ['another client_id', { clientId: 'chatgpt' }],
    [
      'another redirect_uri',
      { redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect' },
    ],
  ])('should refuse %s with invalid_grant and issue nothing', (_name, overrides) => {
    const code = issueCode(OWNER, request(), T0);

    expect(exchange(code, overrides)).toMatchObject({ status: 400, error: 'invalid_grant' });
    expect(nodesUnder('/mcp/oauth/grants')).toEqual([]);
    expect(nodesUnder('/mcp/oauth/access')).toEqual([]);
  });

  it('should refuse another resource with invalid_target', () => {
    const code = issueCode(OWNER, request(), T0);

    expect(exchange(code, { resource: 'https://other.example/mcp' })).toMatchObject({
      error: 'invalid_target',
    });
  });

  it('should refuse an unknown code', () => {
    expect(exchange('x'.repeat(43))).toMatchObject({ error: 'invalid_grant' });
  });

  it('should refuse a code after its minute is up', () => {
    const code = issueCode(OWNER, request(), T0);

    expect(exchange(code, {}, at(60_000))).toMatchObject({ error: 'invalid_grant' });
  });

  it('should refuse a replayed code and revoke what the first exchange issued', () => {
    const code = issueCode(OWNER, request(), T0);
    const first = exchange(code);
    if ('error' in first) throw new Error(first.error);

    expect(exchange(code)).toMatchObject({ error: 'invalid_grant' });
    expect(resolveAccess(first.access_token, T0)).toBeUndefined();
    expect(listGrants(OWNER)).toEqual([]);
  });

  it('should revoke on a replay even when the replay itself is otherwise wrong', () => {
    const code = issueCode(OWNER, request(), T0);
    exchange(code);

    expect(exchange(code, { clientId: 'chatgpt', verifier: 'w'.repeat(43) })).toMatchObject({
      error: 'invalid_grant',
    });
    expect(listGrants(OWNER)).toEqual([]);
  });

  it('should revoke what a concurrent exchange of the same code issued', () => {
    const code = issueCode(OWNER, request(), T0);
    // The other exchange claims the code between this one's read and its claim.
    store.connection.update.mockImplementationOnce(({ key, editor }) => {
      exchange(code);
      return store.connection.update({ key, editor });
    });

    expect(exchange(code)).toMatchObject({ error: 'invalid_grant' });
    expect(listGrants(OWNER)).toEqual([]);
    expect(nodesUnder('/mcp/oauth/access')).toEqual([]);
  });

  it('should revoke the first exchange when a replay lands before its grant exists', () => {
    const code = issueCode(OWNER, request(), T0);
    const replay = { result: undefined as unknown };
    // The replay runs while the first exchange is creating its tokens, after its claim.
    store.connection.create.mockImplementationOnce((params) => {
      replay.result = exchange(code);
      return store.connection.create(params);
    });

    expect(exchange(code)).toMatchObject({ error: 'invalid_grant' });
    expect(replay.result).toMatchObject({ error: 'invalid_grant' });
    expect(listGrants(OWNER)).toEqual([]);
  });

  it('should refuse the code of an owner who lost the role, before issuing anything', () => {
    const code = issueCode(OWNER, request(), T0);

    const result = exchangeCode(
      { code, clientId: 'claude', redirectUri: CLAUDE, verifier: VERIFIER },
      { ...lifetimes, checkOwner: () => ({ refusal: 'does not hold the role' }) },
      T0,
    );

    expect(result).toMatchObject({ error: 'invalid_grant' });
    expect(nodesUnder('/mcp/oauth/grants')).toEqual([]);
  });

  it('should keep a second connection from the same client as its own grant', () => {
    tokens();
    tokens();

    expect(listGrants(OWNER)).toHaveLength(2);
  });

  it('should keep only the owner’s 20 newest grants', () => {
    for (let i = 0; i < 21; i++) tokens(at(i * 1000));

    const grants = listGrants(OWNER);
    expect(grants).toHaveLength(20);
    expect(grants.at(-1)?.created).toBe(at(1000).toISOString());
  });
});

describe('refresh', () => {
  function rotate(refreshToken: string, now: Date, clientId = 'claude') {
    return refresh({ refreshToken, clientId }, deps, now);
  }

  it('should rotate the refresh token and issue a new access key', () => {
    const first = tokens();

    const second = rotate(first.refresh_token, at(HOUR));

    expect(second).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });
    if ('error' in second) throw new Error(second.error);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(second.access_token).not.toBe(first.access_token);
    expect(resolveAccess(second.access_token, at(HOUR))).toMatchObject({ owner: OWNER });
  });

  it('should keep the previous access key valid until its own expiry', () => {
    const first = tokens();

    rotate(first.refresh_token, at(HOUR / 2));

    expect(resolveAccess(first.access_token, at(HOUR / 2))).toMatchObject({ owner: OWNER });
    expect(resolveAccess(first.access_token, at(HOUR))).toEqual({
      reason: `OAuth key of ${OWNER} for claude expired at ${at(HOUR).toISOString()}`,
    });
  });

  it('should drop the access key two rotations back', () => {
    const first = tokens();
    const second = rotate(first.refresh_token, at(1000));
    if ('error' in second) throw new Error(second.error);
    rotate(second.refresh_token, at(2000));

    expect(resolveAccess(first.access_token, at(2000))).toBeUndefined();
  });

  it('should refuse the previous token within 30 s without revoking the grant', () => {
    const first = tokens();
    const second = rotate(first.refresh_token, at(1000));
    if ('error' in second) throw new Error(second.error);

    expect(rotate(first.refresh_token, at(20_000))).toMatchObject({ error: 'invalid_grant' });
    expect(rotate(second.refresh_token, at(21_000))).toMatchObject({ token_type: 'Bearer' });
  });

  it('should revoke the grant when a rotated token is used after 30 s', () => {
    const first = tokens();
    const second = rotate(first.refresh_token, at(1000));
    if ('error' in second) throw new Error(second.error);

    expect(rotate(first.refresh_token, at(40_000))).toMatchObject({ error: 'invalid_grant' });
    expect(rotate(second.refresh_token, at(41_000))).toMatchObject({ error: 'invalid_grant' });
    expect(resolveAccess(second.access_token, at(41_000))).toBeUndefined();
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'grieg.oauth.revoke',
        data: expect.objectContaining({ reason: 'refresh token reused' }),
      }),
    );
  });

  it('should lose a race to a concurrent rotation without revoking or leaving a key', () => {
    const first = tokens();
    const winner = { refresh: '' };
    // The other request's rotation lands between this request's read and its write.
    store.connection.update.mockImplementationOnce(({ key, editor }) => {
      const other = rotate(first.refresh_token, at(1000));
      if ('error' in other) throw new Error(other.error);
      winner.refresh = other.refresh_token;
      return store.connection.update({ key, editor });
    });

    const loser = rotate(first.refresh_token, at(1000));

    expect(loser).toMatchObject({ error: 'invalid_grant' });
    expect(nodesUnder('/mcp/oauth/access')).toHaveLength(2);
    expect(rotate(winner.refresh, at(2000))).toMatchObject({ token_type: 'Bearer' });
  });

  it('should refuse a refresh token presented by another client, without revoking', () => {
    const first = tokens();

    expect(rotate(first.refresh_token, at(1000), 'chatgpt')).toMatchObject({
      error: 'invalid_grant',
    });
    expect(rotate(first.refresh_token, at(2000))).toMatchObject({ token_type: 'Bearer' });
  });

  it('should revoke the grant when a token two rotations old comes back', () => {
    const first = tokens();
    // A thief rotates the stolen token twice; the victim then presents the original.
    const second = rotate(first.refresh_token, at(60_000));
    if ('error' in second) throw new Error(second.error);
    const third = rotate(second.refresh_token, at(61_000));
    if ('error' in third) throw new Error(third.error);

    expect(rotate(first.refresh_token, at(HOUR))).toMatchObject({ error: 'invalid_grant' });
    expect(listGrants(OWNER)).toEqual([]);
    expect(resolveAccess(third.access_token, at(HOUR))).toBeUndefined();
  });

  it('should treat any other secret on a real grant id as reuse', () => {
    tokens();
    const [grant] = listGrants(OWNER);

    expect(rotate(`${grant.id}.${'x'.repeat(43)}`, at(1000))).toMatchObject({
      error: 'invalid_grant',
    });
    expect(listGrants(OWNER)).toEqual([]);
  });

  it('should refuse another resource with invalid_target, without revoking', () => {
    const first = tokens();
    const other = {
      refreshToken: first.refresh_token,
      clientId: 'claude',
      resource: 'https://x.example/mcp',
    };

    expect(refresh(other, deps, at(1000))).toMatchObject({ error: 'invalid_target' });
    expect(rotate(first.refresh_token, at(2000))).toMatchObject({ token_type: 'Bearer' });
  });

  it.each(['garbage', `${'0'.repeat(64)}.${'x'.repeat(43)}`, 'a.b.c'])(
    'should refuse the unknown token %j',
    (token) => {
      expect(rotate(token, T0)).toMatchObject({ error: 'invalid_grant' });
    },
  );

  it('should end the grant once the refresh token sat idle past its lifetime', () => {
    const first = tokens();

    expect(rotate(first.refresh_token, at(31 * 24 * HOUR))).toMatchObject({
      error: 'invalid_grant',
    });
    expect(listGrants(OWNER)).toEqual([]);
  });

  it('should end the grant 90 days after consent however often it was refreshed', () => {
    let token = tokens().refresh_token;
    for (let day = 20; day < 90; day += 20) {
      const next = rotate(token, at(day * 24 * HOUR));
      if ('error' in next) throw new Error(next.error);
      token = next.refresh_token;
    }

    expect(rotate(token, at(90 * 24 * HOUR))).toMatchObject({ error: 'invalid_grant' });
  });

  it('should revoke the grant of an owner who lost the role', () => {
    const first = tokens();

    const result = refresh(
      { refreshToken: first.refresh_token, clientId: 'claude' },
      { ...lifetimes, checkOwner: () => ({ refusal: 'is disabled' }) },
      at(1000),
    );

    expect(result).toMatchObject({ error: 'invalid_grant' });
    expect(listGrants(OWNER)).toEqual([]);
  });
});

describe('resolveAccess', () => {
  it('should not know a bearer that was never issued', () => {
    expect(resolveAccess(`grieg_${'z'.repeat(43)}`, T0)).toBeUndefined();
  });

  it('should refuse a key whose grant is gone even if the key node was left behind', () => {
    const { access_token: token } = tokens();
    const grant = nodesUnder('/mcp/oauth/grants')[0];
    store.nodes.delete(grant._id);

    expect(resolveAccess(token, T0)).toEqual({ reason: 'OAuth key of a revoked grant' });
  });

  it('should refuse a key its grant no longer names, though its node is still there', () => {
    const { access_token: token } = tokens();
    const grant = nodesUnder('/mcp/oauth/grants')[0];
    grant.access = 'f'.repeat(64);

    expect(resolveAccess(token, T0)).toEqual({ reason: 'OAuth key of a revoked grant' });
  });

  it('should refuse a key past the grant’s end even before the key itself expires', () => {
    const { access_token: token } = tokens();
    const grant = nodesUnder('/mcp/oauth/grants')[0];
    grant.expires = at(1000).toISOString();

    expect(resolveAccess(token, at(2000))).toEqual({
      reason: `OAuth grant of ${OWNER} for claude ended at ${at(1000).toISOString()}`,
    });
  });

  it('should refuse a key once its grant sat idle past the refresh lifetime', () => {
    const code = issueCode(OWNER, request(), T0);
    const short = { ...deps, refreshTokenTtlMs: 10 * 60_000 };
    const result = exchangeCode(
      { code, clientId: 'claude', redirectUri: CLAUDE, verifier: VERIFIER },
      short,
      T0,
    );
    if ('error' in result) throw new Error(result.error);

    expect(resolveAccess(result.access_token, at(30 * 60_000))).toEqual({
      reason: `OAuth grant of ${OWNER} for claude ended at ${at(10 * 60_000).toISOString()}`,
    });
  });

  it('should record use on the key, never on the grant a refresh rotates', () => {
    const { access_token: token } = tokens();
    const [grant] = nodesUnder('/mcp/oauth/grants');
    store.connection.update.mockClear();

    resolveAccess(token, at(1000));

    expect(store.connection.update).toHaveBeenCalledTimes(1);
    expect(store.connection.update.mock.calls[0][0].key).not.toBe(grant._id);
  });

  it('should record use at most hourly', () => {
    const first = tokens();

    resolveAccess(first.access_token, at(1000));
    resolveAccess(first.access_token, at(2000));
    expect(listGrants(OWNER)[0].lastUsed).toBe(at(1000).toISOString());

    const second = refresh(
      { refreshToken: first.refresh_token, clientId: 'claude' },
      deps,
      at(HOUR / 2),
    );
    if ('error' in second) throw new Error(second.error);
    resolveAccess(second.access_token, at(1000 + HOUR));
    expect(listGrants(OWNER)[0].lastUsed).toBe(at(1000 + HOUR).toISOString());
  });
});

describe('revokeGrant', () => {
  it('should revoke a grant and its access keys at once', () => {
    const { access_token: token } = tokens();
    const [grant] = listGrants(OWNER);

    expect(revokeGrant(grant.id)).toBe(true);
    expect(resolveAccess(token, T0)).toBeUndefined();
    expect(listGrants()).toEqual([]);
  });

  it('should leave another owner’s grant alone when scoped to an owner', () => {
    tokens();
    const [grant] = listGrants(OWNER);

    expect(revokeGrant(grant.id, 'user:system:bob')).toBe(false);
    expect(listGrants(OWNER)).toHaveLength(1);
  });
});

describe('sweep', () => {
  it('should remove expired codes, expired access keys and idle grants on start', () => {
    issueCode(OWNER, request(), T0);
    tokens();

    initGrantStore(at(31 * 24 * HOUR));

    expect(nodesUnder('/mcp/oauth/codes')).toEqual([]);
    expect(nodesUnder('/mcp/oauth/access')).toEqual([]);
    expect(nodesUnder('/mcp/oauth/grants')).toEqual([]);
  });

  it('should leave live codes, keys and grants alone', () => {
    const now = at(10 * 24 * HOUR);
    const { access_token: token } = tokens(now);
    issueCode(OWNER, request(), now);

    initGrantStore(now);

    expect(nodesUnder('/mcp/oauth/codes')).toHaveLength(2);
    expect(resolveAccess(token, now)).toMatchObject({ owner: OWNER });
  });
});
