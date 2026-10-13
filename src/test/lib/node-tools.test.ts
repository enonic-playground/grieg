import * as contextLib from '/lib/xp/context';
import * as nodeLib from '/lib/xp/node';
import * as repoLib from '/lib/xp/repo';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolsConfig } from '../../main/resources/lib/config';
import type { Tool, ToolOutcome } from '../../main/resources/lib/mcp';

import { createNodeTools } from '../../main/resources/lib/node-tools';

type JsonObject = Record<string, unknown>;

const connect = vi.mocked(nodeLib.connect);
const listRepos = vi.mocked(repoLib.list);
const run = vi.mocked(contextLib.run);
const getContext = vi.mocked(contextLib.get);

const CONFIG: ToolsConfig = {
  token: 't',
  project: 'default',
  branch: 'draft',
  user: 'editor',
  idProvider: 'system',
  credential: 'token',
  allowedOrigins: [],
  allowedHosts: [],
  toolsets: ['content', 'nodes'],
  readOnly: false,
  nodeRepos: [],
};

function stored(overrides: JsonObject = {}): JsonObject {
  return {
    _id: 'n1',
    _name: 'item',
    _path: '/workflows/item',
    _nodeType: 'default',
    _ts: '2026-01-01T00:00:00Z',
    _versionKey: 'v1',
    title: 'Hello',
    ...overrides,
  };
}

const connection = {
  get: vi.fn(),
  query: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
};

function tool(name: string, config = CONFIG): Tool {
  const found = createNodeTools(config).find((t) => t.name === name);
  if (found == null) throw new Error(`no tool ${name}`);
  return found;
}

function value(outcome: ToolOutcome): JsonObject {
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.value;
}

function message(outcome: ToolOutcome): string {
  if (outcome.ok) throw new Error('expected a failed outcome');
  return outcome.message;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('log', { warning: vi.fn(), info: vi.fn() });
  getContext.mockReturnValue({
    attributes: {},
    authInfo: { user: { login: 'editor', idProvider: 'system' } as never },
  });
  for (const fn of Object.values(connection)) fn.mockReset();
  connect.mockReturnValue(connection as never);
});

describe('identity and repository rules', () => {
  it('should run in the requested repo and branch as the configured user', () => {
    connection.get.mockReturnValue(stored());

    tool('node_get').handler({ repo: 'com.enonic.app.grieg', key: '/workflows/item' });

    expect(run).toHaveBeenCalledWith(
      {
        repository: 'com.enonic.app.grieg',
        branch: 'master',
        user: { login: 'editor', idProvider: 'system' },
      },
      expect.any(Function),
    );
    expect(connect).toHaveBeenCalledWith({ repoId: 'com.enonic.app.grieg', branch: 'master' });
  });

  it('should refuse system repositories without touching XP', () => {
    const outcome = tool('node_query').handler({ repo: 'system-repo' });

    expect(message(outcome)).toContain('system repository');
    expect(run).not.toHaveBeenCalled();
  });

  it('should refuse writes to content repositories', () => {
    const outcome = tool('node_update').handler({
      repo: 'com.enonic.cms.default',
      key: '/content/a',
      set: { title: 'x' },
    });

    expect(message(outcome)).toContain('Use content_update');
    expect(connection.update).not.toHaveBeenCalled();
  });

  it('should refuse when XP resolved the context to anonymous', () => {
    getContext.mockReturnValue({
      attributes: {},
      authInfo: { user: { login: 'anonymous', idProvider: 'system' } as never },
    });

    expect(message(tool('node_get').handler({ repo: 'r', key: '/a' }))).toContain(
      'could not act as user:system:editor',
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it('should refuse when XP resolved the login in another ID provider', () => {
    getContext.mockReturnValue({
      attributes: {},
      authInfo: { user: { login: 'editor', idProvider: 'ldap' } as never },
    });

    expect(message(tool('node_get').handler({ repo: 'r', key: '/a' }))).toContain(
      'could not act as user:system:editor',
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it('should turn an XP exception into a failed outcome naming the repo and branch', () => {
    connection.get.mockImplementation(() => {
      throw new Error('Branch [nope] not found');
    });

    expect(message(tool('node_get').handler({ repo: 'r', branch: 'nope', key: '/a' }))).toContain(
      'The request on `r`, branch `nope` failed: Branch [nope] not found',
    );
  });
});

describe('node_repos', () => {
  it('should list as admin, then keep only branches the user can read', () => {
    listRepos.mockReturnValue([
      { id: 'system-repo', branches: ['master'], transient: false },
      { id: 'com.enonic.cms.default', branches: ['draft', 'master'], transient: false },
      { id: 'scratch', branches: ['master'], transient: false },
      { id: 'hidden', branches: ['master'], transient: false },
    ]);
    const readable = new Set(['com.enonic.cms.default/draft', 'scratch/master']);
    connect.mockImplementation(
      ({ repoId, branch }) =>
        ({ query: () => ({ total: readable.has(`${repoId}/${branch}`) ? 3 : 0 }) }) as never,
    );

    const result = value(tool('node_repos').handler({}));

    expect(run.mock.calls[0][0]).toEqual({ principals: ['role:system.admin'] });
    expect(connect).not.toHaveBeenCalledWith(expect.objectContaining({ repoId: 'system-repo' }));
    expect(result.repos).toEqual([
      {
        id: 'com.enonic.cms.default',
        branches: ['draft'],
        defaultBranch: 'draft',
        access: 'read',
      },
      { id: 'scratch', branches: ['master'], defaultBranch: 'master', access: 'write' },
    ]);
  });

  it('should leave out repositories outside the allowlist', () => {
    listRepos.mockReturnValue([
      { id: 'scratch', branches: ['master'], transient: false },
      { id: 'other', branches: ['master'], transient: false },
    ]);
    connection.query.mockReturnValue({ total: 1, count: 0, hits: [] });

    const result = value(tool('node_repos', { ...CONFIG, nodeRepos: ['scratch'] }).handler({}));

    expect((result.repos as { id: string }[]).map((repo) => repo.id)).toEqual(['scratch']);
  });

  it('should hide a branch whose probe fails, and log why', () => {
    listRepos.mockReturnValue([{ id: 'scratch', branches: ['master'], transient: false }]);
    connection.query.mockImplementation(() => {
      throw new Error('index missing');
    });

    expect(value(tool('node_repos').handler({})).repos).toEqual([]);
    expect(log.warning).toHaveBeenCalledWith(expect.stringContaining('index missing'));
  });
});

describe('node_query', () => {
  it('should query as given, fetch the hits in order and project fields', () => {
    connection.query.mockReturnValue({
      total: 30,
      count: 2,
      hits: [{ id: 'n2' }, { id: 'n1' }],
      aggregations: {},
    });
    connection.get.mockReturnValue([stored(), stored({ _id: 'n2', title: 'Second' })]);

    const result = value(
      tool('node_query').handler({
        repo: 'com.enonic.app.grieg',
        query: "_parentPath = '/workflows'",
        sort: '_ts DESC',
        fields: ['title'],
        count: 2,
      }),
    );

    expect(connection.query).toHaveBeenCalledWith({
      query: "_parentPath = '/workflows'",
      filters: undefined,
      sort: '_ts DESC',
      aggregations: undefined,
      start: 0,
      count: 2,
    });
    expect(connection.get).toHaveBeenCalledWith(['n2', 'n1']);
    const hits = result.hits as JsonObject[];
    expect(hits.map((hit) => [hit._id, hit.fields])).toEqual([
      ['n2', { title: 'Second' }],
      ['n1', { title: 'Hello' }],
    ]);
    expect(result).toMatchObject({ total: 30, count: 2 });
    expect(result).not.toHaveProperty('aggregations');
  });

  it('should page with the cursor it returned', () => {
    connection.query.mockReturnValue({ total: 30, count: 1, hits: [{ id: 'n1' }] });
    connection.get.mockReturnValue(stored());
    const args = { repo: 'scratch', count: 1 };

    const first = value(tool('node_query').handler(args));
    tool('node_query').handler({ ...args, cursor: first.nextCursor });

    expect(connection.query.mock.calls[1][0]).toMatchObject({ start: 1, count: 1 });
  });

  it('should return summaries only without fields, and aggregations when asked', () => {
    connection.query.mockReturnValue({
      total: 1,
      count: 1,
      hits: [{ id: 'n1' }],
      aggregations: { types: { buckets: [] } },
    });
    connection.get.mockReturnValue(stored());

    const result = value(
      tool('node_query').handler({
        repo: 'scratch',
        aggregations: { types: { terms: { field: '_nodeType', size: 999 } } },
      }),
    );

    expect(connection.query.mock.calls[0][0]).toMatchObject({
      aggregations: { types: { terms: { field: '_nodeType', size: 50 } } },
    });
    expect((result.hits as JsonObject[])[0]).not.toHaveProperty('fields');
    expect(result.aggregations).toEqual({ types: { buckets: [] } });
    expect(result).not.toHaveProperty('nextCursor');
  });

  it('should skip the fetch when nothing matched', () => {
    connection.query.mockReturnValue({ total: 0, count: 0, hits: [] });

    expect(value(tool('node_query').handler({ repo: 'scratch' })).hits).toEqual([]);
    expect(connection.get).not.toHaveBeenCalled();
  });
});

describe('node_get', () => {
  it('should return the summary plus data, without system properties', () => {
    connection.get.mockReturnValue(stored({ _childOrder: '_ts DESC' }));

    const result = value(tool('node_get').handler({ repo: 'scratch', key: 'n1' }));

    expect(result).toEqual({
      _id: 'n1',
      _name: 'item',
      _path: '/workflows/item',
      _nodeType: 'default',
      _ts: '2026-01-01T00:00:00Z',
      _versionKey: 'v1',
      data: { title: 'Hello' },
    });
  });

  it('should report a missing node as a failed outcome', () => {
    connection.get.mockReturnValue(null);

    expect(message(tool('node_get').handler({ repo: 'scratch', key: '/nope' }))).toContain(
      'No node at `/nope`',
    );
  });
});

describe('node_create', () => {
  it('should create under the parent with inherited permissions', () => {
    connection.create.mockImplementation((params) => ({ ...stored(), ...params }));

    const result = value(
      tool('node_create').handler({
        repo: 'scratch',
        parentPath: '/workflows',
        name: 'item',
        data: { title: 'Hello' },
      }),
    );

    expect(connection.create).toHaveBeenCalledWith({
      title: 'Hello',
      _parentPath: '/workflows',
      _name: 'item',
      _inheritsPermissions: true,
    });
    expect(result).toEqual({
      _id: 'n1',
      _name: 'item',
      _path: '/workflows/item',
      _nodeType: 'default',
      _ts: '2026-01-01T00:00:00Z',
      _versionKey: 'v1',
    });
  });

  it('should be unavailable to a read-only server for any repository', () => {
    const outcome = tool('node_create', { ...CONFIG, readOnly: true }).handler({
      repo: 'scratch',
      parentPath: '/',
      name: 'n',
    });

    expect(message(outcome)).toContain('mcp.readOnly');
    expect(connection.create).not.toHaveBeenCalled();
  });
});

describe('node_update', () => {
  it('should apply set and unset in the editor and report the previous values', () => {
    let written: JsonObject | undefined;
    connection.get.mockReturnValue(stored({ old: 1 }));
    connection.update.mockImplementation(({ editor }) => (written = editor(stored({ old: 1 }))));

    const result = value(
      tool('node_update').handler({
        repo: 'scratch',
        key: '/workflows/item',
        set: { title: 'Hi' },
        unset: ['old'],
        expectedVersionKey: 'v1',
      }),
    );

    expect(connection.update).toHaveBeenCalledWith({ key: 'n1', editor: expect.any(Function) });
    expect(written).toMatchObject({ _id: 'n1', title: 'Hi' });
    expect(written).not.toHaveProperty('old');
    expect(result).toMatchObject({
      node: { _id: 'n1' },
      changed: ['title', 'old'],
      previous: { title: 'Hello', old: 1 },
    });
  });

  it('should refuse a stale expectedVersionKey without writing', () => {
    connection.get.mockReturnValue(stored({ _versionKey: 'v2' }));

    const outcome = tool('node_update').handler({
      repo: 'scratch',
      key: 'n1',
      set: { title: 'Hi' },
      expectedVersionKey: 'v1',
    });

    expect(message(outcome)).toContain('is at version v2, not the expected v1');
    expect(connection.update).not.toHaveBeenCalled();
  });

  it('should report a conflict when the node changes before the editor runs', () => {
    connection.get.mockReturnValue(stored());
    connection.update.mockImplementation(({ editor }) => editor(stored({ _versionKey: 'v3' })));

    const outcome = tool('node_update').handler({
      repo: 'scratch',
      key: 'n1',
      set: { title: 'Hi' },
      expectedVersionKey: 'v1',
    });

    expect(message(outcome)).toContain('is at version v3');
  });

  describe('typed properties', () => {
    class Instant {
      constructor(readonly text: string) {}
      static parse(text: string): Instant {
        if (!text.endsWith('Z')) throw new Error(`Text '${text}' could not be parsed`);
        return new Instant(text);
      }
    }
    // Each fake has only the static factory its Java class has, so a wrong factory name fails.
    function fakeType(factory: 'parse' | 'from') {
      class Fake {
        constructor(readonly text: string) {}
      }
      return Object.assign(Fake, {
        [factory]: (text: string) => {
          if (text === 'invalid') throw new Error(`'${text}' is not valid`);
          return new Fake(text);
        },
      });
    }
    const LocalDateTime = fakeType('parse');
    const LocalDate = fakeType('parse');
    const LocalTime = fakeType('parse');
    const GeoPoint = fakeType('from');
    const Reference = fakeType('from');
    class Link {}
    const classes: Record<string, unknown> = {
      'java.time.Instant': Instant,
      'java.time.LocalDateTime': LocalDateTime,
      'java.time.LocalDate': LocalDate,
      'java.time.LocalTime': LocalTime,
      'com.enonic.xp.util.GeoPoint': GeoPoint,
      'com.enonic.xp.util.Reference': Reference,
    };
    const published = new Instant('2026-01-01T00:00:00Z');

    function update(raw: JsonObject, set: JsonObject) {
      let written: JsonObject | undefined;
      connection.get.mockReturnValue(stored({ publishedAt: '2026-01-01T00:00:00Z' }));
      connection.update.mockImplementation(({ editor }) => (written = editor(stored(raw))));
      const outcome = tool('node_update').handler({ repo: 'scratch', key: 'n1', set });
      return { outcome, written };
    }

    beforeEach(() => {
      vi.stubGlobal('Java', { type: (name: string) => classes[name] ?? class {} });
    });

    it('should store a set over a typed value as that type, leaving other typed values alone', () => {
      const { outcome, written } = update(
        { publishedAt: published, other: published },
        { publishedAt: '2026-02-01T00:00:00Z' },
      );

      expect(written?.publishedAt).toBeInstanceOf(Instant);
      expect(written?.publishedAt).toStrictEqual(new Instant('2026-02-01T00:00:00Z'));
      expect(written?.other).toBe(published);
      expect(value(outcome).previous).toEqual({ publishedAt: '2026-01-01T00:00:00Z' });
    });

    it.each([
      ['LocalDateTime', LocalDateTime, '2026-02-01T12:00:00'],
      ['LocalDate', LocalDate, '2026-02-01'],
      ['LocalTime', LocalTime, '12:30:00'],
      ['GeoPoint', GeoPoint, '59.91,10.75'],
      ['Reference', Reference, 'my-node-id'],
    ])(
      'should store a set over a %s as that type, and refuse one it cannot parse',
      (name, Type, text) => {
        const { written } = update({ publishedAt: new Type('old') }, { publishedAt: text });
        const refused = update({ publishedAt: new Type('old') }, { publishedAt: 'invalid' });

        expect(written?.publishedAt).toStrictEqual(new Type(text));
        expect(message(refused.outcome)).toContain(
          `\`publishedAt\` is stored as ${name}, and \`invalid\` is not a valid one`,
        );
      },
    );

    it('should refuse a string the stored type cannot parse', () => {
      const { outcome } = update({ publishedAt: published }, { publishedAt: 'tomorrow' });

      expect(message(outcome)).toContain(
        '`publishedAt` is stored as Instant, and `tomorrow` is not a valid one',
      );
      expect(message(outcome)).toContain("Text 'tomorrow' could not be parsed");
      expect(message(outcome)).toContain('Nothing was written.');
    });

    it('should refuse a non-string value over a typed one', () => {
      const { outcome } = update({ publishedAt: published }, { publishedAt: 5 });

      expect(message(outcome)).toContain('set it to a string such as `2026-01-01T00:00:00Z`');
    });

    it('should refuse a typed value it cannot rebuild, and several typed values in one property', () => {
      expect(message(update({ publishedAt: new Link() }, { publishedAt: 'x' }).outcome)).toContain(
        'cannot replace without changing its type',
      );
      expect(
        message(update({ publishedAt: [published, published] }, { publishedAt: 'x' }).outcome),
      ).toContain('cannot replace without changing its type');
    });
  });

  it('should not write when nothing differs', () => {
    connection.get.mockReturnValue(stored());

    const result = value(
      tool('node_update').handler({ repo: 'scratch', key: 'n1', set: { title: 'Hello' } }),
    );

    expect(connection.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ changed: [], previous: {} });
  });
});

describe('annotations', () => {
  it('should mark reads read-only and writes as non-destructive, all closed-world', () => {
    const annotations = Object.fromEntries(
      createNodeTools(CONFIG).map((t) => [
        t.name,
        [
          t.annotations.readOnlyHint,
          t.annotations.destructiveHint ?? null,
          t.annotations.openWorldHint,
        ],
      ]),
    );

    expect(annotations).toEqual({
      node_repos: [true, null, false],
      node_query: [true, null, false],
      node_get: [true, null, false],
      node_create: [false, false, false],
      node_update: [false, false, false],
    });
  });
});
