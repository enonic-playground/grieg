import * as auditLib from '/lib/xp/auditlog';
import * as contentLib from '/lib/xp/content';
import * as contextLib from '/lib/xp/context';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolsConfig } from '../../main/resources/lib/config';
import type { Tool, ToolOutcome } from '../../main/resources/lib/mcp';
import type { Content, FormItem } from '@enonic-types/core';
import type { ContentType } from '@enonic-types/lib-content';

import { buildSearchQuery } from '../../main/resources/lib/content-shape';
import { SUBTREE_BUDGET } from '../../main/resources/lib/shape';
import { createContentTools, serverInstructions } from '../../main/resources/lib/tools';

const auditLog = vi.mocked(auditLib.log);
const get = vi.mocked(contentLib.get);
const query = vi.mocked(contentLib.query);
const update = vi.mocked(contentLib.update);
const getType = vi.mocked(contentLib.getType);
const create = vi.mocked(contentLib.create);
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

const EDIT_BASE = 'http://localhost:8080/admin/cs/main/default/edit';

function item(overrides: Partial<Content> = {}): Content {
  return {
    _id: 'id-1',
    _name: 'hello',
    _path: '/site/hello',
    creator: 'user:system:su',
    modifier: 'user:system:su',
    createdTime: '2026-01-01T00:00:00Z',
    modifiedTime: '2026-02-01T00:00:00Z',
    owner: 'user:system:su',
    data: { title: 'Hello' },
    type: 'base:unstructured',
    displayName: 'Hello',
    hasChildren: false,
    valid: true,
    x: {},
    attachments: {},
    ...overrides,
  } as Content;
}

function tool(name: string, config = CONFIG): Tool {
  const found = createContentTools(config, EDIT_BASE).find((t) => t.name === name);
  if (found == null) throw new Error(`no tool ${name}`);
  return found;
}

function value(outcome: ToolOutcome): Record<string, unknown> {
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.value;
}

function message(outcome: ToolOutcome): string {
  if (outcome.ok) throw new Error('expected a failed outcome');
  return outcome.message;
}

function actAs(login: string, idProvider = 'system'): void {
  getContext.mockReturnValue({
    attributes: {},
    authInfo: { user: { login, idProvider } as never },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('log', { warning: vi.fn(), info: vi.fn() });
  actAs('editor');
  // The hasChildren aggregation; hits come from the first query call.
  query.mockReturnValue({ total: 0, count: 0, hits: [], aggregations: {} } as never);
});

describe('identity', () => {
  it('should run in the project repo as the configured user, without extra principals', () => {
    get.mockReturnValue(item());

    tool('content_get').handler({ key: '/site/hello' });

    expect(run).toHaveBeenCalledWith(
      {
        repository: 'com.enonic.cms.default',
        branch: 'draft',
        user: { login: 'editor', idProvider: 'system' },
      },
      expect.any(Function),
    );
  });

  it('should refuse when XP resolved the context to anonymous', () => {
    actAs('anonymous');

    const outcome = tool('content_get').handler({ key: '/site/hello' });

    expect(message(outcome)).toContain('could not act as user:system:editor');
    expect(get).not.toHaveBeenCalled();
  });

  it('should point a key owner at the key, not at the app config', () => {
    actAs('anonymous');

    const outcome = tool('content_get', { ...CONFIG, credential: 'key' }).handler({
      key: '/site/hello',
    });

    expect(message(outcome)).toContain('the key must be replaced');
    expect(message(outcome)).not.toContain('mcp.user');
  });
});

describe('content_search', () => {
  it('should query with the built DSL and derive hasChildren case-insensitively from one aggregation', () => {
    const hits = [item(), item({ _id: 'id-2', _name: 'folder', _path: '/site/Folder' })];
    query.mockReturnValueOnce({ total: 12, count: 2, hits } as never).mockReturnValueOnce({
      total: 3,
      count: 0,
      hits: [],
      aggregations: { parents: { buckets: [{ key: '/content/site/folder', docCount: 3 }] } },
    } as never);

    const result = value(
      tool('content_search').handler({ text: 'hello', contentType: 'base:folder', start: 5 }),
    );

    expect(query.mock.calls[0][0]).toEqual({
      query: buildSearchQuery({ text: 'hello' }).query,
      start: 5,
      count: 10,
      sort: '_score DESC',
      contentTypes: ['base:folder'],
    });
    expect(query.mock.calls[1][0]).toMatchObject({
      count: 0,
      query: {
        in: { field: '_parentPath', values: ['/content/site/hello', '/content/site/Folder'] },
      },
    });
    expect(result).toMatchObject({ total: 12, start: 5, count: 2 });
    const summaries = result.hits as { id: string; hasChildren: boolean; editUrl: string }[];
    expect(summaries.map((s) => [s.id, s.hasChildren])).toEqual([
      ['id-1', false],
      ['id-2', true],
    ]);
    expect(summaries[0].editUrl).toBe(`${EDIT_BASE}/id-1`);
  });

  it('should list the children of a path, newest first', () => {
    tool('content_search').handler({ path: '/content/site' });

    expect(query.mock.calls[0][0]).toEqual({
      query: { boolean: { must: [{ term: { field: '_parentPath', value: '/content/site' } }] } },
      start: 0,
      count: 10,
      sort: 'modifiedTime DESC',
      contentTypes: undefined,
    });
  });

  it('should skip the aggregation when there are no hits', () => {
    const result = value(tool('content_search').handler({ text: 'nothing' }));

    expect(query).toHaveBeenCalledTimes(1);
    expect(result.hits).toEqual([]);
  });

  it('should leave hasChildren null when the aggregation fails', () => {
    query
      .mockReturnValueOnce({ total: 1, count: 1, hits: [item()] } as never)
      .mockImplementationOnce(() => {
        throw new Error('index down');
      });

    const result = value(tool('content_search').handler({ text: 'hello' }));

    expect((result.hits as { hasChildren: unknown }[])[0].hasChildren).toBeNull();
  });

  it('should return argument errors without touching XP', () => {
    const outcome = tool('content_search').handler({ path: 'relative' });

    expect(message(outcome)).toContain('must start with');
    expect(run).not.toHaveBeenCalled();
  });
});

describe('content_get', () => {
  it('should return the summary plus the requested subtrees', () => {
    get.mockReturnValue(item());

    const result = value(tool('content_get').handler({ key: 'id-1' }));

    expect(result).toMatchObject({ id: 'id-1', path: '/site/hello', data: { title: 'Hello' } });
    expect(result).not.toHaveProperty('x');
  });

  it('should retry a /content-prefixed path without the prefix', () => {
    get.mockImplementation(({ key }) => (key === '/site/hello' ? item() : null));

    value(tool('content_get').handler({ key: '/content/site/hello' }));

    expect(get.mock.calls.map(([params]) => params.key)).toEqual([
      '/content/site/hello',
      '/site/hello',
    ]);
  });

  it('should prefer an item whose real path starts with /content', () => {
    get.mockReturnValue(item({ _path: '/content/article' }));

    const result = value(tool('content_get').handler({ key: '/content/article' }));

    expect(get).toHaveBeenCalledTimes(1);
    expect(result.path).toBe('/content/article');
  });

  it('should report a missing item as a failed outcome', () => {
    get.mockReturnValue(null);

    expect(message(tool('content_get').handler({ key: '/nope' }))).toContain(
      'No content at `/nope`',
    );
  });
});

describe('content_update', () => {
  it('should rename without requiring validity and report the previous value', () => {
    get.mockReturnValue(item());
    update.mockImplementation(({ editor }) => editor(item() as never));

    const result = value(tool('content_update').handler({ key: 'id-1', displayName: 'Hi' }));

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'id-1', requireValid: false }),
    );
    expect(result).toMatchObject({
      summary: { displayName: 'Hi' },
      changed: ['displayName'],
      previous: { displayName: 'Hello' },
    });
  });

  it('should require validity when data changes', () => {
    get.mockReturnValue(item());
    update.mockImplementation(({ editor }) => editor(item() as never));

    tool('content_update').handler({ key: 'id-1', data: { title: 'Hi' } });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ requireValid: true }));
  });

  it('should not write when nothing differs', () => {
    get.mockReturnValue(item());

    const result = value(tool('content_update').handler({ key: 'id-1', displayName: 'Hello' }));

    expect(update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ changed: [], previous: {} });
  });

  it('should refuse a stale expectedModifiedTime without writing', () => {
    get.mockReturnValue(item());

    const outcome = tool('content_update').handler({
      key: 'id-1',
      displayName: 'Hi',
      expectedModifiedTime: '2025-01-01T00:00:00Z',
    });

    expect(message(outcome)).toContain('Conflict');
    expect(update).not.toHaveBeenCalled();
  });

  it('should report a conflict when the item changes between the read and the write', () => {
    get.mockReturnValue(item());
    update.mockImplementation(({ editor }) =>
      editor(item({ modifiedTime: '2026-03-01T00:00:00Z' }) as never),
    );

    const outcome = tool('content_update').handler({
      key: 'id-1',
      displayName: 'Hi',
      expectedModifiedTime: '2026-02-01T00:00:00Z',
    });

    expect(message(outcome)).toContain('modified at 2026-03-01T00:00:00Z');
  });

  it('should report the value it overwrote when the item changed after the read', () => {
    get.mockReturnValue(item());
    update.mockImplementation(({ editor }) =>
      editor(item({ data: { title: 'Concurrent' } }) as never),
    );

    const result = value(tool('content_update').handler({ key: 'id-1', data: { title: 'Mine' } }));

    expect(result).toMatchObject({
      summary: { id: 'id-1' },
      changed: ['data.title'],
      previous: { 'data.title': 'Concurrent' },
    });
  });

  it('should refuse to overwrite an item set with a scalar', () => {
    get.mockReturnValue(item({ data: { items: { nested: true } } }));

    const outcome = tool('content_update').handler({ key: 'id-1', data: { items: 'x' } });

    expect(message(outcome)).toContain('`data.items` holds nested data');
    expect(update).not.toHaveBeenCalled();
  });

  it('should report a vanished item when update returns null', () => {
    get.mockReturnValue(item());
    update.mockReturnValue(null);

    const outcome = tool('content_update').handler({ key: 'id-1', displayName: 'Hi' });

    expect(message(outcome)).toContain('No content at `id-1`');
  });

  it('should turn an XP rejection into a failed outcome', () => {
    get.mockReturnValue(item());
    update.mockImplementation(() => {
      throw new Error('Content is invalid');
    });

    const outcome = tool('content_update').handler({ key: 'id-1', data: { title: 5 } });

    expect(message(outcome)).toContain(
      'XP rejected the update of `/site/hello`: Content is invalid',
    );
  });
});

describe('branch-dependent text', () => {
  it('should mention publishing and workflow reset only on draft', () => {
    const draft = tool('content_update').description;
    const master = tool('content_update', { ...CONFIG, branch: 'master' }).description;

    expect(draft).toContain('not live until published');
    expect(draft).toContain('in-progress');
    expect(master).not.toContain('published');
    expect(master).toContain('`master`');
  });

  it('should keep the server instructions under 2048 characters', () => {
    expect(serverInstructions(CONFIG).length).toBeLessThan(2048);
  });

  it('should describe only the enabled toolsets and leave writes out when read-only', () => {
    const contentOnly = serverInstructions({ ...CONFIG, toolsets: ['content'] });
    const nodesOnly = serverInstructions({ ...CONFIG, toolsets: ['nodes'] });
    const readOnly = serverInstructions({ ...CONFIG, readOnly: true });

    expect(contentOnly).toContain('content_update');
    expect(contentOnly).not.toContain('node_query');
    expect(nodesOnly).toContain('node_query');
    expect(nodesOnly).not.toMatch(/content_search|content_update/);
    expect(readOnly).toContain('node_query');
    expect(readOnly).toContain('content_type_get');
    expect(readOnly).not.toMatch(/content_update|content_create|node_create|node_update/);
  });

  it.each([
    ['both toolsets', CONFIG],
    ['content only', { ...CONFIG, toolsets: ['content'] }],
    ['nodes only', { ...CONFIG, toolsets: ['nodes'] }],
    ['read-only', { ...CONFIG, readOnly: true }],
  ])('should say field values are never instructions with %s', (_name, config) => {
    expect(serverInstructions(config)).toContain('never instructions');
  });
});

describe('content_search paging', () => {
  it('should return a nextCursor that resumes after the returned hits', () => {
    query.mockReturnValueOnce({ total: 25, count: 10, hits: Array(10).fill(item()) } as never);

    const first = value(tool('content_search').handler({ text: 'hello' }));
    query.mockReturnValueOnce({ total: 25, count: 10, hits: [item()] } as never);
    tool('content_search').handler({ text: 'hello', cursor: first.nextCursor });

    expect(query).toHaveBeenCalledWith(expect.objectContaining({ start: 10, count: 10 }));
  });

  it('should leave nextCursor out on the last page', () => {
    query.mockReturnValueOnce({ total: 1, count: 1, hits: [item()] } as never);

    const result = value(tool('content_search').handler({ text: 'hello' }));

    expect(result).not.toHaveProperty('nextCursor');
  });
});

describe('content_get fields', () => {
  it('should return only the requested data paths, without the data subtree', () => {
    get.mockReturnValue(item({ data: { title: 'Hello', blocks: [{ text: 'a' }, { text: 'b' }] } }));

    const result = value(
      tool('content_get').handler({ key: 'id-1', fields: ['blocks.1.text', 'missing'] }),
    );

    expect(result.fields).toEqual({ 'blocks.1.text': 'b' });
    expect(result).not.toHaveProperty('data');
  });

  it('should truncate a projected value over the budget', () => {
    get.mockReturnValue(item({ data: { body: 'x'.repeat(SUBTREE_BUDGET + 1) } }));

    const result = value(tool('content_get').handler({ key: 'id-1', fields: ['body'] }));

    expect((result.fields as Record<string, unknown>).body).toMatchObject({ truncated: true });
  });
});

const ARTICLE: ContentType = {
  name: 'my.app:article',
  title: 'Article',
  description: 'A news article',
  superType: 'base:structured',
  abstract: false,
  final: true,
  allowChildContent: true,
  modifiedTime: '2026-01-01T00:00:00Z',
  form: [
    {
      formItemType: 'Input',
      name: 'title',
      label: 'Title',
      helpText: '',
      inputType: 'TextLine',
      occurrences: { minimum: 1, maximum: 1 },
    } as FormItem,
  ],
  config: {},
};

describe('content_type_get', () => {
  it('should flatten the form of the named type', () => {
    getType.mockReturnValue(ARTICLE);

    const result = value(tool('content_type_get').handler({ name: 'my.app:article' }));

    expect(getType).toHaveBeenCalledWith('my.app:article');
    expect(result).toMatchObject({
      name: 'my.app:article',
      displayName: 'Article',
      abstract: false,
      form: [{ path: 'title', kind: 'input', occurrences: { min: 1, max: 1 } }],
    });
    expect(result).not.toHaveProperty('note');
  });

  it('should say where a deep form was capped', () => {
    let deep = ARTICLE.form[0];
    for (let i = 6; i >= 1; i--) {
      deep = {
        formItemType: 'ItemSet',
        name: `s${i}`,
        label: `s${i}`,
        helpText: '',
        occurrences: { minimum: 0, maximum: 0 },
        items: [deep],
      } as FormItem;
    }
    getType.mockReturnValue({ ...ARTICLE, form: [deep] });

    const result = value(tool('content_type_get').handler({ name: 'my.app:article' }));

    expect(result.note).toContain('not listed under: s1.s2.s3.s4.s5.');
  });

  it('should report an unknown type as a failed outcome', () => {
    getType.mockReturnValue(null);

    expect(message(tool('content_type_get').handler({ name: 'nope:nope' }))).toContain(
      'No content type `nope:nope`',
    );
  });

  it('should require a name', () => {
    expect(message(tool('content_type_get').handler({}))).toContain('`name` is required');
    expect(run).not.toHaveBeenCalled();
  });
});

describe('content_create', () => {
  const args = {
    parentPath: '/content/site',
    contentType: 'my.app:article',
    displayName: 'News',
    data: { title: 'News' },
  };

  it('should create on draft, valid and in progress, and return the summary', () => {
    getType.mockReturnValue(ARTICLE);
    create.mockReturnValue(item({ _id: 'new', displayName: 'News' }));

    const result = value(tool('content_create', { ...CONFIG, branch: 'master' }).handler(args));

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ repository: 'com.enonic.cms.default', branch: 'draft' }),
      expect.any(Function),
    );
    expect(create).toHaveBeenCalledWith({
      parentPath: '/site',
      contentType: 'my.app:article',
      displayName: 'News',
      name: undefined,
      language: undefined,
      data: { title: 'News' },
      requireValid: true,
      workflow: { state: 'IN_PROGRESS' },
    });
    expect(result).toMatchObject({ id: 'new', editUrl: `${EDIT_BASE}/new` });
  });

  it('should name missing required fields without calling create', () => {
    getType.mockReturnValue(ARTICLE);

    const outcome = tool('content_create').handler({ ...args, data: {} });

    expect(message(outcome)).toContain('`data.title` needs at least 1 value(s), got 0.');
    expect(create).not.toHaveBeenCalled();
  });

  it('should list at most ten problems and count the rest', () => {
    const required = Array.from({ length: 11 }, (_, i) => ({
      ...ARTICLE.form[0],
      name: `f${i}`,
    })) as FormItem[];
    getType.mockReturnValue({ ...ARTICLE, form: required });

    const text = message(tool('content_create').handler({ ...args, data: {} }));

    expect(text).toContain('`data.f9` needs');
    expect(text).not.toContain('`data.f10`');
    expect(text).toContain('…and 1 more.');
  });

  it("should turn XP's validation error into a failed outcome", () => {
    getType.mockReturnValue(ARTICLE);
    create.mockImplementationOnce(() => {
      throw new Error('Invalid value in [data.title]: too long');
    });

    expect(message(tool('content_create').handler(args))).toContain(
      'XP refused to create the `my.app:article` item: Invalid value in [data.title]: too long.',
    );
  });

  it('should refuse an unknown content type', () => {
    getType.mockReturnValue(null);

    expect(message(tool('content_create').handler(args))).toContain(
      'No content type `my.app:article`',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('should be a non-destructive, non-idempotent write', () => {
    expect(tool('content_create').annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });
});

describe('audit log', () => {
  const args = {
    parentPath: '/site',
    contentType: 'my.app:article',
    displayName: 'News',
    data: { title: 'News' },
  };

  it('should write one entry after content_create, on draft whatever the configured branch', () => {
    getType.mockReturnValue(ARTICLE);
    create.mockReturnValue(item({ _id: 'new' }));
    actAs('alice');

    value(
      tool('content_create', {
        ...CONFIG,
        branch: 'master',
        user: 'alice',
      }).handler({ ...args, name: 'news', language: 'en' }),
    );

    expect(auditLog).toHaveBeenCalledExactlyOnceWith({
      type: 'grieg.mcp.content_create',
      user: 'user:system:alice',
      objects: ['com.enonic.cms.default:draft:new'],
      data: {
        tool: 'content_create',
        fields: ['displayName', 'name', 'language', 'data.title'],
      },
    });
  });

  it('should list only the fields content_create was given', () => {
    getType.mockReturnValue(ARTICLE);
    create.mockReturnValue(item({ _id: 'new' }));

    value(tool('content_create').handler(args));

    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fields: ['displayName', 'data.title'] }),
      }),
    );
  });

  it('should write one entry after content_update with the changed fields', () => {
    get.mockReturnValue(item());
    update.mockImplementation(({ editor }) => editor(item() as never));

    value(
      tool('content_update', { ...CONFIG, branch: 'master' }).handler({
        key: '/site/hello',
        displayName: 'Hi',
        data: { title: 'Hello', body: 'Text' },
      }),
    );

    expect(auditLog).toHaveBeenCalledExactlyOnceWith({
      type: 'grieg.mcp.content_update',
      user: 'user:system:editor',
      objects: ['com.enonic.cms.default:master:id-1'],
      data: { tool: 'content_update', fields: ['displayName', 'data.body'] },
    });
  });

  it.each([
    {
      path: 'a stale expectedModifiedTime',
      expected: 'Conflict',
      call: () => {
        get.mockReturnValue(item());
        return tool('content_update').handler({
          key: 'id-1',
          displayName: 'Hi',
          expectedModifiedTime: '2025-01-01T00:00:00Z',
        });
      },
    },
    {
      path: 'an XP update error',
      expected: 'XP rejected the update',
      call: () => {
        get.mockReturnValue(item());
        update.mockImplementation(() => {
          throw new Error('Content is invalid');
        });
        return tool('content_update').handler({ key: 'id-1', data: { title: 5 } });
      },
    },
    {
      path: 'an item that vanished during the update',
      expected: 'No content at `id-1`',
      call: () => {
        get.mockReturnValue(item());
        update.mockReturnValue(null);
        return tool('content_update').handler({ key: 'id-1', displayName: 'Hi' });
      },
    },
    {
      path: 'data that does not fit the content type',
      expected: 'Nothing was created',
      call: () => {
        getType.mockReturnValue(ARTICLE);
        return tool('content_create').handler({ ...args, data: {} });
      },
    },
    {
      path: 'an XP create error',
      expected: 'XP refused to create',
      call: () => {
        getType.mockReturnValue(ARTICLE);
        create.mockImplementation(() => {
          throw new Error('Invalid value');
        });
        return tool('content_create').handler(args);
      },
    },
  ])('should write nothing for $path', ({ expected, call }) => {
    expect(message(call())).toContain(expected);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('should write nothing when content_update changes nothing', () => {
    get.mockReturnValue(item());

    const result = value(tool('content_update').handler({ key: 'id-1', displayName: 'Hello' }));

    expect(result).toMatchObject({ changed: [] });
    expect(auditLog).not.toHaveBeenCalled();
  });
});
