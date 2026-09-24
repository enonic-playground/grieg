import { describe, expect, it } from 'vitest';

import type { Content } from '@enonic-types/core';

import {
  buildSearchQuery,
  limitSubtree,
  MAX_COUNT,
  normalizeKey,
  parseGetArgs,
  parseSearchArgs,
  parseUpdateArgs,
  pickSubtrees,
  planUpdate,
  SUBTREE_BUDGET,
  toNodePath,
  toSummary,
} from '../../main/resources/lib/content-shape';

function content(overrides: Partial<Content> = {}): Content {
  return {
    _id: 'id-1',
    _name: 'hello',
    _path: '/site/hello',
    creator: 'user:system:su',
    modifier: 'user:system:editor',
    createdTime: '2026-01-01T00:00:00Z',
    modifiedTime: '2026-02-01T00:00:00Z',
    owner: 'user:system:su',
    data: { title: 'Hello', tags: ['a'], items: { nested: true } },
    type: 'base:unstructured',
    displayName: 'Hello',
    hasChildren: false,
    valid: true,
    x: {},
    attachments: {},
    workflow: { state: 'READY' },
    ...overrides,
  } as Content;
}

describe('normalizeKey', () => {
  it('should strip a leading /content from paths', () => {
    expect(normalizeKey('/content/site/hello')).toBe('/site/hello');
    expect(normalizeKey('/content')).toBe('/');
  });

  it('should leave ids, plain paths and look-alike prefixes alone', () => {
    expect(normalizeKey('id-1')).toBe('id-1');
    expect(normalizeKey('/site/hello')).toBe('/site/hello');
    expect(normalizeKey('/contentful')).toBe('/contentful');
  });
});

describe('toNodePath', () => {
  it('should map content paths onto the /content node', () => {
    expect(toNodePath('/')).toBe('/content');
    expect(toNodePath('/site/')).toBe('/content/site');
  });
});

describe('parseSearchArgs', () => {
  it('should apply defaults', () => {
    expect(parseSearchArgs({})).toEqual({ ok: true, value: { count: 10, start: 0 } });
  });

  it('should accept the count bounds', () => {
    expect(parseSearchArgs({ count: 1 })).toMatchObject({ ok: true, value: { count: 1 } });
    expect(parseSearchArgs({ count: MAX_COUNT })).toMatchObject({
      ok: true,
      value: { count: MAX_COUNT },
    });
  });

  it('should normalize the path and drop blank strings', () => {
    const parsed = parseSearchArgs({ path: '/content/site', text: '  ' });

    expect(parsed).toEqual({ ok: true, value: { path: '/site', count: 10, start: 0 } });
  });

  it.each([
    [{ path: 'site' }, 'must start with'],
    [{ count: 2.5 }, 'integer'],
    [{ text: 3 }, 'string'],
    [{ query: 'x' }, 'Unknown argument(s): query'],
    [{ count: 0 }, '`count` must be between 1 and 50'],
    [{ count: 51 }, '`count` must be between 1 and 50'],
    [{ start: -1 }, '`start` must be 0 or greater'],
  ])('should reject %j', (args, message) => {
    const parsed = parseSearchArgs(args);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.message).toContain(message);
  });
});

describe('parseGetArgs', () => {
  it('should default include to data and keep the key as given', () => {
    expect(parseGetArgs({ key: '/content/site' })).toEqual({
      ok: true,
      value: { key: '/content/site', include: ['data'] },
    });
  });

  it.each([
    [{}, '`key` is required'],
    [{ key: 'x', include: ['children'] }, '`include` must be an array of'],
  ])('should reject %j', (args, message) => {
    const parsed = parseGetArgs(args);

    expect(parsed.ok ? '' : parsed.message).toContain(message);
  });
});

describe('parseUpdateArgs', () => {
  it('should accept scalars and arrays of scalars in data', () => {
    const parsed = parseUpdateArgs({ key: 'id-1', data: { title: 'T', count: 2, tags: ['a', 1] } });

    expect(parsed).toEqual({
      ok: true,
      value: {
        key: 'id-1',
        displayName: undefined,
        language: undefined,
        data: { title: 'T', count: 2, tags: ['a', 1] },
        expectedModifiedTime: undefined,
      },
    });
  });

  it.each([
    [{ key: 'id-1', data: { items: { nested: 1 } } }, 'data.items'],
    [{ key: 'id-1', data: { items: [{ nested: 1 }] } }, 'data.items'],
    [{ key: 'id-1', data: { title: null } }, 'data.title'],
    [{ key: 'id-1', data: [] }, 'must be an object'],
    [{ key: 'id-1' }, 'Nothing to update'],
    [{ key: 'id-1', data: {} }, 'Nothing to update'],
    [{ displayName: 'x' }, '`key` is required'],
  ])('should reject %j', (args, message) => {
    const parsed = parseUpdateArgs(args);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.message).toContain(message);
  });
});

describe('buildSearchQuery', () => {
  const textQuery = {
    boolean: {
      should: [
        {
          fulltext: {
            fields: ['displayName^5', '_name^3', '_allText'],
            query: "it's",
            operator: 'AND',
          },
        },
        {
          ngram: {
            fields: ['displayName^5', '_name^3', '_allText'],
            query: "it's",
            operator: 'AND',
          },
        },
      ],
    },
  };

  it('should list everything by modification time without text or path', () => {
    expect(buildSearchQuery({})).toEqual({ query: undefined, sort: 'modifiedTime DESC' });
  });

  it('should list the direct children of a path', () => {
    expect(buildSearchQuery({ path: '/site' })).toEqual({
      query: { boolean: { must: [{ term: { field: '_parentPath', value: '/content/site' } }] } },
      sort: 'modifiedTime DESC',
    });
  });

  it('should pass text through verbatim as fulltext OR ngram, ranked by score', () => {
    expect(buildSearchQuery({ text: "it's" })).toEqual({
      query: { boolean: { must: [textQuery] } },
      sort: '_score DESC',
    });
  });

  it('should search the whole subtree when text and path are combined', () => {
    const { query } = buildSearchQuery({ text: "it's", path: '/site' });

    expect(query).toEqual({
      boolean: { must: [textQuery, { like: { field: '_path', value: '/content/site/*' } }] },
    });
  });
});

describe('toSummary', () => {
  it('should shape a content item and link it to Content Studio', () => {
    expect(toSummary(content({ language: undefined }), 'http://cs/default/edit', true)).toEqual({
      id: 'id-1',
      name: 'hello',
      path: '/site/hello',
      displayName: 'Hello',
      type: 'base:unstructured',
      language: null,
      modifiedTime: '2026-02-01T00:00:00Z',
      modifier: 'user:system:editor',
      workflowState: 'READY',
      valid: true,
      hasChildren: true,
      editUrl: 'http://cs/default/edit/id-1',
    });
  });
});

describe('limitSubtree', () => {
  it('should keep a subtree under the budget', () => {
    expect(limitSubtree('data', { a: 1 })).toEqual({ a: 1 });
    expect(limitSubtree('page', undefined)).toBeNull();
  });

  it('should keep a subtree of exactly the budget and truncate one character more', () => {
    // `"xxx…"` is the string plus its two quotes.
    const exact = 'x'.repeat(SUBTREE_BUDGET - 2);
    const over = 'x'.repeat(SUBTREE_BUDGET - 1);

    expect(limitSubtree('page', exact)).toBe(exact);
    expect(limitSubtree('page', over)).toMatchObject({ truncated: true, size: SUBTREE_BUDGET + 1 });
  });
});

describe('pickSubtrees', () => {
  it('should return only the requested subtrees', () => {
    const item = content({
      x: { seo: { title: 'T' } } as never,
      attachments: { 'a.png': {} } as never,
    });

    expect(pickSubtrees(item, ['x', 'attachments', 'page'])).toEqual({
      x: { seo: { title: 'T' } },
      attachments: { 'a.png': {} },
      page: null,
    });
  });
});

function plan(item: Content, args: Parameters<typeof planUpdate>[1]) {
  const planned = planUpdate(item, args);
  if (!planned.ok) throw new Error(planned.message);
  return planned.value;
}

describe('planUpdate', () => {
  it('should record changed fields with their previous values', () => {
    const planned = plan(content(), {
      key: 'id-1',
      displayName: 'Hi',
      language: 'en',
      data: { title: 'Hi', tags: ['a'], extra: 1 },
    });

    expect(planned.changed).toEqual(['displayName', 'language', 'data.title', 'data.extra']);
    expect(planned.previous).toEqual({
      displayName: 'Hello',
      language: null,
      'data.title': 'Hello',
      'data.extra': null,
    });
    expect(planned.requireValid).toBe(true);
  });

  it('should skip validation when no data is requested', () => {
    const planned = plan(content({ valid: false }), { key: 'id-1', displayName: 'Hi' });

    expect(planned.requireValid).toBe(false);
  });

  it('should report no changes when every value already matches', () => {
    const planned = plan(content(), { key: 'id-1', displayName: 'Hello', data: { tags: ['a'] } });

    expect(planned.changed).toEqual([]);
  });

  it.each([
    ['an item set', { items: { nested: true } }],
    ['an array of item sets', { items: [{ nested: true }] }],
  ])('should refuse to overwrite a field that holds %s', (_label, data) => {
    const planned = planUpdate(content({ data }), { key: 'id-1', data: { items: '' } });

    expect(planned.ok ? '' : planned.message).toContain('`data.items` holds nested data');
  });

  it('should apply changes onto the current content and keep untouched fields', () => {
    const planned = plan(content(), { key: 'id-1', data: { title: 'Hi' } });
    const current = content({ data: { title: 'Hello', other: 'kept', items: { nested: true } } });

    expect(planned.apply(current)).toEqual({
      ...current,
      data: { title: 'Hi', other: 'kept', items: { nested: true } },
    });
  });
});
