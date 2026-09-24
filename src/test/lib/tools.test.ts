import * as contentLib from '/lib/xp/content';
import * as contextLib from '/lib/xp/context';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpConfig } from '../../main/resources/lib/config';
import type { Tool, ToolOutcome } from '../../main/resources/lib/mcp';
import type { Content } from '@enonic-types/core';

import { buildSearchQuery } from '../../main/resources/lib/content-shape';
import { createContentTools, serverInstructions } from '../../main/resources/lib/tools';

const get = vi.mocked(contentLib.get);
const query = vi.mocked(contentLib.query);
const update = vi.mocked(contentLib.update);
const run = vi.mocked(contextLib.run);
const getContext = vi.mocked(contextLib.get);

const CONFIG: McpConfig = {
  token: 't',
  project: 'default',
  branch: 'draft',
  user: 'editor',
  idProvider: 'system',
  allowedOrigins: [],
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
});
