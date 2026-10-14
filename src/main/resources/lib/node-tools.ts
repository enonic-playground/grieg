import { run } from '/lib/xp/context';
import { connect, type Node, type RepoConnection, type UpdatedNode } from '/lib/xp/node';
import { list as listRepos } from '/lib/xp/repo';

import type { ToolsConfig } from './config';
import type { Tool, ToolOutcome } from './mcp';

import { auditWrite } from './audit';
import { MAX_COUNT } from './content-shape';
import {
  defaultBranch,
  limitAggregations,
  limitSubtree,
  MAX_BUCKETS,
  NODE_SUBTREES,
  PAGE_BUDGET,
  parseCreateArgs,
  parseGetArgs,
  parseQueryArgs,
  parseUpdateArgs,
  planUpdate,
  repoAccess,
  toNodeSummary,
  writeRefusal,
  type RepoRules,
  type Target,
} from './node-shape';
import { asConfiguredUser } from './run-as';
import { MAX_FIELDS, nextCursor, projectFields, SUBTREE_BUDGET, type Parsed } from './shape';

// lib-repo lists repositories only for administrators; what the user may read is probed after.
const ADMIN_PRINCIPAL = 'role:system.admin';

type JsonObject = Record<string, unknown>;

// The typed values node_update can rebuild from the string node_get shows for them.
const RETYPABLE = [
  {
    name: 'Instant',
    className: 'java.time.Instant',
    factory: 'parse',
    example: '2026-01-01T00:00:00Z',
  },
  {
    name: 'LocalDateTime',
    className: 'java.time.LocalDateTime',
    factory: 'parse',
    example: '2026-01-01T12:00:00',
  },
  { name: 'LocalDate', className: 'java.time.LocalDate', factory: 'parse', example: '2026-01-01' },
  { name: 'LocalTime', className: 'java.time.LocalTime', factory: 'parse', example: '12:00:00' },
  {
    name: 'GeoPoint',
    className: 'com.enonic.xp.util.GeoPoint',
    factory: 'from',
    example: '59.91,10.75',
  },
  {
    name: 'Reference',
    className: 'com.enonic.xp.util.Reference',
    factory: 'from',
    example: 'my-node-id',
  },
] as const;

function ok(value: JsonObject): ToolOutcome {
  return { ok: true, value };
}

function fail(message: string): ToolOutcome {
  return { ok: false, message };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function rulesOf(config: ToolsConfig): RepoRules {
  return { allowlist: config.nodeRepos, readOnly: config.readOnly };
}

function where({ repo, branch }: Target): string {
  return `\`${repo}\`, branch \`${branch}\``;
}

// A missing repository or branch surfaces as an XP exception, as does an invalid query.
function inRepo(
  config: ToolsConfig,
  target: Target,
  write: boolean,
  callback: (connection: RepoConnection) => ToolOutcome,
): ToolOutcome {
  const access = repoAccess(target.repo, rulesOf(config));
  if (!access.ok) return fail(access.message);
  if (write && access.value !== 'write') return fail(writeRefusal(target.repo));

  return asConfiguredUser(config, { repository: target.repo, branch: target.branch }, () => {
    try {
      return callback(connect({ repoId: target.repo, branch: target.branch }));
    } catch (e) {
      log.warning(`MCP node tool failed on ${target.repo}/${target.branch}: ${errorMessage(e)}`);
      return fail(
        `The request on ${where(target)} failed: ${errorMessage(e)}. ` +
          'Check the repository and branch with node_repos, and the arguments against the tool schema.',
      );
    }
  });
}

function toArray<T>(value: T | T[] | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function retype(path: string, stored: unknown, value: unknown): Parsed<unknown> {
  const type = Array.isArray(stored)
    ? undefined
    : RETYPABLE.find(({ className }) => stored instanceof Java.type(className));
  if (type == null) {
    return {
      ok: false,
      message: `\`${path}\` holds a value node_update cannot replace without changing its type, such as a link, a binary reference or several typed values.`,
    };
  }
  if (typeof value !== 'string') {
    return {
      ok: false,
      message: `\`${path}\` is stored as ${type.name}; set it to a string such as \`${type.example}\`.`,
    };
  }
  try {
    return { ok: true, value: Java.type(type.className)[type.factory](value) };
  } catch (e) {
    return {
      ok: false,
      message: `\`${path}\` is stored as ${type.name}, and \`${value}\` is not a valid one (e.g. \`${type.example}\`): ${errorMessage(e)}`,
    };
  }
}

// Content repositories keep project roles off the root node, so a root read would hide them;
// a query only counts the nodes the user may read.
function canRead(repoId: string, branch: string): boolean {
  try {
    return connect({ repoId, branch }).query({ count: 0 }).total > 0;
  } catch (e) {
    log.warning(`MCP node_repos could not probe ${repoId}/${branch}: ${errorMessage(e)}`);
    return false;
  }
}

//
// * Schemas
//

const NODE_SUMMARY_PROPERTIES = {
  _id: { type: 'string' },
  _name: { type: 'string' },
  _path: { type: 'string' },
  _nodeType: { type: 'string' },
  _ts: { type: 'string', description: 'Last modification time' },
  _versionKey: { type: 'string', description: 'Pass as expectedVersionKey to node_update' },
};

const NODE_SUMMARY_SCHEMA = {
  type: 'object',
  properties: NODE_SUMMARY_PROPERTIES,
  required: Object.keys(NODE_SUMMARY_PROPERTIES),
};

const REPO_SCHEMA = { type: 'string', description: 'Repository id, from node_repos' };

const BRANCH_SCHEMA = {
  type: 'string',
  description: 'Branch; defaults to draft for com.enonic.cms.* repositories, master otherwise',
};

const KEY_SCHEMA = { type: 'string', description: 'Node id, or path such as /workflows/my-node' };

const FIELDS_SCHEMA = {
  type: 'array',
  items: { type: 'string' },
  maxItems: MAX_FIELDS,
  description: 'Dot paths to return, e.g. ["title", "address.city", "tags.0"]',
};

const DSL_SCHEMA = { type: 'object' };

const SCALAR_SCHEMA = { type: ['string', 'number', 'boolean'] };

const READ_ANNOTATIONS = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

//
// * Tools
//

export function nodeInstructions(config: ToolsConfig): string {
  const lines = [
    'Node tools reach XP repositories directly: node_repos lists the ones you can use, node_query searches one (a lib-node query DSL object or NoQL string; `fields` projects dot paths, `nextCursor` pages), node_get reads one node by id or path.',
  ];
  if (!config.readOnly) {
    const contentWrites = config.toolsets.includes('content')
      ? 'so change content with content_update'
      : 'and content writes need the `content` toolset';
    lines.push(
      `node_create and node_update write to non-content repositories only; com.enonic.cms.* repositories are read-only here, ${contentWrites}. Pass \`_versionKey\` from your last read as \`expectedVersionKey\` to avoid overwriting someone else.`,
    );
  }
  lines.push('System repositories (system-repo, system.*) are never available.');
  return lines.join('\n');
}

export function createNodeTools(config: ToolsConfig): Tool[] {
  const repos: Tool = {
    name: 'node_repos',
    title: 'List repositories',
    description:
      'List the XP repositories and branches you can read, with `access` saying whether the node tools may write to them. ' +
      'Start here before node_query or node_get.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: {
      type: 'object',
      properties: {
        repos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              branches: { type: 'array', items: { type: 'string' } },
              defaultBranch: { type: 'string' },
              access: { type: 'string', enum: ['read', 'write'] },
            },
            required: ['id', 'branches', 'defaultBranch', 'access'],
          },
        },
      },
      required: ['repos'],
    },
    annotations: READ_ANNOTATIONS,
    handler: () => {
      const rules = rulesOf(config);
      const all = run({ principals: [ADMIN_PRINCIPAL] }, () => listRepos());
      const candidates = all.filter((repo) => repoAccess(repo.id, rules).ok);

      return asConfiguredUser(config, undefined, () => {
        const visible = candidates.flatMap((repo) => {
          const branches = repo.branches.filter((branch) => canRead(repo.id, branch));
          if (branches.length === 0) return [];
          const access = repoAccess(repo.id, rules);
          return [
            {
              id: repo.id,
              branches,
              defaultBranch: defaultBranch(repo.id),
              access: access.ok ? access.value : 'read',
            },
          ];
        });
        return ok({ repos: visible });
      });
    },
  };

  const query: Tool = {
    name: 'node_query',
    title: 'Query nodes',
    description:
      'Search the nodes of one repository with a lib-node `query` (a DSL object, or a NoQL string such as "_parentPath = \'/workflows\'"), plus optional `filters`, `sort` and `aggregations`. ' +
      `Hits carry _id, _name, _path, _nodeType, _ts and _versionKey; pass \`fields\` to add values by dot path. ` +
      `Pass \`nextCursor\` back as \`cursor\` with the same query for the next page. Aggregation bucket sizes are capped at ${MAX_BUCKETS}, and projected values share a ${PAGE_BUDGET}-character budget per page.`,
    inputSchema: {
      type: 'object',
      properties: {
        repo: REPO_SCHEMA,
        branch: BRANCH_SCHEMA,
        query: { anyOf: [{ type: 'string' }, DSL_SCHEMA], description: 'Query DSL or NoQL' },
        filters: { anyOf: [DSL_SCHEMA, { type: 'array', items: DSL_SCHEMA }] },
        sort: {
          anyOf: [{ type: 'string' }, DSL_SCHEMA, { type: 'array', items: DSL_SCHEMA }],
          description: 'e.g. "_ts DESC"',
        },
        fields: FIELDS_SCHEMA,
        count: { type: 'integer', minimum: 1, maximum: MAX_COUNT, default: 10 },
        cursor: { type: 'string', description: 'nextCursor from the previous page' },
        aggregations: DSL_SCHEMA,
      },
      required: ['repo'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        total: { type: 'integer' },
        count: { type: 'integer' },
        hits: {
          type: 'array',
          items: {
            type: 'object',
            properties: { ...NODE_SUMMARY_PROPERTIES, fields: { type: 'object' } },
            required: Object.keys(NODE_SUMMARY_PROPERTIES),
          },
        },
        nextCursor: { type: 'string' },
        aggregations: {},
      },
      required: ['total', 'count', 'hits'],
    },
    annotations: READ_ANNOTATIONS,
    handler: (args) => {
      const parsed = parseQueryArgs(args);
      if (!parsed.ok) return fail(parsed.message);
      const { query: dsl, filters, sort, aggregations, fields, start, count } = parsed.value;

      return inRepo(config, parsed.value, false, (connection) => {
        const result = connection.query({
          query: dsl,
          filters,
          sort,
          aggregations,
          start,
          count,
        } as Parameters<RepoConnection['query']>[0]);
        const ids = result.hits.map((hit) => hit.id);
        const byId = new Map(
          toArray(ids.length === 0 ? null : connection.get<JsonObject>(ids)).map((node) => [
            node._id,
            node,
          ]),
        );
        const budget = { remaining: PAGE_BUDGET };
        const hits = ids.flatMap((id) => {
          const node = byId.get(id);
          if (node == null) return [];
          const summary = toNodeSummary(node);
          return [
            fields == null ? summary : { ...summary, fields: projectFields(node, fields, budget) },
          ];
        });

        const cursor = nextCursor(parsed.value, result.hits.length, result.total);
        return ok({
          total: result.total,
          count: hits.length,
          hits,
          ...(cursor != null && { nextCursor: cursor }),
          ...(aggregations != null && { aggregations: limitAggregations(result.aggregations) }),
        });
      });
    },
  };

  const get: Tool = {
    name: 'node_get',
    title: 'Read node',
    description:
      'Read one node by id or path. Returns its _id, _name, _path, _nodeType, _ts and _versionKey, plus the subtrees named in `include` ' +
      `(default: data, its non-system properties) or the dot paths in \`fields\`. A subtree over ${SUBTREE_BUDGET} characters is replaced by a truncation marker that says how to narrow the request.`,
    inputSchema: {
      type: 'object',
      properties: {
        repo: REPO_SCHEMA,
        branch: BRANCH_SCHEMA,
        key: KEY_SCHEMA,
        fields: FIELDS_SCHEMA,
        include: {
          type: 'array',
          items: { type: 'string', enum: [...NODE_SUBTREES] },
          description: 'Subtrees to return; defaults to data unless `fields` is given',
        },
      },
      required: ['repo', 'key'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        ...NODE_SUMMARY_PROPERTIES,
        data: {},
        permissions: {},
        indexConfig: {},
        fields: { type: 'object' },
      },
      required: Object.keys(NODE_SUMMARY_PROPERTIES),
    },
    annotations: READ_ANNOTATIONS,
    handler: (args) => {
      const parsed = parseGetArgs(args);
      if (!parsed.ok) return fail(parsed.message);
      const { key, fields, include } = parsed.value;

      return inRepo(config, parsed.value, false, (connection) => {
        const node = connection.get<JsonObject>(key);
        if (node == null) {
          return fail(
            `No node at \`${key}\` in ${where(parsed.value)}. Use node_query to find it.`,
          );
        }
        const value: JsonObject = { ...toNodeSummary(node) };
        for (const name of include) value[name] = limitSubtree(node, name);
        if (fields != null) {
          value.fields = projectFields(node, fields, { remaining: SUBTREE_BUDGET });
        }
        return ok(value);
      });
    },
  };

  const create: Tool = {
    name: 'node_create',
    title: 'Create node',
    description:
      'Create one node under `parentPath` in a non-content repository. `data` holds its properties: strings, numbers, booleans, objects and arrays, no null. Of the `_`-prefixed system properties only _nodeType, _childOrder and _indexConfig are accepted. ' +
      'Permissions are inherited from the parent and cannot be set.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: REPO_SCHEMA,
        branch: BRANCH_SCHEMA,
        parentPath: { type: 'string', description: 'Parent node path, e.g. / or /workflows' },
        name: { type: 'string', description: 'Node name, unique among its siblings' },
        data: { type: 'object', description: 'Node properties' },
      },
      required: ['repo', 'parentPath', 'name'],
      additionalProperties: false,
    },
    outputSchema: NODE_SUMMARY_SCHEMA,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: (args) => {
      const parsed = parseCreateArgs(args);
      if (!parsed.ok) return fail(parsed.message);
      const { parentPath, name, data } = parsed.value;

      return inRepo(config, parsed.value, true, (connection) => {
        // Without the flag, lib-node grants admins everything and everyone READ.
        const created = connection.create<JsonObject>({
          ...data,
          _parentPath: parentPath,
          _name: name,
          _inheritsPermissions: true,
        });
        auditWrite(
          config,
          'node_create',
          { repository: parsed.value.repo, branch: parsed.value.branch, id: created._id },
          ['_name', ...Object.keys(data)],
        );
        return ok(toNodeSummary(created));
      });
    },
  };

  const update: Tool = {
    name: 'node_update',
    title: 'Update node',
    description:
      'Change properties of one node in a non-content repository. `set` maps dot paths to a string, number, boolean or array of those, creating missing parent objects; `unset` lists dot paths to remove. ' +
      'System properties (`_id`, `_name`, `_path`, `_permissions`, `_childOrder`, …) cannot be changed. ' +
      'A path holding a date, time, geo point or reference keeps its type: set it to a string in the form node_get shows. Other typed values (links, binary references, several typed values in one property) are refused, and a refused path fails the whole update. Xml properties read as plain strings, so a set on one stores a String. ' +
      'Pass `expectedVersionKey` (`_versionKey` from your last read) to refuse the write if the node changed since; lib-node has no lock, so a write landing during the update itself still wins.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: REPO_SCHEMA,
        branch: BRANCH_SCHEMA,
        key: KEY_SCHEMA,
        set: {
          type: 'object',
          description: 'Dot paths to values',
          additionalProperties: {
            anyOf: [SCALAR_SCHEMA, { type: 'array', items: SCALAR_SCHEMA }],
          },
        },
        unset: { type: 'array', items: { type: 'string' }, description: 'Dot paths to remove' },
        expectedVersionKey: {
          type: 'string',
          description: '_versionKey from your last read; the update is refused if it differs',
        },
      },
      required: ['repo', 'key'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        node: NODE_SUMMARY_SCHEMA,
        changed: { type: 'array', items: { type: 'string' } },
        previous: { type: 'object', description: 'Previous value of each changed path' },
      },
      required: ['node', 'changed', 'previous'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: (args) => {
      const parsed = parseUpdateArgs(args);
      if (!parsed.ok) return fail(parsed.message);
      const { key, expectedVersionKey } = parsed.value;

      return inRepo(config, parsed.value, true, (connection) => {
        const node = connection.get<JsonObject>(key);
        if (node == null) {
          return fail(
            `No node at \`${key}\` in ${where(parsed.value)}. Use node_query to find it.`,
          );
        }

        const conflict = (versionKey: string) =>
          fail(
            `Conflict: \`${node._path}\` is at version ${versionKey}, not the expected ${expectedVersionKey}. ` +
              'Read it again with node_get, re-apply the change, and retry.',
          );
        if (expectedVersionKey != null && node._versionKey !== expectedVersionKey) {
          return conflict(node._versionKey);
        }

        const initial = planUpdate(node, parsed.value);
        if (!initial.ok) return fail(initial.message);
        if (initial.value.changed.length === 0) {
          return ok({ node: toNodeSummary(node), changed: [], previous: {} });
        }

        // lib-node has no lock, so the editor re-checks the version to narrow the race.
        const plan = initial.value;
        let raced: string | undefined;
        let refused: string | undefined;
        let updated: Node<JsonObject>;
        try {
          updated = connection.update<JsonObject>({
            key: node._id,
            editor: (current) => {
              if (expectedVersionKey != null && current._versionKey !== expectedVersionKey) {
                raced = current._versionKey;
                throw new Error('modified concurrently');
              }
              return plan.apply(current, (path, stored, value) => {
                const retyped = retype(path, stored, value);
                if (retyped.ok) return retyped.value;
                refused = retyped.message;
                throw new Error('typed value refused');
              }) as unknown as UpdatedNode<JsonObject>;
            },
          });
        } catch (e) {
          if (raced != null) return conflict(raced);
          if (refused != null) return fail(`${refused} Nothing was written.`);
          throw e;
        }

        auditWrite(
          config,
          'node_update',
          { repository: parsed.value.repo, branch: parsed.value.branch, id: updated._id },
          plan.changed,
        );
        return ok({ node: toNodeSummary(updated), changed: plan.changed, previous: plan.previous });
      });
    },
  };

  return [repos, query, get, create, update];
}
