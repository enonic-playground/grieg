// Pure shaping for the node tools: repository rules, argument parsing, budgets and the
// update plan. Nothing here touches XP, so it runs under Vitest as-is.

import {
  DEFAULT_COUNT,
  MAX_COUNT,
  optionalInteger,
  optionalString,
  unknownKeys,
  type DataValue,
} from './content-shape';
import {
  decodeCursor,
  isDotPath,
  isObject,
  isScalar,
  MAX_FIELDS,
  parseFields,
  parsePaths,
  queryFingerprint,
  RESULT_WINDOW,
  SUBTREE_BUDGET,
  truncation,
  type Parsed,
  type Truncated,
} from './shape';

export const MAX_BUCKETS = 50;
// Shared by the projected fields of every hit on one `node_query` page.
export const PAGE_BUDGET = 4 * SUBTREE_BUDGET;

const CONTENT_REPO_PREFIX = 'com.enonic.cms.';

export const NODE_SUBTREES = ['data', 'permissions', 'indexConfig'] as const;
export type NodeSubtree = (typeof NODE_SUBTREES)[number];

const SUBTREE_PATHS: Record<NodeSubtree, string> = {
  data: '',
  permissions: '_permissions',
  indexConfig: '_indexConfig',
};

type JsonObject = Record<string, unknown>;

export type NodeSummary = {
  _id: string;
  _name: string;
  _path: string;
  _nodeType: string;
  _ts: string;
  _versionKey: string;
};

const SUMMARY_KEYS = ['_id', '_name', '_path', '_nodeType', '_ts', '_versionKey'] as const;

export type Target = { repo: string; branch: string };

export type QueryArgs = Target & {
  query?: string | JsonObject;
  filters?: JsonObject | JsonObject[];
  sort?: string | JsonObject | JsonObject[];
  aggregations?: JsonObject;
  fields?: string[];
  count: number;
  start: number;
  fingerprint: string;
};

export type GetArgs = Target & { key: string; fields?: string[]; include: NodeSubtree[] };

export type CreateArgs = Target & { parentPath: string; name: string; data: JsonObject };

export type UpdateArgs = Target & {
  key: string;
  set: Record<string, DataValue>;
  unset: string[];
  expectedVersionKey?: string;
};

// Returns the value to store at `path` in place of a typed `stored` value, or throws to refuse.
export type Retype = (path: string, stored: unknown, value: DataValue) => unknown;

export type UpdatePlan = {
  changed: string[];
  previous: JsonObject;
  apply: <T extends JsonObject>(node: T, retype: Retype) => T;
};

function fail<T>(message: string): Parsed<T> {
  return { ok: false, message };
}

//
// * Repository Rules
//

export function isSystemRepo(repo: string): boolean {
  return repo === 'system-repo' || repo.startsWith('system.');
}

export function isContentRepo(repo: string): boolean {
  return repo.startsWith(CONTENT_REPO_PREFIX);
}

export function defaultBranch(repo: string): string {
  return isContentRepo(repo) ? 'draft' : 'master';
}

export type RepoRules = { allowlist: string[]; readOnly: boolean };

export type RepoAccess = 'read' | 'write';

export function repoAccess(repo: string, rules: RepoRules): Parsed<RepoAccess> {
  if (isSystemRepo(repo)) {
    return fail(
      `\`${repo}\` is a system repository and is never available through the node tools.`,
    );
  }
  if (rules.allowlist.length > 0 && !rules.allowlist.includes(repo)) {
    return fail(
      `\`${repo}\` is not in \`mcp.nodes.repos\`. Call node_repos for the repositories you can use.`,
    );
  }
  return { ok: true, value: rules.readOnly || isContentRepo(repo) ? 'read' : 'write' };
}

export function writeRefusal(repo: string): string {
  return isContentRepo(repo)
    ? `\`${repo}\` is a content repository, read-only through the node tools: a node write would bypass content validation and project roles. Use content_update instead.`
    : `\`${repo}\` is read-only: the server runs with \`mcp.readOnly\`.`;
}

//
// * Argument Parsing
//

function parseTarget(args: JsonObject): Parsed<Target> {
  const repo = optionalString(args, 'repo');
  if (!repo.ok) return repo;
  if (repo.value == null) return fail('`repo` is required: a repository id from node_repos.');
  const branch = optionalString(args, 'branch');
  if (!branch.ok) return branch;
  return {
    ok: true,
    value: { repo: repo.value, branch: branch.value ?? defaultBranch(repo.value) },
  };
}

function isObjectOrObjects(value: unknown): value is JsonObject | JsonObject[] {
  return isObject(value) || (Array.isArray(value) && value.every(isObject));
}

// lib-node casts `size` to an int, and Elasticsearch reads 0 as "every bucket".
function bucketSize(size: unknown): number {
  const n = Math.trunc(Number(size));
  return n >= 1 && n <= MAX_BUCKETS ? n : MAX_BUCKETS;
}

export function capAggregations(aggregations: JsonObject): JsonObject {
  const capped: JsonObject = {};
  for (const [name, definition] of Object.entries(aggregations)) {
    if (!isObject(definition)) {
      capped[name] = definition;
      continue;
    }
    const next: JsonObject = {};
    for (const [type, body] of Object.entries(definition)) {
      if (type === 'aggregations' && isObject(body)) {
        next[type] = capAggregations(body);
      } else if (isObject(body) && body.size != null) {
        next[type] = { ...body, size: bucketSize(body.size) };
      } else {
        next[type] = body;
      }
    }
    capped[name] = next;
  }
  return capped;
}

export function parseQueryArgs(args: JsonObject): Parsed<QueryArgs> {
  const unknown = unknownKeys(args, [
    'repo',
    'branch',
    'query',
    'filters',
    'sort',
    'fields',
    'count',
    'cursor',
    'aggregations',
  ]);
  if (unknown != null) return fail(unknown);

  const target = parseTarget(args);
  if (!target.ok) return target;

  const { query, filters, sort, aggregations } = args;
  if (query != null && typeof query !== 'string' && !isObject(query)) {
    return fail('`query` must be a query DSL object or a NoQL string.');
  }
  if (filters != null && !isObjectOrObjects(filters)) {
    return fail('`filters` must be a filter object or an array of them.');
  }
  if (sort != null && typeof sort !== 'string' && !isObjectOrObjects(sort)) {
    return fail(
      '`sort` must be a string such as "_ts DESC", a sort DSL object, or an array of them.',
    );
  }
  if (aggregations != null && !isObject(aggregations)) {
    return fail('`aggregations` must be an object of aggregation names to definitions.');
  }

  const fields = parseFields(args);
  if (!fields.ok) return fields;
  const count = optionalInteger(args, 'count');
  if (!count.ok) return count;
  if (count.value != null && (count.value < 1 || count.value > MAX_COUNT)) {
    return fail(`\`count\` must be between 1 and ${MAX_COUNT}.`);
  }
  const cursor = optionalString(args, 'cursor');
  if (!cursor.ok) return cursor;

  const { repo, branch } = target.value;
  const capped = aggregations == null ? undefined : capAggregations(aggregations);
  const fingerprint = queryFingerprint([repo, branch, query, filters, sort, capped]);
  let start = 0;
  if (cursor.value != null) {
    const decoded = decodeCursor(cursor.value, fingerprint);
    if (!decoded.ok) return decoded;
    start = decoded.value;
  }

  return {
    ok: true,
    value: {
      repo,
      branch,
      query: query ?? undefined,
      filters: filters ?? undefined,
      sort: sort ?? undefined,
      aggregations: capped,
      fields: fields.value,
      count: Math.min(count.value ?? DEFAULT_COUNT, RESULT_WINDOW - start),
      start,
      fingerprint,
    },
  };
}

function parseKey(args: JsonObject): Parsed<string> {
  const key = optionalString(args, 'key');
  if (!key.ok) return key;
  if (key.value == null) return fail('`key` is required: a node id or path.');
  return { ok: true, value: key.value };
}

export function parseGetArgs(args: JsonObject): Parsed<GetArgs> {
  const unknown = unknownKeys(args, ['repo', 'branch', 'key', 'fields', 'include']);
  if (unknown != null) return fail(unknown);

  const target = parseTarget(args);
  if (!target.ok) return target;
  const key = parseKey(args);
  if (!key.ok) return key;
  const fields = parseFields(args);
  if (!fields.ok) return fields;

  const include = args.include ?? (fields.value == null ? ['data'] : []);
  if (
    !Array.isArray(include) ||
    !include.every((item) => NODE_SUBTREES.includes(item as NodeSubtree))
  ) {
    return fail(`\`include\` must be an array of: ${NODE_SUBTREES.join(', ')}.`);
  }

  return {
    ok: true,
    value: {
      ...target.value,
      key: key.value,
      fields: fields.value,
      include: include as NodeSubtree[],
    },
  };
}

function isSystemField(path: string): boolean {
  return path.startsWith('_');
}

// What lib-node takes on create besides `_name` and `_parentPath`, which have their own arguments.
const CREATE_SYSTEM_FIELDS = ['_nodeType', '_childOrder', '_indexConfig'];

function invalidValue(value: unknown, path: string): string | undefined {
  if (isScalar(value)) return undefined;
  if (Array.isArray(value) || isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      const invalid = invalidValue(item, `${path}.${key}`);
      if (invalid != null) return invalid;
    }
    return undefined;
  }
  return `\`${path}\` must be a string, number, boolean, object or array; null is not stored.`;
}

export function parseCreateArgs(args: JsonObject): Parsed<CreateArgs> {
  const unknown = unknownKeys(args, ['repo', 'branch', 'parentPath', 'name', 'data']);
  if (unknown != null) return fail(unknown);

  const target = parseTarget(args);
  if (!target.ok) return target;
  const parentPath = optionalString(args, 'parentPath');
  if (!parentPath.ok) return parentPath;
  if (parentPath.value == null || !parentPath.value.startsWith('/')) {
    return fail('`parentPath` is required and must start with `/`, e.g. `/` or `/workflows`.');
  }
  const name = optionalString(args, 'name');
  if (!name.ok) return name;
  if (name.value == null || name.value.includes('/')) {
    return fail('`name` is required and must not contain `/`.');
  }

  const data = args.data ?? {};
  if (!isObject(data)) return fail('`data` must be an object of property names to values.');
  const system = Object.keys(data).find(
    (key) => isSystemField(key) && !CREATE_SYSTEM_FIELDS.includes(key),
  );
  if (system != null) {
    return fail(
      `\`data.${system}\` cannot be set on create. Of the system properties only ${CREATE_SYSTEM_FIELDS.join(', ')} are accepted; permissions are inherited from the parent.`,
    );
  }
  const invalid = invalidValue(data, 'data');
  if (invalid != null) return fail(invalid);

  return {
    ok: true,
    value: { ...target.value, parentPath: parentPath.value, name: name.value, data },
  };
}

function overlapping(paths: string[]): [string, string] | undefined {
  for (const [i, a] of paths.entries()) {
    for (const b of paths.slice(i + 1)) {
      if (a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`)) return [a, b];
    }
  }
  return undefined;
}

export function parseUpdateArgs(args: JsonObject): Parsed<UpdateArgs> {
  const unknown = unknownKeys(args, [
    'repo',
    'branch',
    'key',
    'set',
    'unset',
    'expectedVersionKey',
  ]);
  if (unknown != null) return fail(unknown);

  const target = parseTarget(args);
  if (!target.ok) return target;
  const key = parseKey(args);
  if (!key.ok) return key;
  const expectedVersionKey = optionalString(args, 'expectedVersionKey');
  if (!expectedVersionKey.ok) return expectedVersionKey;

  const set = args.set ?? {};
  if (!isObject(set)) return fail('`set` must be an object of dot paths to values.');
  if (Object.keys(set).length > MAX_FIELDS)
    return fail(`\`set\` takes at most ${MAX_FIELDS} paths.`);
  for (const [path, value] of Object.entries(set)) {
    if (!isDotPath(path)) return fail(`\`set\` has an invalid dot path: \`${path}\`.`);
    const valid =
      isScalar(value) || (Array.isArray(value) && value.length > 0 && value.every(isScalar));
    if (!valid) {
      return fail(
        `\`set.${path}\` must be a string, number, boolean or a non-empty array of those; use \`unset\` to remove it.`,
      );
    }
  }
  const unset = parsePaths(args.unset, 'unset', MAX_FIELDS);
  if (!unset.ok) return unset;

  const paths = [...Object.keys(set), ...(unset.value ?? [])];
  if (paths.length === 0) return fail('Nothing to update: pass `set`, `unset` or both.');
  const system = paths.find(isSystemField);
  if (system != null) {
    return fail(`\`${system}\` is a system property and cannot be changed through node_update.`);
  }
  const overlap = overlapping(paths);
  if (overlap != null) {
    return fail(`\`${overlap[0]}\` and \`${overlap[1]}\` overlap; change each property once.`);
  }

  return {
    ok: true,
    value: {
      ...target.value,
      key: key.value,
      set: set as Record<string, DataValue>,
      unset: unset.value ?? [],
      expectedVersionKey: expectedVersionKey.value,
    },
  };
}

//
// * Projection and Budgets
//

export function toNodeSummary(node: JsonObject): NodeSummary {
  const summary: JsonObject = {};
  for (const key of SUMMARY_KEYS) summary[key] = node[key];
  return summary as NodeSummary;
}

export function userData(node: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(node).filter(([key]) => !key.startsWith('_')));
}

function limited(path: string, value: unknown): unknown {
  const size = JSON.stringify(value).length;
  return size <= SUBTREE_BUDGET ? value : truncation(path, value, size, SUBTREE_BUDGET);
}

export function limitAggregations(aggregations: unknown): unknown {
  const size = JSON.stringify(aggregations ?? null).length;
  if (size <= SUBTREE_BUDGET) return aggregations ?? {};
  return {
    truncated: true,
    size,
    message: `The aggregation results are ${size} characters, over the ${SUBTREE_BUDGET}-character budget. Ask for fewer aggregations, smaller bucket sizes or wider intervals.`,
  } satisfies Truncated;
}

export function limitSubtree(node: JsonObject, name: NodeSubtree): unknown {
  const path = SUBTREE_PATHS[name];
  return limited(path, name === 'data' ? userData(node) : (node[path] ?? null));
}

//
// * Update Plan
//

// lib-node reads a one-element list back as a bare value.
function normalized(value: unknown): unknown {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
}

function holdsNestedData(value: unknown): boolean {
  const values = Array.isArray(value) ? value : [value];
  return values.some((item) => typeof item === 'object' && item != null);
}

// Copies only the objects along the path, so the editor never mutates XP's node in place.
function setIn(target: JsonObject, segments: string[], value: unknown): JsonObject {
  const [head, ...rest] = segments;
  if (rest.length === 0) return { ...target, [head]: value };
  const child = isObject(target[head]) ? target[head] : {};
  return { ...target, [head]: setIn(child, rest, value) };
}

function unsetIn(target: JsonObject, segments: string[]): JsonObject {
  const [head, ...rest] = segments;
  if (rest.length === 0) {
    const { [head]: _removed, ...kept } = target;
    return kept;
  }
  const child = target[head];
  return isObject(child) ? { ...target, [head]: unsetIn(child, rest) } : target;
}

function blockingParent(node: JsonObject, segments: string[]): string | undefined {
  let current: unknown = node;
  for (let i = 0; i < segments.length - 1; i++) {
    if (!Object.hasOwn(current as JsonObject, segments[i])) return undefined;
    current = (current as JsonObject)[segments[i]];
    if (!isObject(current)) return segments.slice(0, i + 1).join('.');
  }
  return undefined;
}

function readObjectPath(node: JsonObject, segments: string[]): unknown {
  let current: unknown = node;
  for (const segment of segments) {
    if (!isObject(current) || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

// The update editor gets typed properties (dates, references, geo points, …) as Java objects,
// where reads return their strings; plain values arrive as JS primitives either way.
function isTypedValue(value: unknown): boolean {
  return value != null && !isScalar(value) && !Array.isArray(value);
}

function holdsTypedValue(value: unknown): boolean {
  return Array.isArray(value) ? value.some(isTypedValue) : isTypedValue(value);
}

// Plans against a node as reads return it, so never re-plan in the editor: `apply` hands each
// set over a typed value to `retype` instead.
export function planUpdate(node: JsonObject, args: UpdateArgs): Parsed<UpdatePlan> {
  const changed: string[] = [];
  const previous: JsonObject = {};
  const sets: [string[], DataValue][] = [];
  const unsets: string[][] = [];

  for (const [path, value] of Object.entries(args.set)) {
    const segments = path.split('.');
    const blocker = blockingParent(node, segments);
    if (blocker != null) {
      return fail(`\`${path}\` cannot be set: \`${blocker}\` holds a value, not an object.`);
    }
    const current = readObjectPath(node, segments);
    if (holdsNestedData(current)) {
      return fail(
        `\`${path}\` holds nested data that a scalar would overwrite. Set its properties one by one, or unset it first.`,
      );
    }
    if (sameValue(current, value)) continue;
    changed.push(path);
    previous[path] = current === undefined ? null : limited(path, current);
    sets.push([segments, value]);
  }

  for (const path of args.unset) {
    const segments = path.split('.');
    const current = readObjectPath(node, segments);
    if (current === undefined) continue;
    changed.push(path);
    previous[path] = limited(path, current);
    unsets.push(segments);
  }

  return {
    ok: true,
    value: {
      changed,
      previous,
      apply: <T extends JsonObject>(target: T, retype: Retype): T => {
        let next: JsonObject = target;
        for (const [segments, value] of sets) {
          const stored = readObjectPath(next, segments);
          const written = holdsTypedValue(stored)
            ? retype(segments.join('.'), stored, value)
            : value;
          next = setIn(next, segments, written);
        }
        for (const segments of unsets) next = unsetIn(next, segments);
        return next as T;
      },
    },
  };
}
