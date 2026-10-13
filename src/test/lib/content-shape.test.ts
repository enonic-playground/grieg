import { describe, expect, it } from 'vitest';

import type { Content, FormItem } from '@enonic-types/core';

import {
  buildSearchQuery,
  checkOccurrences,
  createRefusal,
  flattenForm,
  limitSubtree,
  MAX_COUNT,
  normalizeKey,
  parseCreateArgs,
  parseGetArgs,
  parseSearchArgs,
  parseUpdateArgs,
  pickSubtrees,
  planUpdate,
  toNodePath,
  toSummary,
} from '../../main/resources/lib/content-shape';
import { encodeCursor, nextCursor, SUBTREE_BUDGET } from '../../main/resources/lib/shape';

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
    expect(parseSearchArgs({})).toEqual({
      ok: true,
      value: { count: 10, start: 0, fingerprint: expect.stringMatching(/^[\da-f]{8}$/) },
    });
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

    expect(parsed).toEqual({
      ok: true,
      value: { path: '/site', count: 10, start: 0, fingerprint: expect.any(String) },
    });
  });

  it.each([
    [{ path: 'site' }, 'must start with'],
    [{ count: 2.5 }, 'integer'],
    [{ text: 3 }, 'string'],
    [{ query: 'x' }, 'Unknown argument(s): query'],
    [{ count: 0 }, '`count` must be between 1 and 50'],
    [{ count: 51 }, '`count` must be between 1 and 50'],
    [{ start: -1 }, '`start` must be between 0 and 9999'],
    [{ start: 10_000 }, '`start` must be between 0 and 9999'],
    [{ start: 5, cursor: 'x' }, 'either `start` or `cursor`'],
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

describe('content_search cursors', () => {
  it('should resume from a cursor issued for the same arguments', () => {
    const first = parseSearchArgs({ text: 'hello', path: '/site' });
    if (!first.ok) throw new Error(first.message);
    const cursor = nextCursor(first.value, 10, 25);

    const second = parseSearchArgs({ text: 'hello', path: '/content/site', cursor, count: 5 });

    expect(second).toMatchObject({ ok: true, value: { start: 10, count: 5 } });
  });

  it('should refuse a cursor issued for different arguments', () => {
    const first = parseSearchArgs({ text: 'hello' });
    if (!first.ok) throw new Error(first.message);

    const other = parseSearchArgs({
      text: 'other',
      cursor: encodeCursor(10, first.value.fingerprint),
    });

    expect(other).toMatchObject({ ok: false, message: expect.stringContaining('different query') });
  });

  it('should shrink the page so it never crosses the result window', () => {
    const first = parseSearchArgs({});
    if (!first.ok) throw new Error(first.message);

    const last = parseSearchArgs({ cursor: encodeCursor(9995, first.value.fingerprint) });

    expect(last).toMatchObject({ ok: true, value: { start: 9995, count: 5 } });
  });
});

describe('parseGetArgs fields', () => {
  it('should drop the data default when fields are given', () => {
    expect(parseGetArgs({ key: 'id-1', fields: ['title', 'blocks.0.text'] })).toEqual({
      ok: true,
      value: { key: 'id-1', fields: ['title', 'blocks.0.text'], include: [] },
    });
  });

  it('should keep an explicit include next to fields', () => {
    expect(parseGetArgs({ key: 'id-1', fields: ['title'], include: ['x'] })).toMatchObject({
      ok: true,
      value: { include: ['x'] },
    });
  });

  it.each([
    [{ key: 'id-1', fields: 'title' }, 'must be an array of dot paths'],
    [{ key: 'id-1', fields: ['a..b'] }, 'invalid dot path'],
  ])('should reject %j', (args, message) => {
    const parsed = parseGetArgs(args);

    expect(parsed.ok ? '' : parsed.message).toContain(message);
  });
});

describe('parseCreateArgs', () => {
  it('should normalize the parent path and default data to an empty object', () => {
    expect(
      parseCreateArgs({
        parentPath: '/content/site',
        contentType: 'base:folder',
        displayName: 'News',
      }),
    ).toEqual({
      ok: true,
      value: {
        parentPath: '/site',
        contentType: 'base:folder',
        displayName: 'News',
        name: undefined,
        language: undefined,
        data: {},
      },
    });
  });

  it.each([
    [{ contentType: 'base:folder', displayName: 'A' }, '`parentPath` is required'],
    [{ parentPath: 'site', contentType: 'base:folder', displayName: 'A' }, 'must start with `/`'],
    [{ parentPath: '/', displayName: 'A' }, '`contentType` is required'],
    [{ parentPath: '/', contentType: 'base:folder' }, '`displayName` is required'],
    [
      { parentPath: '/', contentType: 'base:folder', displayName: 'A', name: 'a/b' },
      'must not contain `/`',
    ],
    [
      { parentPath: '/', contentType: 'a:b', displayName: 'A', data: [] },
      '`data` must be an object',
    ],
    [
      { parentPath: '/', contentType: 'a:b', displayName: 'A', data: null },
      '`data` must be an object',
    ],
    [
      { parentPath: '/', contentType: 'a:b', displayName: 'A', data: { set: { x: null } } },
      '`data.set.x` must be',
    ],
    [{ parentPath: '/', contentType: 'a:b', displayName: 'A', valid: true }, 'Unknown argument'],
  ])('should reject %j', (args, message) => {
    const parsed = parseCreateArgs(args);

    expect(parsed.ok ? '' : parsed.message).toContain(message);
  });
});

function input(name: string, min = 0, max = 1, extra: Record<string, unknown> = {}): FormItem {
  return {
    formItemType: 'Input',
    name,
    label: name,
    helpText: '',
    inputType: 'TextLine',
    occurrences: { minimum: min, maximum: max },
    ...extra,
  } as FormItem;
}

function itemSet(name: string, items: FormItem[], min = 0, max = 0): FormItem {
  return {
    formItemType: 'ItemSet',
    name,
    label: name,
    helpText: '',
    occurrences: { minimum: min, maximum: max },
    items,
  } as FormItem;
}

function optionSet(
  name: string,
  options: { name: string; items: FormItem[] }[],
  selection = { minimum: 1, maximum: 1 },
): FormItem {
  return {
    formItemType: 'OptionSet',
    name,
    label: name,
    helpText: '',
    occurrences: { minimum: 1, maximum: 1 },
    selection,
    options: options.map((option) => ({
      ...option,
      label: option.name,
      helpText: '',
      default: false,
    })),
  } as unknown as FormItem;
}

function layout(items: FormItem[]): FormItem {
  return { formItemType: 'Layout', name: '', label: 'Group', items } as FormItem;
}

function nestedSets(depth: number): FormItem {
  let item = input('leaf');
  for (let i = depth; i >= 1; i--) item = itemSet(`s${i}`, [item]);
  return item;
}

describe('flattenForm', () => {
  it('should list inputs by data path, see through layouts and keep input config', () => {
    const form = [
      input('title', 1, 1),
      layout([input('color', 0, 1, { inputType: 'ComboBox', options: [{ value: 'red' }] })]),
    ];

    expect(flattenForm(form)).toEqual({
      fields: [
        {
          path: 'title',
          kind: 'input',
          label: 'title',
          inputType: 'TextLine',
          occurrences: { min: 1, max: 1 },
        },
        {
          path: 'color',
          kind: 'input',
          label: 'color',
          inputType: 'ComboBox',
          occurrences: { min: 0, max: 1 },
          config: { options: [{ value: 'red' }] },
        },
      ],
      capped: [],
    });
  });

  it('should nest item set and option set fields under their names', () => {
    const form = [
      itemSet('blocks', [input('text')]),
      optionSet('media', [{ name: 'image', items: [input('caption')] }]),
    ];

    const paths = flattenForm(form).fields.map((field) => [field.path, field.kind]);

    expect(paths).toEqual([
      ['blocks', 'itemSet'],
      ['blocks.text', 'input'],
      ['media', 'optionSet'],
      ['media.image', 'option'],
      ['media.image.caption', 'input'],
    ]);
  });

  it('should expand sets up to the depth cap and mark where it stopped', () => {
    const { fields, capped } = flattenForm([nestedSets(3)], 2);

    expect(fields.map((field) => field.path)).toEqual(['s1', 's1.s2', 's1.s2.s3']);
    expect(fields.at(-1)).toMatchObject({ path: 's1.s2.s3', capped: true });
    expect(capped).toEqual(['s1.s2.s3']);
  });

  it('should not cap a set exactly at the depth limit', () => {
    const { fields, capped } = flattenForm([nestedSets(2)], 2);

    expect(fields.map((field) => field.path)).toEqual(['s1', 's1.s2', 's1.s2.leaf']);
    expect(capped).toEqual([]);
  });
});

describe('checkOccurrences', () => {
  it('should name missing required and surplus values by path', () => {
    const form = [input('title', 1, 1), input('tags', 0, 2), layout([input('lead', 1, 1)])];

    expect(checkOccurrences(form, { tags: ['a', 'b', 'c'] })).toEqual([
      '`data.title` needs at least 1 value(s), got 0.',
      '`data.tags` takes at most 2 value(s), got 3.',
      '`data.lead` needs at least 1 value(s), got 0.',
    ]);
  });

  it('should count empty strings but not nulls, as XP does', () => {
    expect(checkOccurrences([input('title', 1, 1)], { title: [null, ''] })).toEqual([]);
  });

  it('should check inside each item set occurrence', () => {
    const form = [itemSet('blocks', [input('text', 1, 1)])];

    expect(checkOccurrences(form, { blocks: [{ text: 'a' }, {}] })).toEqual([
      '`data.blocks.1.text` needs at least 1 value(s), got 0.',
    ]);
    expect(checkOccurrences(form, { blocks: {} })).toEqual([
      '`data.blocks.text` needs at least 1 value(s), got 0.',
    ]);
  });

  it('should skip a selected option without a data object, as XP does', () => {
    const form = [optionSet('media', [{ name: 'image', items: [input('caption', 1, 1)] }])];

    expect(checkOccurrences(form, { media: { _selected: ['image'] } })).toEqual([]);
  });

  it('should stop at the first option set occurrence with nothing selected, as XP does', () => {
    const media = optionSet('media', [{ name: 'image', items: [input('caption', 1, 1)] }], {
      minimum: 0,
      maximum: 1,
    });
    const form = [{ ...media, occurrences: { minimum: 0, maximum: 0 } } as FormItem];

    expect(
      checkOccurrences(form, { media: [{ _selected: [] }, { _selected: ['image'], image: {} }] }),
    ).toEqual([]);
  });

  it('should read a maximum of 0 as unlimited', () => {
    const form = [
      input('tags', 1, 0),
      optionSet(
        'media',
        [
          { name: 'image', items: [] },
          { name: 'video', items: [] },
        ],
        {
          minimum: 1,
          maximum: 0,
        },
      ),
    ];

    expect(
      checkOccurrences(form, { tags: ['a', 'b', 'c'], media: { _selected: ['image', 'video'] } }),
    ).toEqual([]);
  });

  it('should check the option set selection and only the selected options', () => {
    const form = [
      optionSet('media', [
        { name: 'image', items: [input('caption', 1, 1)] },
        { name: 'video', items: [input('url', 1, 1)] },
      ]),
    ];

    expect(checkOccurrences(form, { media: { _selected: 'image', image: {} } })).toEqual([
      '`data.media.image.caption` needs at least 1 value(s), got 0.',
    ]);
    expect(checkOccurrences(form, { media: { _selected: [] } })).toEqual([
      '`data.media._selected` must name 1 to 1 option(s), got 0.',
    ]);
  });
});

describe('createRefusal', () => {
  it("should pass XP's message through", () => {
    expect(createRefusal('my.app:article', 'Invalid value in [data.date]: bad')).toContain(
      'refused to create the `my.app:article` item: Invalid value in [data.date]: bad.',
    );
  });

  it.each([undefined, '', 'null'])('should explain a refusal without a message (%j)', (raw) => {
    expect(createRefusal('a:b', raw)).toContain('not valid for the content type');
  });
});
