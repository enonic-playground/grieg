import * as authLib from '/lib/xp/auth';
import * as contextLib from '/lib/xp/context';
import * as nodeLib from '/lib/xp/node';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  authenticate,
  deleteByOwner,
  findByOwner,
  generate,
  initKeyStore,
  isAdmin,
  isExpired,
  list,
  resolve,
  touch,
  type McpKey,
} from '../../main/resources/lib/keys';

const TOKEN = `abcd${'x'.repeat(35)}wxyz`;

vi.mock('../../main/resources/lib/key-crypto', () => ({
  randomToken: () => TOKEN,
  sha256Hex: (text: string) => createHash('sha256').update(text, 'utf8').digest('hex'),
}));

const connect = vi.mocked(nodeLib.connect);
const run = vi.mocked(contextLib.run);
const getPrincipal = vi.mocked(authLib.getPrincipal);
const createRole = vi.mocked(authLib.createRole);
const getMemberships = vi.mocked(authLib.getMemberships);

const OWNER = 'user:system:alice';
const NOW = new Date('2026-10-13T10:00:00.000Z');
const ADMIN_ONLY = [
  {
    principal: 'role:system.admin',
    allow: [
      'READ',
      'CREATE',
      'MODIFY',
      'DELETE',
      'PUBLISH',
      'READ_PERMISSIONS',
      'WRITE_PERMISSIONS',
    ],
  },
];
const KEYS_PARENT = { term: { field: '_parentPath', value: '/mcp/keys' } };

const connection = {
  exists: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  query: vi.fn(),
  delete: vi.fn(),
  update: vi.fn(),
  refresh: vi.fn(),
  applyPermissions: vi.fn(),
};

const warning = vi.fn();

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function record(overrides: Partial<McpKey> = {}): McpKey {
  return {
    id: 'k1',
    owner: OWNER,
    display: 'grieg_abcd…wxyz',
    created: '2026-10-01T00:00:00.000Z',
    expires: '2026-12-30T00:00:00.000Z',
    ...overrides,
  };
}

function storedNode(key: McpKey): Record<string, unknown> {
  const { id, ...data } = key;
  return { _id: id, _name: 'digest', _path: '/mcp/keys/digest', ...data };
}

// In-memory stand-in for the key query: honours the parent and owner terms.
function storeKeys(...keys: McpKey[]): void {
  connection.query.mockImplementation(({ query }: { query: Record<string, unknown> }) => {
    const owner = JSON.stringify(query).match(/"field":"owner","value":"([^"]+)"/)?.[1];
    const hits = keys.filter((key) => owner == null || key.owner === owner);
    return { total: hits.length, count: hits.length, hits: hits.map(({ id }) => ({ id })) };
  });
  connection.get.mockImplementation((ids: string[] | string) =>
    Array.isArray(ids) ? keys.filter((key) => ids.includes(key.id)).map(storedNode) : null,
  );
}

function ownerQuery(owner: string) {
  return expect.objectContaining({
    query: { boolean: { must: [KEYS_PARENT, { term: { field: 'owner', value: owner } }] } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('log', { warning, info: vi.fn() });
  for (const fn of Object.values(connection)) fn.mockReset();
  connect.mockReturnValue(connection as never);
  connection.exists.mockReturnValue(true);
  connection.query.mockReturnValue({ total: 0, count: 0, hits: [] });
  connection.create.mockImplementation((params: Record<string, unknown>) => ({
    _id: 'new',
    ...params,
  }));
  getPrincipal.mockReset();
  getPrincipal.mockReturnValue({} as never);
  createRole.mockReset();
  getMemberships.mockReset();
});

describe('generate', () => {
  it('should prefix the generated token with grieg_', () => {
    const { key } = generate(OWNER, NOW);

    expect(key).toBe(`grieg_${TOKEN}`);
  });

  it('should store the key under its SHA-256 digest and never store the plaintext', () => {
    const { key } = generate(OWNER, NOW);

    const params = connection.create.mock.calls[0][0];
    expect(params).toMatchObject({
      _name: sha256(key),
      _parentPath: '/mcp/keys',
      _inheritsPermissions: true,
    });
    expect(JSON.stringify(params)).not.toContain(TOKEN);
  });

  it('should expire the key 90 days after creation', () => {
    const { record: created } = generate(OWNER, NOW);

    expect(created.created).toBe('2026-10-13T10:00:00.000Z');
    expect(created.expires).toBe('2027-01-11T10:00:00.000Z');
  });

  it('should show only the first and last four random characters', () => {
    const { record: created } = generate(OWNER, NOW);

    expect(created.display).toBe('grieg_abcd…wxyz');
  });

  it('should keep the previous key until the new one is created', () => {
    storeKeys(record({ id: 'old' }));

    generate(OWNER, NOW);

    expect(connection.query).toHaveBeenCalledWith(ownerQuery(OWNER));
    expect(connection.create).toHaveBeenCalledBefore(connection.delete);
    expect(connection.delete).toHaveBeenCalledWith(['old']);
    expect(connection.refresh).toHaveBeenCalledBefore(connection.query);
  });

  it('should fail and drop the new key when the previous one cannot be removed', () => {
    storeKeys(record({ id: 'old' }));
    connection.delete.mockImplementation((ids: string[] | string) => {
      if (Array.isArray(ids)) throw new Error('storage down');
      return [ids];
    });

    expect(() => generate(OWNER, NOW)).toThrow('storage down');
    expect(connection.delete).toHaveBeenLastCalledWith('new');
  });

  it('should fail before creating anything when the index cannot be refreshed', () => {
    connection.refresh.mockImplementation(() => {
      throw new Error('refresh failed');
    });

    expect(() => generate(OWNER, NOW)).toThrow('refresh failed');
    expect(connection.create).not.toHaveBeenCalled();
  });

  it.each(['role:system.admin', 'group:system:admins', 'user:system'])(
    'should refuse %s as an owner',
    (owner) => {
      expect(() => generate(owner, NOW)).toThrow(/not a user key/);
      expect(connection.create).not.toHaveBeenCalled();
    },
  );

  it('should run as admin in the app repository', () => {
    generate(OWNER, NOW);

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        repository: 'com.enonic.app.grieg',
        principals: ['role:system.admin'],
      }),
      expect.any(Function),
    );
  });
});

describe('resolve', () => {
  it('should get the key node by its digest path', () => {
    const key = `grieg_${'a'.repeat(43)}`;
    connection.get.mockReturnValue(storedNode(record()));

    expect(resolve(key)).toEqual(record());
    expect(connection.get).toHaveBeenCalledWith(`/mcp/keys/${sha256(key)}`);
  });

  it('should return undefined for an unknown key', () => {
    connection.get.mockReturnValue(null);

    expect(resolve(`grieg_${'a'.repeat(43)}`)).toBeUndefined();
  });

  it.each([
    'grieg_short',
    `grieg_${'a'.repeat(44)}`,
    `grieg_${'a'.repeat(42)}+`,
    `other_${'a'.repeat(43)}`,
  ])('should not look up the malformed key %s', (key) => {
    expect(resolve(key)).toBeUndefined();
    expect(connection.get).not.toHaveBeenCalled();
  });
});

describe('authenticate', () => {
  const KEY = `grieg_${'a'.repeat(43)}`;

  function entitle(...roles: string[]): void {
    getMemberships.mockReturnValue(roles.map((key) => ({ key })) as never);
  }

  beforeEach(() => {
    connection.get.mockReturnValue(storedNode(record()));
    entitle('role:system.everyone', 'role:com.enonic.app.grieg.mcp');
  });

  it("should resolve the owner's login and ID provider and record the use", () => {
    expect(authenticate(KEY, NOW)).toEqual({ login: 'alice', idProvider: 'system', admin: false });
    expect(getMemberships).toHaveBeenCalledWith(OWNER, true);
    expect(connection.update).toHaveBeenCalledTimes(1);
  });

  it('should report an admin owner without a second membership lookup', () => {
    entitle('role:com.enonic.app.grieg.mcp', 'role:system.admin');

    expect(authenticate(KEY, NOW)).toEqual({ login: 'alice', idProvider: 'system', admin: true });
    expect(getMemberships).toHaveBeenCalledTimes(1);
  });

  it('should look the owner up as admin', () => {
    let asAdmin = false;
    const seen: boolean[] = [];
    run.mockImplementation((context, callback) => {
      asAdmin =
        (context as { principals?: string[] }).principals?.includes('role:system.admin') ?? false;
      try {
        return callback();
      } finally {
        asAdmin = false;
      }
    });
    getPrincipal.mockImplementation((() => {
      seen.push(asAdmin);
      return {};
    }) as never);
    getMemberships.mockImplementation(() => {
      seen.push(asAdmin);
      return [{ key: 'role:com.enonic.app.grieg.mcp' }] as never;
    });

    authenticate(KEY, NOW);

    expect(seen).toEqual([true, true]);
  });

  it.each<[string, () => void, string]>([
    ['an unknown key', () => connection.get.mockReturnValue(null), 'unknown MCP key'],
    [
      'an expired key',
      () => connection.get.mockReturnValue(storedNode(record({ expires: NOW.toISOString() }))),
      `MCP key of ${OWNER} expired`,
    ],
    [
      'a non-user owner',
      () => connection.get.mockReturnValue(storedNode(record({ owner: 'role:system.admin' }))),
      'is not a user',
    ],
    ['a missing owner', () => getPrincipal.mockReturnValue(null), 'no longer exists'],
    [
      'a disabled owner',
      () => getPrincipal.mockReturnValue({ disabled: true } as never),
      'is disabled',
    ],
    [
      'an owner outside the role',
      () => entitle('role:system.everyone'),
      'does not hold role:com.enonic.app.grieg.mcp',
    ],
  ])('should refuse %s without recording use or logging the key', (_label, arrange, reason) => {
    arrange();

    const result = authenticate(KEY, NOW);

    expect(result).toEqual({ reason: expect.stringContaining(reason) });
    expect(JSON.stringify(result)).not.toContain('a'.repeat(8));
    expect(JSON.stringify(result)).not.toContain(sha256(KEY));
    expect(connection.update).not.toHaveBeenCalled();
  });
});

describe('isAdmin', () => {
  it('should answer from transitive memberships, looked up as admin', () => {
    const seen: boolean[] = [];
    let asAdmin = false;
    run.mockImplementation((context, callback) => {
      asAdmin =
        (context as { principals?: string[] }).principals?.includes('role:system.admin') ?? false;
      try {
        return callback();
      } finally {
        asAdmin = false;
      }
    });
    getMemberships.mockImplementation(() => {
      seen.push(asAdmin);
      return [{ key: 'role:system.admin' }] as never;
    });

    expect(isAdmin('user:system:editor')).toBe(true);
    expect(getMemberships).toHaveBeenCalledWith('user:system:editor', true);
    expect(seen).toEqual([true]);
  });

  it('should answer false for a user without the role', () => {
    getMemberships.mockReturnValue([{ key: 'role:system.everyone' }] as never);

    expect(isAdmin('user:system:editor')).toBe(false);
  });

  it('should answer false for a key that is not a user, without a lookup', () => {
    getMemberships.mockReturnValue([{ key: 'role:system.admin' }] as never);

    expect(isAdmin('role:system.admin')).toBe(false);
    expect(getMemberships).not.toHaveBeenCalled();
  });
});

describe('findByOwner, list and deleteByOwner', () => {
  const bob = record({ id: 'k2', owner: 'user:system:bob' });

  it("should return the owner's key and not another user's", () => {
    storeKeys(bob, record());

    expect(findByOwner(OWNER)).toEqual(record());
    expect(connection.query).toHaveBeenCalledWith(ownerQuery(OWNER));
  });

  it('should return the newest key when the owner has more than one', () => {
    const newer = record({ id: 'k3', created: '2026-10-02T00:00:00.000Z' });
    storeKeys(record(), newer);

    expect(findByOwner(OWNER)).toEqual(newer);
  });

  it('should return undefined when the owner has no key', () => {
    storeKeys(bob);

    expect(findByOwner(OWNER)).toBeUndefined();
  });

  it('should warn when the query cap truncates the keys', () => {
    connection.query.mockReturnValue({ total: 10_001, count: 1, hits: [{ id: 'k1' }] });
    connection.get.mockReturnValue([storedNode(record())]);

    expect(list()).toEqual([record()]);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('1 of 10001'));
  });

  it('should list every key', () => {
    storeKeys(record(), bob);

    expect(list()).toEqual([record(), bob]);
    expect(connection.query).toHaveBeenCalledWith(
      expect.objectContaining({ count: 10_000, query: KEYS_PARENT }),
    );
  });

  it("should delete only the owner's keys", () => {
    storeKeys(record(), bob);

    expect(deleteByOwner(OWNER)).toBe(true);
    expect(connection.delete).toHaveBeenCalledWith(['k1']);
    expect(connection.refresh).toHaveBeenCalledBefore(connection.query);
  });

  it('should report false when the owner has no key', () => {
    storeKeys(bob);

    expect(deleteByOwner(OWNER)).toBe(false);
    expect(connection.delete).not.toHaveBeenCalled();
  });
});

describe('isExpired', () => {
  it('should treat the expiry instant itself as expired', () => {
    expect(isExpired(record({ expires: NOW.toISOString() }), NOW)).toBe(true);
    expect(isExpired(record({ expires: '2026-10-13T10:00:01.000Z' }), NOW)).toBe(false);
  });

  it('should treat a missing or malformed expiry as expired', () => {
    expect(isExpired(record({ expires: 'garbage' }), NOW)).toBe(true);
    expect(isExpired(record({ expires: undefined as never }), NOW)).toBe(true);
  });
});

describe('touch', () => {
  it('should write lastUsed when it was never set', () => {
    touch(record(), NOW);

    expect(connection.update).toHaveBeenCalledTimes(1);
    const { key, editor } = connection.update.mock.calls[0][0];
    expect(key).toBe('k1');
    expect(editor({ owner: OWNER })).toEqual({ owner: OWNER, lastUsed: NOW.toISOString() });
  });

  it('should skip the write within an hour of the last one', () => {
    touch(record({ lastUsed: '2026-10-13T09:00:01.000Z' }), NOW);

    expect(connection.update).not.toHaveBeenCalled();
  });

  it('should write again once an hour has passed', () => {
    touch(record({ lastUsed: '2026-10-13T09:00:00.000Z' }), NOW);

    expect(connection.update).toHaveBeenCalledTimes(1);
  });

  it('should log and swallow a failed write', () => {
    connection.update.mockImplementation(() => {
      throw new Error('node not found');
    });

    expect(() => touch(record(), NOW)).not.toThrow();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining(OWNER));
  });
});

describe('initKeyStore', () => {
  it('should create /mcp and /mcp/keys as admin-only folders', () => {
    connection.exists.mockReturnValue(false);

    initKeyStore();

    expect(connection.create).toHaveBeenCalledWith({
      _name: 'mcp',
      _parentPath: '/',
      _permissions: ADMIN_ONLY,
    });
    expect(connection.create).toHaveBeenCalledWith({
      _name: 'keys',
      _parentPath: '/mcp',
      _permissions: ADMIN_ONLY,
    });
  });

  it('should reset an existing folder with another ACL, descendants included', () => {
    connection.get.mockImplementation((path: string) =>
      path === '/mcp'
        ? { _permissions: [{ principal: 'role:system.authenticated', allow: ['READ'] }] }
        : { _permissions: ADMIN_ONLY },
    );

    initKeyStore();

    expect(connection.create).not.toHaveBeenCalled();
    expect(connection.applyPermissions).toHaveBeenCalledTimes(1);
    expect(connection.applyPermissions).toHaveBeenCalledWith({
      key: '/mcp',
      permissions: ADMIN_ONLY,
      scope: 'TREE',
    });
  });

  it('should leave an existing admin-only folder alone, whatever the entry order', () => {
    connection.get.mockReturnValue({
      _permissions: [{ ...ADMIN_ONLY[0], allow: [...ADMIN_ONLY[0].allow].reverse(), deny: [] }],
    });

    initKeyStore();

    expect(connection.applyPermissions).not.toHaveBeenCalled();
  });

  it('should tolerate another node creating a folder first', () => {
    connection.exists.mockReturnValueOnce(false).mockReturnValue(true);
    connection.create.mockImplementation(() => {
      throw new Error('already exists');
    });

    expect(() => initKeyStore()).not.toThrow();
    expect(connection.create).toHaveBeenCalledTimes(1);
  });

  it('should rethrow when the folder still does not exist after a failed create', () => {
    connection.exists.mockReturnValue(false);
    connection.create.mockImplementation(() => {
      throw new Error('already exists');
    });

    expect(() => initKeyStore()).toThrow('already exists');
  });

  it('should create the role when it is missing', () => {
    getPrincipal.mockReturnValue(null);

    initKeyStore();

    expect(createRole).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'com.enonic.app.grieg.mcp' }),
    );
  });

  it('should not create the role when it exists', () => {
    initKeyStore();

    expect(createRole).not.toHaveBeenCalled();
  });

  it('should tolerate another node creating the role first', () => {
    getPrincipal.mockReturnValueOnce(null).mockReturnValue({} as never);
    createRole.mockImplementation(() => {
      throw new Error('role exists');
    });

    expect(() => initKeyStore()).not.toThrow();
  });

  it('should rethrow when the role is still missing after a failed create', () => {
    getPrincipal.mockReturnValue(null);
    createRole.mockImplementation(() => {
      throw new Error('denied');
    });

    expect(() => initKeyStore()).toThrow('denied');
  });
});
