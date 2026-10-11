import { describe, expect, it } from 'vitest';

import type { UpdateArgs } from '../../main/resources/lib/node-shape';

import { SUBTREE_BUDGET } from '../../main/resources/lib/content-shape';
import {
  capAggregations,
  decodeCursor,
  defaultBranch,
  encodeCursor,
  limitAggregations,
  limitSubtree,
  nextCursor,
  parseCreateArgs,
  parseGetArgs,
  parseQueryArgs,
  parseUpdateArgs,
  planUpdate,
  projectFields,
  readPath,
  repoAccess,
  RESULT_WINDOW,
  toNodeSummary,
} from '../../main/resources/lib/node-shape';

type JsonObject = Record<string, unknown>;

const RULES = { allowlist: [], readOnly: false };

function node(overrides: JsonObject = {}): JsonObject {
  return {
    _id: 'n1',
    _name: 'item',
    _path: '/workflows/item',
    _nodeType: 'default',
    _ts: '2026-01-01T00:00:00Z',
    _versionKey: 'v1',
    _childOrder: '_ts DESC',
    _permissions: [{ principal: 'role:system.admin', allow: ['READ'] }],
    title: 'Hello',
    address: { city: 'Oslo', zip: '0150' },
    tags: ['a', 'b'],
    ...overrides,
  };
}

function value<T>(parsed: { ok: true; value: T } | { ok: false; message: string }): T {
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}

function message(parsed: { ok: boolean; message?: string }): string {
  if (parsed.ok) throw new Error('expected a failure');
  return parsed.message ?? '';
}

function updateArgs(overrides: Partial<UpdateArgs> = {}): UpdateArgs {
  return { repo: 'scratch', branch: 'master', key: 'n1', set: {}, unset: [], ...overrides };
}

function plain(path: string): never {
  throw new Error(`unexpected typed value at ${path}`);
}

// Stand-ins for the Java objects lib-node hands the editor: java.time values are typeof
// 'function' under GraalJS, the XP value classes typeof 'object'.
const instantLike = Object.assign(() => undefined, { toString: () => '2026-01-01T00:00:00Z' });
const geoPointLike = new (class GeoPoint {})();

describe('repository rules', () => {
  it.each(['system-repo', 'system.auditlog', 'system.scheduler'])(
    'should deny %s even when allowlisted',
    (repo) => {
      expect(message(repoAccess(repo, { allowlist: [repo], readOnly: false }))).toContain(
        'system repository',
      );
    },
  );

  it('should make content repositories read-only and others writable', () => {
    expect(value(repoAccess('com.enonic.cms.default', RULES))).toBe('read');
    expect(value(repoAccess('com.enonic.app.grieg', RULES))).toBe('write');
  });

  it('should make every repository read-only under mcp.readOnly', () => {
    expect(value(repoAccess('com.enonic.app.grieg', { allowlist: [], readOnly: true }))).toBe(
      'read',
    );
  });

  it('should refuse repositories outside a non-empty allowlist', () => {
    const rules = { allowlist: ['scratch'], readOnly: false };

    expect(value(repoAccess('scratch', rules))).toBe('write');
    expect(message(repoAccess('com.enonic.app.grieg', rules))).toContain('mcp.nodes.repos');
  });

  it('should default to draft for content repositories and master otherwise', () => {
    expect(defaultBranch('com.enonic.cms.default')).toBe('draft');
    expect(defaultBranch('com.enonic.app.grieg')).toBe('master');
  });
});

describe('cursors', () => {
  const args = { repo: 'scratch', query: "_parentPath = '/workflows'" };

  it('should round-trip a cursor for the same query, whatever its key order', () => {
    const first = value(parseQueryArgs({ ...args, filters: { a: 1, b: 2 } }));
    const cursor = nextCursor(first, 10, 25);

    const second = value(parseQueryArgs({ ...args, filters: { b: 2, a: 1 }, cursor }));

    expect(second.start).toBe(10);
  });

  it('should refuse a cursor from a different query', () => {
    const cursor = nextCursor(value(parseQueryArgs(args)), 10, 25);

    expect(message(parseQueryArgs({ ...args, query: 'other', cursor }))).toContain(
      'different query',
    );
  });

  it('should refuse a cursor it did not issue', () => {
    expect(message(decodeCursor('10', 'abcdef01'))).toContain('not a cursor');
  });

  it('should stop paging at the last hit and at the result window', () => {
    const parsed = value(parseQueryArgs(args));

    expect(nextCursor(parsed, 5, 5)).toBeUndefined();
    expect(nextCursor({ ...parsed, start: RESULT_WINDOW - 10 }, 10, RESULT_WINDOW + 100)).toBe(
      undefined,
    );
  });

  it('should refuse a cursor at the result window', () => {
    const { fingerprint } = value(parseQueryArgs(args));

    expect(value(decodeCursor(encodeCursor(RESULT_WINDOW - 1, fingerprint), fingerprint))).toBe(
      RESULT_WINDOW - 1,
    );
    expect(message(decodeCursor(encodeCursor(RESULT_WINDOW, fingerprint), fingerprint))).toContain(
      'out of range',
    );
  });

  it('should shrink the last page so start + count stays within the result window', () => {
    const parsed = value(parseQueryArgs(args));
    const cursor = encodeCursor(RESULT_WINDOW - 3, parsed.fingerprint);

    expect(value(parseQueryArgs({ ...args, count: 50, cursor })).count).toBe(3);
  });
});

describe('parseQueryArgs', () => {
  it('should default the branch per repository and the count to 10', () => {
    expect(value(parseQueryArgs({ repo: 'com.enonic.cms.default' }))).toMatchObject({
      branch: 'draft',
      count: 10,
      start: 0,
    });
  });

  it('should accept a count from 1 to 50 only', () => {
    expect(message(parseQueryArgs({ repo: 'r', count: 0 }))).toContain('between 1 and 50');
    expect(message(parseQueryArgs({ repo: 'r', count: 51 }))).toContain('between 1 and 50');
    expect(value(parseQueryArgs({ repo: 'r', count: 50 })).count).toBe(50);
  });

  it('should refuse an unknown argument', () => {
    expect(message(parseQueryArgs({ repo: 'r', limit: 5 }))).toContain('Unknown argument');
  });

  it('should require a repository', () => {
    expect(message(parseQueryArgs({}))).toContain('`repo` is required');
  });
});

describe('capAggregations', () => {
  it('should clamp bucket sizes at every level', () => {
    const capped = capAggregations({
      byType: {
        terms: { field: '_nodeType', size: 500 },
        aggregations: { byName: { terms: { field: '_name', size: 1000 } } },
      },
      small: { terms: { field: 'x', size: 5 } },
      text: { terms: { field: 'y', size: '100000' } },
      unlimited: { terms: { field: 'z', size: 0 } },
      numeric: { terms: { field: 'w', size: '5' } },
    });

    expect(capped).toEqual({
      byType: {
        terms: { field: '_nodeType', size: 50 },
        aggregations: { byName: { terms: { field: '_name', size: 50 } } },
      },
      small: { terms: { field: 'x', size: 5 } },
      text: { terms: { field: 'y', size: 50 } },
      unlimited: { terms: { field: 'z', size: 50 } },
      numeric: { terms: { field: 'w', size: 5 } },
    });
  });

  it('should replace oversized aggregation results with a marker', () => {
    expect(limitAggregations({ a: { buckets: [] } })).toEqual({ a: { buckets: [] } });
    expect(limitAggregations({ a: 'x'.repeat(SUBTREE_BUDGET) })).toMatchObject({
      truncated: true,
    });
  });
});

describe('projection', () => {
  it('should read dot paths through objects and array indexes', () => {
    expect(readPath(node(), 'address.city')).toBe('Oslo');
    expect(readPath(node(), 'tags.1')).toBe('b');
    expect(readPath(node(), 'address.missing')).toBeUndefined();
    expect(readPath(node(), 'title.length')).toBeUndefined();
  });

  it('should keep only the six system fields in a summary', () => {
    expect(toNodeSummary(node())).toEqual({
      _id: 'n1',
      _name: 'item',
      _path: '/workflows/item',
      _nodeType: 'default',
      _ts: '2026-01-01T00:00:00Z',
      _versionKey: 'v1',
    });
  });

  it('should spend one budget across hits and mark what no longer fits', () => {
    const budget = { remaining: 10 };
    const big = node({ title: 'x'.repeat(20) });

    expect(projectFields(node(), ['title', 'missing'], budget)).toEqual({ title: 'Hello' });
    expect(budget.remaining).toBe(3);
    expect(projectFields(big, ['title'], budget).title).toMatchObject({
      truncated: true,
      size: 22,
    });
  });

  it('should include a value that exactly fills the budget', () => {
    const exact = { remaining: 7 };

    expect(projectFields(node(), ['title'], exact)).toEqual({ title: 'Hello' });
    expect(exact.remaining).toBe(0);
  });

  it('should return small subtrees as-is and data without system properties', () => {
    expect(limitSubtree(node(), 'data')).toEqual({
      title: 'Hello',
      address: { city: 'Oslo', zip: '0150' },
      tags: ['a', 'b'],
    });
    expect(limitSubtree(node(), 'permissions')).toEqual(node()._permissions);
  });

  it('should replace an oversized subtree with a marker naming paths to narrow by', () => {
    const marker = limitSubtree(node({ body: 'x'.repeat(SUBTREE_BUDGET) }), 'data') as {
      truncated: boolean;
      message: string;
    };

    expect(marker.truncated).toBe(true);
    expect(marker.message).toContain('`title`');
    expect(marker.message).toContain('`fields`');
  });
});

describe('parseGetArgs', () => {
  it('should default include to data, or to nothing when fields are given', () => {
    expect(value(parseGetArgs({ repo: 'r', key: '/a' })).include).toEqual(['data']);
    expect(value(parseGetArgs({ repo: 'r', key: '/a', fields: ['title'] })).include).toEqual([]);
  });

  it('should refuse an unknown subtree and an empty dot path segment', () => {
    expect(message(parseGetArgs({ repo: 'r', key: '/a', include: ['x'] }))).toContain(
      'data, permissions, indexConfig',
    );
    expect(message(parseGetArgs({ repo: 'r', key: '/a', fields: ['a..b'] }))).toContain(
      'invalid dot path',
    );
  });
});

describe('parseCreateArgs', () => {
  it('should refuse system properties, permissions included', () => {
    const outcome = parseCreateArgs({
      repo: 'r',
      parentPath: '/',
      name: 'n',
      data: { _permissions: [] },
    });

    expect(message(outcome)).toContain('`data._permissions` cannot be set on create');
  });

  it('should accept the system properties lib-node takes on create', () => {
    const data = { _nodeType: 'grieg:workflow', _childOrder: '_name ASC', _indexConfig: {} };

    expect(value(parseCreateArgs({ repo: 'r', parentPath: '/', name: 'n', data })).data).toEqual(
      data,
    );
  });

  it('should refuse null values at any depth', () => {
    const outcome = parseCreateArgs({
      repo: 'r',
      parentPath: '/',
      name: 'n',
      data: { a: { b: [1, null] } },
    });

    expect(message(outcome)).toContain('`data.a.b.1`');
  });

  it('should require a parent path and a name without slashes', () => {
    expect(message(parseCreateArgs({ repo: 'r', parentPath: 'x', name: 'n' }))).toContain(
      'parentPath',
    );
    expect(message(parseCreateArgs({ repo: 'r', parentPath: '/', name: 'a/b' }))).toContain(
      '`name`',
    );
  });
});

describe('parseUpdateArgs', () => {
  it('should refuse system fields in set and unset', () => {
    expect(message(parseUpdateArgs({ repo: 'r', key: 'k', set: { _name: 'x' } }))).toContain(
      '`_name` is a system property',
    );
    expect(message(parseUpdateArgs({ repo: 'r', key: 'k', unset: ['_childOrder'] }))).toContain(
      '`_childOrder` is a system property',
    );
  });

  it('should refuse overlapping paths and objects as values', () => {
    expect(
      message(parseUpdateArgs({ repo: 'r', key: 'k', set: { a: 1 }, unset: ['a.b'] })),
    ).toContain('overlap');
    expect(message(parseUpdateArgs({ repo: 'r', key: 'k', set: { a: { b: 1 } } }))).toContain(
      'must be a string, number, boolean',
    );
  });

  it('should refuse empty arrays and more than 50 set paths', () => {
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`p${i}`, i]));

    expect(message(parseUpdateArgs({ repo: 'r', key: 'k', set: { a: [] } }))).toContain(
      'non-empty array',
    );
    expect(message(parseUpdateArgs({ repo: 'r', key: 'k', set: many }))).toContain(
      'at most 50 paths',
    );
  });

  it('should refuse an update that changes nothing', () => {
    expect(message(parseUpdateArgs({ repo: 'r', key: 'k' }))).toContain('Nothing to update');
  });
});

describe('planUpdate', () => {
  it('should set nested paths, create missing parents and report previous values', () => {
    const plan = value(
      planUpdate(node(), updateArgs({ set: { 'address.city': 'Bergen', 'meta.rating': 5 } })),
    );
    const original = node();

    const applied = plan.apply(original, plain);

    expect(plan.changed).toEqual(['address.city', 'meta.rating']);
    expect(plan.previous).toEqual({ 'address.city': 'Oslo', 'meta.rating': null });
    expect(applied.address).toEqual({ city: 'Bergen', zip: '0150' });
    expect(applied.meta).toEqual({ rating: 5 });
    expect(original.address).toEqual({ city: 'Oslo', zip: '0150' });
  });

  it('should unset paths and skip ones that are absent or already equal', () => {
    const plan = value(
      planUpdate(node(), updateArgs({ set: { title: 'Hello' }, unset: ['address.zip', 'nope'] })),
    );

    expect(plan.changed).toEqual(['address.zip']);
    expect(plan.previous).toEqual({ 'address.zip': '0150' });
    expect(plan.apply(node(), plain).address).toEqual({ city: 'Oslo' });
  });

  it('should refuse to overwrite nested data or set inside a scalar', () => {
    expect(message(planUpdate(node(), updateArgs({ set: { address: 'x' } })))).toContain(
      'holds nested data',
    );
    expect(message(planUpdate(node(), updateArgs({ set: { 'title.x': 1 } })))).toContain(
      '`title` holds a value',
    );
  });

  it('should treat a one-element list as equal to the bare value lib-node reads back', () => {
    const plan = value(planUpdate(node({ tags: 'a' }), updateArgs({ set: { tags: ['a'] } })));

    expect(plan.changed).toEqual([]);
  });

  it('should create a parent named like an Object.prototype member', () => {
    const plan = value(
      planUpdate(node({ meta: {} }), updateArgs({ set: { 'meta.constructor.label': 'x' } })),
    );

    expect(plan.apply(node({ meta: {} }), plain).meta).toEqual({ constructor: { label: 'x' } });
  });

  it('should truncate an oversized previous value of a set', () => {
    const big = 'x'.repeat(SUBTREE_BUDGET + 1);
    const plan = value(planUpdate(node({ body: big }), updateArgs({ set: { body: 'short' } })));

    expect(plan.previous.body).toMatchObject({ truncated: true, size: SUBTREE_BUDGET + 3 });
  });

  it('should keep the system properties of the node it applies to', () => {
    const plan = value(planUpdate(node(), updateArgs({ set: { title: 'Hi' } })));

    expect(plan.apply(node(), plain)).toMatchObject({ _id: 'n1', _versionKey: 'v1', title: 'Hi' });
  });

  it('should hand a set over a typed value to retype and store what it returns', () => {
    const read = node({ meta: { at: '2026-01-01T00:00:00Z' } });
    const raw = node({ meta: { at: instantLike }, where: geoPointLike });
    const plan = value(
      planUpdate(read, updateArgs({ set: { 'meta.at': '2026-02-01T00:00:00Z', title: 'Hi' } })),
    );
    const calls: unknown[][] = [];

    const applied = plan.apply(raw, (...args) => {
      calls.push(args);
      return 'retyped';
    });

    expect(calls).toEqual([['meta.at', instantLike, '2026-02-01T00:00:00Z']]);
    expect(applied).toMatchObject({ meta: { at: 'retyped' }, title: 'Hi', where: geoPointLike });
  });

  it('should hand a set over a list holding a typed value to retype', () => {
    const plan = value(planUpdate(node({ tags: ['a', 'b'] }), updateArgs({ set: { tags: 'c' } })));

    expect(() => plan.apply(node({ tags: ['a', geoPointLike] }), plain)).toThrow(
      'unexpected typed value at tags',
    );
  });

  it('should store sets over plain stored values without retyping them', () => {
    const stored = { title: 'Hello', count: 2, ratio: 2.5, done: false, tags: ['a', 2] };
    const plan = value(
      planUpdate(
        node(stored),
        updateArgs({ set: { title: 'Hi', count: 3, ratio: 1.5, done: true, tags: ['b'] } }),
      ),
    );

    expect(plan.apply(node(stored), plain)).toMatchObject({
      title: 'Hi',
      count: 3,
      ratio: 1.5,
      done: true,
      tags: ['b'],
    });
  });
});
