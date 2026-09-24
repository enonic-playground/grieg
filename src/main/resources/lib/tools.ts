import * as contentLib from '/lib/xp/content';
import { get as getContext, run } from '/lib/xp/context';

import type { McpConfig } from './config';
import type { Tool, ToolOutcome } from './mcp';
import type { Content } from '@enonic-types/core';

import {
  buildSearchQuery,
  MAX_COUNT,
  parseGetArgs,
  parseSearchArgs,
  parseUpdateArgs,
  pickSubtrees,
  planUpdate,
  SUBTREE_BUDGET,
  SUBTREES,
  normalizeKey,
  toNodePath,
  toSummary,
  type Summary,
} from './content-shape';

const CONTENT_REPO_PREFIX = 'com.enonic.cms.';

type JsonObject = Record<string, unknown>;

function ok(value: JsonObject): ToolOutcome {
  return { ok: true, value };
}

function fail(message: string): ToolOutcome {
  return { ok: false, message };
}

function userKey(config: McpConfig): string {
  return `user:${config.idProvider}:${config.user}`;
}

// No `principals` override: the configured user's own permissions apply, and XP records
// that user as the modifier.
function asConfiguredUser(config: McpConfig, callback: () => ToolOutcome): ToolOutcome {
  return run(
    {
      repository: `${CONTENT_REPO_PREFIX}${config.project}`,
      branch: config.branch,
      user: { login: config.user, idProvider: config.idProvider },
    },
    () => {
      // XP falls back to anonymous without an error when the login is missing or disabled.
      const user = getContext().authInfo?.user;
      if (user?.login !== config.user || user.idProvider !== config.idProvider) {
        log.warning(`MCP tools could not run as ${userKey(config)}: user is missing or disabled`);
        return fail(
          `The server could not act as ${userKey(config)}: the user is missing or disabled. ` +
            'An administrator must fix `mcp.user` / `mcp.idProvider` in the app config.',
        );
      }
      return callback();
    },
  );
}

type ParentBuckets = { parents?: { buckets?: { key: string }[] } };

function parentPaths(paths: string[]): Set<string> | undefined {
  try {
    const result = contentLib.query({
      count: 0,
      query: { in: { field: '_parentPath', values: paths } },
      aggregations: { parents: { terms: { field: '_parentPath', size: paths.length } } },
    });
    const buckets = (result.aggregations as ParentBuckets | undefined)?.parents?.buckets ?? [];
    return new Set(buckets.map((bucket) => bucket.key.toLowerCase()));
  } catch (e) {
    log.warning(`MCP tools could not derive hasChildren: ${String(e)}`);
    return undefined;
  }
}

// XP 8 returns `hasChildren` as null, so it is derived with one aggregation over the items.
// A failed aggregation leaves it null rather than failing a call whose write already landed.
function summarize(contents: Content[], editBase: string): Summary[] {
  if (contents.length === 0) return [];
  const paths = contents.map((content) => toNodePath(content._path));
  const parents = parentPaths(paths);
  return contents.map((content, i) =>
    toSummary(content, editBase, parents?.has(paths[i].toLowerCase()) ?? null),
  );
}

function getContent(key: string): Content | null {
  const normalized = normalizeKey(key);
  return (
    contentLib.get({ key }) ?? (normalized === key ? null : contentLib.get({ key: normalized }))
  );
}

//
// * Schemas
//

const NULLABLE_STRING = { type: ['string', 'null'] };

const SUMMARY_PROPERTIES = {
  id: { type: 'string' },
  name: { type: 'string' },
  path: { type: 'string', description: 'Content path, without the /content prefix' },
  displayName: { type: 'string' },
  type: { type: 'string', description: 'Content type, e.g. base:folder' },
  language: NULLABLE_STRING,
  modifiedTime: NULLABLE_STRING,
  modifier: { ...NULLABLE_STRING, description: 'User key of the last modifier' },
  workflowState: NULLABLE_STRING,
  valid: { type: 'boolean' },
  hasChildren: { type: ['boolean', 'null'] },
  editUrl: { type: 'string', description: 'Content Studio link to the item' },
};

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: SUMMARY_PROPERTIES,
  required: Object.keys(SUMMARY_PROPERTIES),
};

const KEY_SCHEMA = {
  type: 'string',
  description: 'Content id, or path such as /my-site/about (the /content prefix is optional)',
};

const SCALAR_SCHEMA = { type: ['string', 'number', 'boolean'] };

//
// * Tools
//

function draftNote(config: McpConfig): string {
  return config.branch === 'draft'
    ? 'Writes go to the draft branch: they are not live until published in Content Studio, and every update resets the workflow state to in-progress.'
    : `Writes go straight to the \`${config.branch}\` branch.`;
}

export function serverInstructions(config: McpConfig): string {
  return [
    `Content tools for Enonic XP project \`${config.project}\`, branch \`${config.branch}\`, acting as ${userKey(config)}.`,
    'Find items with content_search (by `text`, or by `path` to list children), read one with content_get, change one with content_update.',
    'Paths look like /my-site/articles/item; the /content prefix is optional, and ids work wherever a key is accepted.',
    'content_update changes displayName, language and top-level scalar data fields only. Pass `expectedModifiedTime` from your last read to avoid overwriting someone else.',
    draftNote(config),
    'Every summary has an `editUrl` to Content Studio; give it to the user when they need to review or publish.',
  ].join('\n');
}

export function createContentTools(config: McpConfig, editBase: string): Tool[] {
  const where = `project \`${config.project}\`, branch \`${config.branch}\``;
  const notFound = (key: string) =>
    fail(`No content at \`${key}\` in ${where}. Use content_search to find it.`);

  const search: Tool = {
    name: 'content_search',
    title: 'Search content',
    description:
      `Find content items in ${where}. Pass \`text\` for a relevance-ranked search on display name, name and all text; ` +
      'pass only `path` to list the direct children of that path (`/` for the top level); combine both to search inside a subtree. ' +
      'Returns summaries, not field values: use content_get for those.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Words to search for' },
        path: { type: 'string', description: 'Parent path, e.g. / or /my-site' },
        contentType: { type: 'string', description: 'Only this content type, e.g. base:folder' },
        count: { type: 'integer', minimum: 1, maximum: MAX_COUNT, default: 10 },
        start: { type: 'integer', minimum: 0, default: 0, description: 'Offset for paging' },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        total: { type: 'integer' },
        start: { type: 'integer' },
        count: { type: 'integer' },
        hits: { type: 'array', items: SUMMARY_SCHEMA },
      },
      required: ['total', 'start', 'count', 'hits'],
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: (args) => {
      const parsed = parseSearchArgs(args);
      if (!parsed.ok) return fail(parsed.message);
      const { start, count, contentType } = parsed.value;

      return asConfiguredUser(config, () => {
        const { query, sort } = buildSearchQuery(parsed.value);
        const result = contentLib.query({
          query,
          sort,
          start,
          count,
          contentTypes: contentType == null ? undefined : [contentType],
        });
        return ok({
          total: result.total,
          start,
          count: result.count,
          hits: summarize(result.hits, editBase),
        });
      });
    },
  };

  const get: Tool = {
    name: 'content_get',
    title: 'Read content',
    description:
      `Read one content item in ${where} by id or path. Returns its summary plus the subtrees named in \`include\` ` +
      `(default: data). A subtree over ${SUBTREE_BUDGET} characters is replaced by a truncation marker.`,
    inputSchema: {
      type: 'object',
      properties: {
        key: KEY_SCHEMA,
        include: {
          type: 'array',
          items: { type: 'string', enum: [...SUBTREES] },
          default: ['data'],
          description: 'Subtrees to return',
        },
      },
      required: ['key'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        ...SUMMARY_PROPERTIES,
        data: {},
        x: {},
        page: {},
        attachments: {},
      },
      required: Object.keys(SUMMARY_PROPERTIES),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: (args) => {
      const parsed = parseGetArgs(args);
      if (!parsed.ok) return fail(parsed.message);
      const { key, include } = parsed.value;

      return asConfiguredUser(config, () => {
        const content = getContent(key);
        if (content == null) {
          return notFound(key);
        }
        return ok({ ...summarize([content], editBase)[0], ...pickSubtrees(content, include) });
      });
    },
  };

  const update: Tool = {
    name: 'content_update',
    title: 'Update content',
    description:
      `Change the display name, language or top-level data fields of one content item in ${where}. ` +
      `\`data\` sets only the fields it lists, each to a string, number, boolean or array of those; other fields stay untouched, and nested item sets cannot be edited. ` +
      `Pass \`expectedModifiedTime\` from your last read to refuse the write if someone changed the item since. ${draftNote(config)}`,
    inputSchema: {
      type: 'object',
      properties: {
        key: KEY_SCHEMA,
        displayName: { type: 'string' },
        language: { type: 'string', description: 'Locale code, e.g. en or nb-NO' },
        data: {
          type: 'object',
          description: 'Top-level data fields to set',
          additionalProperties: {
            anyOf: [SCALAR_SCHEMA, { type: 'array', items: SCALAR_SCHEMA }],
          },
        },
        expectedModifiedTime: {
          type: 'string',
          description: 'modifiedTime from your last read; the update is refused if it differs',
        },
      },
      required: ['key'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        summary: SUMMARY_SCHEMA,
        changed: { type: 'array', items: { type: 'string' } },
        previous: { type: 'object', description: 'Previous value of each changed field' },
      },
      required: ['summary', 'changed', 'previous'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: (args) => {
      const parsed = parseUpdateArgs(args);
      if (!parsed.ok) return fail(parsed.message);
      const { key, expectedModifiedTime } = parsed.value;

      return asConfiguredUser(config, () => {
        const content = getContent(key);
        if (content == null) {
          return notFound(key);
        }

        const conflict = (modifiedTime: string | undefined) =>
          fail(
            `Conflict: \`${content._path}\` was modified at ${modifiedTime ?? 'an unknown time'}, ` +
              `not at the expected ${expectedModifiedTime}. Read it again with content_get, re-apply the change, and retry.`,
          );
        if (expectedModifiedTime != null && content.modifiedTime !== expectedModifiedTime) {
          return conflict(content.modifiedTime);
        }

        const initial = planUpdate(content, parsed.value);
        if (!initial.ok) return fail(initial.message);
        if (initial.value.changed.length === 0) {
          return ok({ summary: summarize([content], editBase)[0], changed: [], previous: {} });
        }

        // The pre-check above gives a clear message; this one closes the race against a
        // write that lands between the read and the update.
        let raced: string | undefined;
        let refused: string | undefined;
        let plan = initial.value;
        let updated: ReturnType<typeof contentLib.update>;
        try {
          updated = contentLib.update({
            key: content._id,
            requireValid: plan.requireValid,
            editor: (current) => {
              if (expectedModifiedTime != null && current.modifiedTime !== expectedModifiedTime) {
                raced = current.modifiedTime ?? 'an unknown time';
                throw new Error('modified concurrently');
              }
              const replanned = planUpdate(current, parsed.value);
              if (!replanned.ok) {
                refused = replanned.message;
                throw new Error(refused);
              }
              plan = replanned.value;
              return plan.apply(current);
            },
          });
        } catch (e) {
          if (raced != null) return conflict(raced);
          if (refused != null) return fail(refused);
          const message = e instanceof Error ? e.message : String(e);
          return fail(
            `XP rejected the update of \`${content._path}\`: ${message}. ` +
              'Check field names and value types against the current data (content_get).',
          );
        }

        if (updated == null) {
          return notFound(key);
        }
        return ok({
          summary: summarize([updated], editBase)[0],
          changed: plan.changed,
          previous: plan.previous,
        });
      });
    },
  };

  return [search, get, update];
}
