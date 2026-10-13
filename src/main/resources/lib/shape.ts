// Pure shaping shared by the content and node tools: parse results, dot paths, cursors and
// field projection. Nothing here touches XP, so it runs under Vitest as-is.

// Per included subtree, in characters of compact JSON. Keeps a full read well under Claude
// Code's 10k-token warning.
export const SUBTREE_BUDGET = 6000;
export const MAX_FIELDS = 50;
// Elasticsearch's default `index.max_result_window`: XP refuses `start + count` beyond it.
export const RESULT_WINDOW = 10_000;

type JsonObject = Record<string, unknown>;

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

export type Scalar = string | number | boolean;

export type Truncated = { truncated: true; size: number; message: string };

export type Budget = { remaining: number };

export type Page = { start: number; fingerprint: string };

function fail<T>(message: string): Parsed<T> {
  return { ok: false, message };
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

export function isScalar(value: unknown): value is Scalar {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

//
// * Dot Paths
//

export function isDotPath(path: string): boolean {
  return path.split('.').every((segment) => segment !== '');
}

export function parsePaths(value: unknown, key: string, max: number): Parsed<string[] | undefined> {
  if (value == null) return { ok: true, value: undefined };
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return fail(`\`${key}\` must be an array of dot paths, e.g. ["title", "address.city"].`);
  }
  if (value.length > max) return fail(`\`${key}\` takes at most ${max} paths.`);
  const invalid = value.find((path) => !isDotPath(path));
  if (invalid != null) return fail(`\`${key}\` has an invalid dot path: \`${invalid}\`.`);
  return { ok: true, value: value.length === 0 ? undefined : value };
}

export function parseFields(args: JsonObject): Parsed<string[] | undefined> {
  return parsePaths(args.fields, 'fields', MAX_FIELDS);
}

export function readPath(node: unknown, path: string): unknown {
  let current = node;
  for (const segment of path.split('.')) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
    } else if (isObject(current) && Object.hasOwn(current, segment)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

//
// * Cursors
//

// Key order is normalized so a client that re-serializes the same query keeps its cursor.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    const keys = Object.keys(value).toSorted();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function fnv1a(text: string): string {
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function queryFingerprint(parts: unknown[]): string {
  return fnv1a(canonical(parts));
}

export function encodeCursor(start: number, fingerprint: string): string {
  return `${start.toString(36)}.${fingerprint}`;
}

export function decodeCursor(cursor: string, fingerprint: string): Parsed<number> {
  const match = /^([\da-z]+)\.([\da-f]{8})$/.exec(cursor);
  if (match == null) return fail('`cursor` is not a cursor this server issued.');
  if (match[2] !== fingerprint) {
    return fail(
      '`cursor` belongs to a different query. Repeat the query it came from unchanged, or drop the cursor to start over.',
    );
  }
  const start = Number.parseInt(match[1], 36);
  return start < RESULT_WINDOW ? { ok: true, value: start } : fail('`cursor` is out of range.');
}

export function nextCursor(
  { start, fingerprint }: Page,
  returned: number,
  total: number,
): string | undefined {
  const next = start + returned;
  return returned > 0 && next < total && next < RESULT_WINDOW
    ? encodeCursor(next, fingerprint)
    : undefined;
}

//
// * Projection
//

export function truncation(path: string, value: unknown, size: number, budget: number): Truncated {
  const children =
    typeof value === 'object' && value != null
      ? Object.keys(value)
          .slice(0, 10)
          .map((key) => `\`${path === '' ? key : `${path}.${key}`}\``)
      : [];
  const name = path === '' ? 'data' : path;
  const narrow =
    children.length > 0
      ? `Ask for part of it with \`fields\`, e.g. ${children.join(', ')}.`
      : 'It is a single value and cannot be narrowed.';
  return {
    truncated: true,
    size,
    message: `\`${name}\` is ${size} characters, over the ${budget} left in the ${SUBTREE_BUDGET}-per-subtree budget. ${narrow}`,
  };
}

export function projectFields(node: JsonObject, fields: string[], budget: Budget): JsonObject {
  // No prototype, so a requested `__proto__` path is stored as a field.
  const projected: JsonObject = Object.create(null);
  for (const path of fields) {
    const value = readPath(node, path);
    if (value === undefined || Object.hasOwn(projected, path)) continue;
    const size = JSON.stringify(value).length;
    if (size <= budget.remaining) {
      projected[path] = value;
      budget.remaining -= size;
    } else {
      projected[path] = truncation(path, value, size, budget.remaining);
    }
  }
  return projected;
}
