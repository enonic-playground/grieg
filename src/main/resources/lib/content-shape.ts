import type { Content, QueryDsl } from '@enonic-types/core';

// Pure shaping for the content tools: argument parsing, query building, summaries and the
// update plan. Nothing here touches XP, so it runs under Vitest as-is.

export const DEFAULT_COUNT = 10;
export const MAX_COUNT = 50;
// Per included subtree, in characters of compact JSON. Keeps a full `content_get` well under
// Claude Code's 10k-token warning.
export const SUBTREE_BUDGET = 6000;

const CONTENT_ROOT = '/content';
const SEARCH_FIELDS = ['displayName^5', '_name^3', '_allText'];

export const SUBTREES = ['data', 'x', 'page', 'attachments'] as const;
export type Subtree = (typeof SUBTREES)[number];

type JsonObject = Record<string, unknown>;

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

export type Summary = {
  id: string;
  name: string;
  path: string;
  displayName: string;
  type: string;
  language: string | null;
  modifiedTime: string | null;
  modifier: string | null;
  workflowState: string | null;
  valid: boolean;
  hasChildren: boolean | null;
  editUrl: string;
};

export type SearchArgs = {
  text?: string;
  path?: string;
  contentType?: string;
  count: number;
  start: number;
};

export type GetArgs = { key: string; include: Subtree[] };

export type Scalar = string | number | boolean;
export type DataValue = Scalar | Scalar[];

export type UpdateArgs = {
  key: string;
  displayName?: string;
  language?: string;
  data?: Record<string, DataValue>;
  expectedModifiedTime?: string;
};

export type UpdatePlan = {
  changed: string[];
  previous: JsonObject;
  requireValid: boolean;
  apply: <T extends Content>(content: T) => T;
};

//
// * Argument Parsing
//

function fail<T>(message: string): Parsed<T> {
  return { ok: false, message };
}

function unknownKeys(args: JsonObject, allowed: readonly string[]): string | undefined {
  const extra = Object.keys(args).filter((key) => !allowed.includes(key));
  if (extra.length === 0) return undefined;
  return `Unknown argument(s): ${extra.join(', ')}. Allowed: ${allowed.join(', ')}.`;
}

function optionalString(args: JsonObject, key: string): Parsed<string | undefined> {
  const value = args[key];
  if (value == null) return { ok: true, value: undefined };
  if (typeof value !== 'string') return fail(`\`${key}\` must be a string.`);
  const trimmed = value.trim();
  return { ok: true, value: trimmed === '' ? undefined : trimmed };
}

function optionalInteger(args: JsonObject, key: string): Parsed<number | undefined> {
  const value = args[key];
  if (value == null) return { ok: true, value: undefined };
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return fail(`\`${key}\` must be an integer.`);
  }
  return { ok: true, value };
}

export function parseSearchArgs(args: JsonObject): Parsed<SearchArgs> {
  const unknown = unknownKeys(args, ['text', 'path', 'contentType', 'count', 'start']);
  if (unknown != null) return fail(unknown);

  const text = optionalString(args, 'text');
  if (!text.ok) return text;
  const path = optionalString(args, 'path');
  if (!path.ok) return path;
  const contentType = optionalString(args, 'contentType');
  if (!contentType.ok) return contentType;
  const count = optionalInteger(args, 'count');
  if (!count.ok) return count;
  const start = optionalInteger(args, 'start');
  if (!start.ok) return start;

  if (path.value != null && !path.value.startsWith('/')) {
    return fail('`path` must start with `/`, e.g. `/my-site/articles`.');
  }
  if (count.value != null && (count.value < 1 || count.value > MAX_COUNT)) {
    return fail(`\`count\` must be between 1 and ${MAX_COUNT}.`);
  }
  if (start.value != null && start.value < 0) {
    return fail('`start` must be 0 or greater.');
  }

  return {
    ok: true,
    value: {
      text: text.value,
      path: path.value == null ? undefined : normalizeKey(path.value),
      contentType: contentType.value,
      count: count.value ?? DEFAULT_COUNT,
      start: start.value ?? 0,
    },
  };
}

export function parseGetArgs(args: JsonObject): Parsed<GetArgs> {
  const unknown = unknownKeys(args, ['key', 'include']);
  if (unknown != null) return fail(unknown);

  const key = optionalString(args, 'key');
  if (!key.ok) return key;
  if (key.value == null) return fail('`key` is required: a content id or path.');

  const include = args.include ?? ['data'];
  if (!Array.isArray(include) || !include.every((item) => SUBTREES.includes(item as Subtree))) {
    return fail(`\`include\` must be an array of: ${SUBTREES.join(', ')}.`);
  }

  return { ok: true, value: { key: key.value, include: include as Subtree[] } };
}

function isScalar(value: unknown): value is Scalar {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function parseData(value: unknown): Parsed<Record<string, DataValue> | undefined> {
  if (value == null) return { ok: true, value: undefined };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return fail('`data` must be an object of top-level field names to values.');
  }

  const entries = Object.entries(value as JsonObject);
  for (const [field, fieldValue] of entries) {
    const valid = isScalar(fieldValue) || (Array.isArray(fieldValue) && fieldValue.every(isScalar));
    if (!valid) {
      return fail(
        `\`data.${field}\` must be a string, number, boolean or an array of those. ` +
          'Nested objects (item sets) and null are not supported yet; edit them in Content Studio.',
      );
    }
  }
  return entries.length === 0
    ? { ok: true, value: undefined }
    : { ok: true, value: value as Record<string, DataValue> };
}

export function parseUpdateArgs(args: JsonObject): Parsed<UpdateArgs> {
  const unknown = unknownKeys(args, [
    'key',
    'displayName',
    'language',
    'data',
    'expectedModifiedTime',
  ]);
  if (unknown != null) return fail(unknown);

  const key = optionalString(args, 'key');
  if (!key.ok) return key;
  if (key.value == null) return fail('`key` is required: a content id or path.');
  const displayName = optionalString(args, 'displayName');
  if (!displayName.ok) return displayName;
  const language = optionalString(args, 'language');
  if (!language.ok) return language;
  const expectedModifiedTime = optionalString(args, 'expectedModifiedTime');
  if (!expectedModifiedTime.ok) return expectedModifiedTime;
  const data = parseData(args.data);
  if (!data.ok) return data;

  if (displayName.value == null && language.value == null && data.value == null) {
    return fail('Nothing to update: pass at least one of `displayName`, `language` or `data`.');
  }

  return {
    ok: true,
    value: {
      key: key.value,
      displayName: displayName.value,
      language: language.value,
      data: data.value,
      expectedModifiedTime: expectedModifiedTime.value,
    },
  };
}

//
// * Paths and Queries
//

// Content paths in lib-content are relative to the `/content` node, but users and Content
// Studio URLs often include it. Ids (no leading slash) pass through. Keys are looked up as
// given first, so a real top-level item named `content` still resolves.
export function normalizeKey(key: string): string {
  if (key === CONTENT_ROOT) return '/';
  if (key.startsWith(`${CONTENT_ROOT}/`)) return key.slice(CONTENT_ROOT.length);
  return key;
}

export function toNodePath(path: string): string {
  return path === '/' ? CONTENT_ROOT : `${CONTENT_ROOT}${path.replace(/\/+$/, '')}`;
}

export type SearchQuery = { query?: QueryDsl; sort: string };

// Built as DSL rather than a query string, so user text never needs escaping.
export function buildSearchQuery({ text, path }: Pick<SearchArgs, 'text' | 'path'>): SearchQuery {
  const must: QueryDsl[] = [];

  if (text != null) {
    must.push({
      boolean: {
        should: [
          { fulltext: { fields: SEARCH_FIELDS, query: text, operator: 'AND' } },
          { ngram: { fields: SEARCH_FIELDS, query: text, operator: 'AND' } },
        ],
      },
    });
  }

  if (path != null) {
    must.push(
      text == null
        ? { term: { field: '_parentPath', value: toNodePath(path) } }
        : { like: { field: '_path', value: `${toNodePath(path)}/*` } },
    );
  }

  return {
    query: must.length === 0 ? undefined : { boolean: { must } },
    sort: text == null ? 'modifiedTime DESC' : '_score DESC',
  };
}

//
// * Shaping
//

export function toSummary(
  content: Content,
  editBase: string,
  hasChildren: boolean | null,
): Summary {
  return {
    id: content._id,
    name: content._name,
    path: content._path,
    displayName: content.displayName,
    type: content.type,
    language: content.language ?? null,
    modifiedTime: content.modifiedTime ?? null,
    modifier: content.modifier ?? null,
    workflowState: content.workflow?.state ?? null,
    valid: content.valid,
    hasChildren,
    editUrl: `${editBase}/${content._id}`,
  };
}

export type Truncated = { truncated: true; size: number; message: string };

export function limitSubtree(name: Subtree, value: unknown): unknown {
  const json = JSON.stringify(value ?? null);
  if (json.length <= SUBTREE_BUDGET) return value ?? null;
  return {
    truncated: true,
    size: json.length,
    message: `\`${name}\` is ${json.length} characters, over the ${SUBTREE_BUDGET}-character budget. Open the item in Content Studio (editUrl) to see it in full.`,
  } satisfies Truncated;
}

export function pickSubtrees(content: Content, include: Subtree[]): JsonObject {
  const picked: JsonObject = {};
  for (const name of include) {
    picked[name] = limitSubtree(name, content[name]);
  }
  return picked;
}

//
// * Update Plan
//

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function holdsItemSet(value: unknown): boolean {
  const values = Array.isArray(value) ? value : [value];
  return values.some((item) => typeof item === 'object' && item != null);
}

// Plans against the content it is given; the update re-plans against what the editor receives,
// so a concurrent write never leaves part of the request unapplied.
export function planUpdate(content: Content, args: UpdateArgs): Parsed<UpdatePlan> {
  const changed: string[] = [];
  const previous: JsonObject = {};

  if (args.displayName != null && args.displayName !== content.displayName) {
    changed.push('displayName');
    previous.displayName = content.displayName;
  }
  if (args.language != null && args.language !== content.language) {
    changed.push('language');
    previous.language = content.language ?? null;
  }

  const data = content.data as JsonObject;
  const dataChanges: Record<string, DataValue> = {};
  for (const [field, value] of Object.entries(args.data ?? {})) {
    if (holdsItemSet(data[field])) {
      return fail(
        `\`data.${field}\` holds nested data (an item set) that a scalar would overwrite. Edit it in Content Studio.`,
      );
    }
    if (sameValue(data[field], value)) continue;
    changed.push(`data.${field}`);
    previous[`data.${field}`] = data[field] ?? null;
    dataChanges[field] = value;
  }

  const hasDataChanges = Object.keys(dataChanges).length > 0;
  return {
    ok: true,
    value: {
      changed,
      previous,
      // Renames stay possible on content that is already invalid; data edits are validated.
      requireValid: args.data != null,
      apply: (current) => ({
        ...current,
        ...(changed.includes('displayName') && { displayName: args.displayName }),
        ...(changed.includes('language') && { language: args.language }),
        ...(hasDataChanges && { data: { ...(current.data as JsonObject), ...dataChanges } }),
      }),
    },
  };
}
