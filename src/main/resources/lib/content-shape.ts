import type { Content, FormItem, QueryDsl } from '@enonic-types/core';

import {
  decodeCursor,
  isObject,
  isScalar,
  parseFields,
  queryFingerprint,
  RESULT_WINDOW,
  SUBTREE_BUDGET,
  type Page,
  type Parsed,
  type Scalar,
  type Truncated,
} from './shape';

// Pure shaping for the content tools: argument parsing, query building, summaries, content
// type forms and the update plan. Nothing here touches XP, so it runs under Vitest as-is.

export const DEFAULT_COUNT = 10;
export const MAX_COUNT = 50;
// Item sets and option sets nested deeper than this are listed without their contents.
export const MAX_FORM_DEPTH = 4;

const CONTENT_ROOT = '/content';
const SEARCH_FIELDS = ['displayName^5', '_name^3', '_allText'];

export const SUBTREES = ['data', 'x', 'page', 'attachments'] as const;
export type Subtree = (typeof SUBTREES)[number];

type JsonObject = Record<string, unknown>;

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

export type SearchArgs = Page & {
  text?: string;
  path?: string;
  contentType?: string;
  count: number;
};

export type GetArgs = { key: string; fields?: string[]; include: Subtree[] };

export type CreateArgs = {
  parentPath: string;
  contentType: string;
  displayName: string;
  name?: string;
  language?: string;
  data: JsonObject;
};

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

export function unknownKeys(args: JsonObject, allowed: readonly string[]): string | undefined {
  const extra = Object.keys(args).filter((key) => !allowed.includes(key));
  if (extra.length === 0) return undefined;
  return `Unknown argument(s): ${extra.join(', ')}. Allowed: ${allowed.join(', ')}.`;
}

export function optionalString(args: JsonObject, key: string): Parsed<string | undefined> {
  const value = args[key];
  if (value == null) return { ok: true, value: undefined };
  if (typeof value !== 'string') return fail(`\`${key}\` must be a string.`);
  const trimmed = value.trim();
  return { ok: true, value: trimmed === '' ? undefined : trimmed };
}

export function optionalInteger(args: JsonObject, key: string): Parsed<number | undefined> {
  const value = args[key];
  if (value == null) return { ok: true, value: undefined };
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return fail(`\`${key}\` must be an integer.`);
  }
  return { ok: true, value };
}

export function parseSearchArgs(args: JsonObject): Parsed<SearchArgs> {
  const unknown = unknownKeys(args, ['text', 'path', 'contentType', 'count', 'start', 'cursor']);
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
  const cursor = optionalString(args, 'cursor');
  if (!cursor.ok) return cursor;

  if (path.value != null && !path.value.startsWith('/')) {
    return fail('`path` must start with `/`, e.g. `/my-site/articles`.');
  }
  if (count.value != null && (count.value < 1 || count.value > MAX_COUNT)) {
    return fail(`\`count\` must be between 1 and ${MAX_COUNT}.`);
  }
  if (start.value != null && (start.value < 0 || start.value >= RESULT_WINDOW)) {
    return fail(`\`start\` must be between 0 and ${RESULT_WINDOW - 1}.`);
  }
  if (start.value != null && cursor.value != null) {
    return fail('Pass either `start` or `cursor`, not both.');
  }

  const normalizedPath = path.value == null ? undefined : normalizeKey(path.value);
  const fingerprint = queryFingerprint(['content', text.value, normalizedPath, contentType.value]);
  let offset = start.value ?? 0;
  if (cursor.value != null) {
    const decoded = decodeCursor(cursor.value, fingerprint);
    if (!decoded.ok) return decoded;
    offset = decoded.value;
  }

  return {
    ok: true,
    value: {
      text: text.value,
      path: normalizedPath,
      contentType: contentType.value,
      count: Math.min(count.value ?? DEFAULT_COUNT, RESULT_WINDOW - offset),
      start: offset,
      fingerprint,
    },
  };
}

export function parseGetArgs(args: JsonObject): Parsed<GetArgs> {
  const unknown = unknownKeys(args, ['key', 'fields', 'include']);
  if (unknown != null) return fail(unknown);

  const key = optionalString(args, 'key');
  if (!key.ok) return key;
  if (key.value == null) return fail('`key` is required: a content id or path.');
  const fields = parseFields(args);
  if (!fields.ok) return fields;

  const include = args.include ?? (fields.value == null ? ['data'] : []);
  if (!Array.isArray(include) || !include.every((item) => SUBTREES.includes(item as Subtree))) {
    return fail(`\`include\` must be an array of: ${SUBTREES.join(', ')}.`);
  }

  return {
    ok: true,
    value: { key: key.value, fields: fields.value, include: include as Subtree[] },
  };
}

function invalidData(value: unknown, path: string): string | undefined {
  if (isScalar(value)) return undefined;
  if (Array.isArray(value) || isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      const invalid = invalidData(item, `${path}.${key}`);
      if (invalid != null) return invalid;
    }
    return undefined;
  }
  return `\`${path}\` must be a string, number, boolean, object or array; leave a field out instead of setting it to null.`;
}

export function parseCreateArgs(args: JsonObject): Parsed<CreateArgs> {
  const unknown = unknownKeys(args, [
    'parentPath',
    'contentType',
    'displayName',
    'name',
    'language',
    'data',
  ]);
  if (unknown != null) return fail(unknown);

  const parentPath = optionalString(args, 'parentPath');
  if (!parentPath.ok) return parentPath;
  if (parentPath.value == null || !parentPath.value.startsWith('/')) {
    return fail('`parentPath` is required and must start with `/`, e.g. `/` or `/my-site`.');
  }
  const contentType = optionalString(args, 'contentType');
  if (!contentType.ok) return contentType;
  if (contentType.value == null) {
    return fail('`contentType` is required, e.g. `base:folder` or `my.app:article`.');
  }
  const displayName = optionalString(args, 'displayName');
  if (!displayName.ok) return displayName;
  if (displayName.value == null) return fail('`displayName` is required.');
  const name = optionalString(args, 'name');
  if (!name.ok) return name;
  if (name.value?.includes('/')) return fail('`name` must not contain `/`.');
  const language = optionalString(args, 'language');
  if (!language.ok) return language;

  const data = args.data === undefined ? {} : args.data;
  if (!isObject(data)) return fail('`data` must be an object of field names to values.');
  const invalid = invalidData(data, 'data');
  if (invalid != null) return fail(invalid);

  return {
    ok: true,
    value: {
      parentPath: normalizeKey(parentPath.value),
      contentType: contentType.value,
      displayName: displayName.value,
      name: name.value,
      language: language.value,
      data,
    },
  };
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

// What content_get adds to a summary; search hits stay without it.
export type Detail = {
  owner: string | null;
  createdTime: string | null;
  publishedTime: string | null;
};

export function toDetail(content: Content): Detail {
  return {
    owner: content.owner ?? null,
    createdTime: content.createdTime ?? null,
    publishedTime: content.publish?.first ?? null,
  };
}

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
// * Content Type Forms
//

export type Occurrences = { min: number; max: number };

export type FormField = {
  path: string;
  kind: 'input' | 'itemSet' | 'optionSet' | 'option';
  label: string;
  helpText?: string;
  inputType?: string;
  occurrences?: Occurrences;
  selection?: Occurrences;
  default?: true;
  config?: JsonObject;
  capped?: true;
};

export type FlatForm = { fields: FormField[]; capped: string[] };

type NamedFormItem = Exclude<FormItem, { formItemType: 'Layout' | 'FormFragment' }>;

const INPUT_KEYS = ['formItemType', 'name', 'label', 'helpText', 'inputType', 'occurrences'];

function occurrencesOf(value: { minimum: number; maximum: number }): Occurrences {
  return { min: value.minimum, max: value.maximum };
}

// Layouts (field sets) group inputs visually without adding a level to the data, and form
// fragments arrive already inlined.
function namedItems(items: FormItem[]): NamedFormItem[] {
  return items.flatMap((item) => {
    if (item.formItemType === 'Layout') return namedItems(item.items ?? []);
    if (item.formItemType === 'FormFragment') return [];
    return [item];
  });
}

// lib-content puts an input's type config (options, allowed content types, …) on the input itself.
function inputConfig(item: FormItem): JsonObject | undefined {
  const config = Object.fromEntries(
    Object.entries(item).filter(
      ([key, value]) =>
        !INPUT_KEYS.includes(key) &&
        value != null &&
        !(isObject(value) && Object.keys(value).length === 0),
    ),
  );
  return Object.keys(config).length === 0 ? undefined : config;
}

function withHelp(field: FormField, helpText: string | undefined): FormField {
  return helpText == null || helpText === '' ? field : { ...field, helpText };
}

// `max: 0` means unlimited, as in XP. Option set data is `{ _selected: [names], <name>: {…} }`,
// so an option's fields sit under the option's name.
export function flattenForm(items: FormItem[], maxDepth = MAX_FORM_DEPTH): FlatForm {
  const fields: FormField[] = [];
  const capped: string[] = [];

  const walk = (formItems: FormItem[], parent: string, depth: number): void => {
    for (const item of namedItems(formItems)) {
      const path = parent === '' ? item.name : `${parent}.${item.name}`;
      if (item.formItemType === 'Input') {
        const config = inputConfig(item);
        fields.push(
          withHelp(
            {
              path,
              kind: 'input',
              label: item.label,
              inputType: item.inputType,
              occurrences: occurrencesOf(item.occurrences),
              ...(config != null && { config }),
            },
            item.helpText,
          ),
        );
        continue;
      }

      const nested: [FormField, FormItem[]][] = [];
      if (item.formItemType === 'ItemSet') {
        nested.push([
          withHelp(
            {
              path,
              kind: 'itemSet',
              label: item.label,
              occurrences: occurrencesOf(item.occurrences),
            },
            item.helpText,
          ),
          item.items ?? [],
        ]);
      } else {
        fields.push(
          withHelp(
            {
              path,
              kind: 'optionSet',
              label: item.label,
              occurrences: occurrencesOf(item.occurrences),
              selection: occurrencesOf(item.selection),
            },
            item.helpText,
          ),
        );
        for (const option of item.options ?? []) {
          nested.push([
            withHelp(
              {
                path: `${path}.${option.name}`,
                kind: 'option',
                label: option.label,
                ...(option.default && { default: true as const }),
              },
              option.helpText,
            ),
            option.items ?? [],
          ]);
        }
      }

      for (const [field, children] of nested) {
        if (depth >= maxDepth && namedItems(children).length > 0) {
          fields.push({ ...field, capped: true });
          capped.push(field.path);
        } else {
          fields.push(field);
          walk(children, field.path, depth + 1);
        }
      }
    }
  };

  walk(items, '', 0);
  return { fields, capped };
}

function asList(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value.filter((item) => item != null) : [value];
}

function occurrenceProblem(path: string, count: number, occurrences: Occurrences): string[] {
  if (occurrences.min > 0 && count < occurrences.min) {
    return [`\`${path}\` needs at least ${occurrences.min} value(s), got ${count}.`];
  }
  if (occurrences.max > 0 && count > occurrences.max) {
    return [`\`${path}\` takes at most ${occurrences.max} value(s), got ${count}.`];
  }
  return [];
}

function selectionProblem(path: string, selected: number, selection: Occurrences): string[] {
  if (selected >= selection.min && (selection.max === 0 || selected <= selection.max)) return [];
  const range =
    selection.max === 0 ? `at least ${selection.min}` : `${selection.min} to ${selection.max}`;
  return [`\`${path}._selected\` must name ${range} option(s), got ${selected}.`];
}

// Mirrors XP's occurrence rules, so a create that XP would refuse without a message names the
// offending paths. XP still validates everything else on create.
export function checkOccurrences(items: FormItem[], data: JsonObject, parent = 'data'): string[] {
  const problems: string[] = [];
  for (const item of namedItems(items)) {
    const path = `${parent}.${item.name}`;
    const values = asList(data[item.name]);
    problems.push(...occurrenceProblem(path, values.length, occurrencesOf(item.occurrences)));
    if (item.formItemType === 'Input') continue;

    for (const [i, set] of values.entries()) {
      if (!isObject(set)) continue;
      const setPath = values.length > 1 ? `${path}.${i}` : path;
      if (item.formItemType === 'ItemSet') {
        problems.push(...checkOccurrences(item.items ?? [], set, setPath));
        continue;
      }
      const selected = asList(set._selected).filter((name) => typeof name === 'string');
      problems.push(...selectionProblem(setPath, selected.length, occurrencesOf(item.selection)));
      // XP stops at the first occurrence with nothing selected, and skips a selected option
      // that has no data object.
      if (selected.length === 0) break;
      for (const option of item.options ?? []) {
        const optionData = set[option.name];
        if (!selected.includes(option.name) || !isObject(optionData)) continue;
        problems.push(
          ...checkOccurrences(option.items ?? [], optionData, `${setPath}.${option.name}`),
        );
      }
    }
  }
  return problems;
}

// XP refuses an invalid create with only its first validation error, and occurrence errors
// carry no message at all.
export function createRefusal(contentType: string, message: string | undefined): string {
  const reason =
    message == null || message === '' || message === 'null'
      ? 'the data is not valid for the content type'
      : message;
  return (
    `XP refused to create the \`${contentType}\` item: ${reason}. ` +
    'Check field names, value types and required fields with content_type_get, then retry.'
  );
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
