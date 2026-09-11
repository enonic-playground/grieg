import * as contentLib from '/lib/xp/content';
import { run } from '/lib/xp/context';

import type { Tool } from './mcp';

import { getMcpConfig } from './config';

const CONTENT_REPO_PREFIX = 'com.enonic.cms.';
const DEFAULT_COUNT = 20;
const MAX_COUNT = 100;

function inProject<T>(callback: () => T): T {
  const { project, branch, principal } = getMcpConfig();
  return run(
    {
      repository: `${CONTENT_REPO_PREFIX}${project}`,
      branch,
      principals: [principal],
    },
    callback,
  );
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function requireArg(args: Record<string, unknown>, key: string): string {
  const value = str(args, key);
  if (value == null) throw new Error(`Missing required argument: ${key}`);
  return value;
}

function count(args: Record<string, unknown>): number {
  const value = args.count;
  if (typeof value !== 'number') return DEFAULT_COUNT;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_COUNT);
}

export const CONTENT_TOOLS: Tool[] = [
  {
    name: 'content_get',
    description: 'Fetch a single content item by path or id.',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string', description: 'Content path or id' } },
      required: ['key'],
    },
    handler: (args) => inProject(() => contentLib.get({ key: requireArg(args, 'key') })),
  },
  {
    name: 'content_query',
    description: 'Search content with a query expression, optionally filtered by content type.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Query expression, e.g. _path LIKE "/content/*"' },
        contentType: { type: 'string' },
        count: { type: 'number', description: `1-${MAX_COUNT}, default ${DEFAULT_COUNT}` },
      },
    },
    handler: (args) =>
      inProject(() => {
        const contentType = str(args, 'contentType');
        return contentLib.query({
          query: str(args, 'query'),
          count: count(args),
          contentTypes: contentType == null ? undefined : [contentType],
        });
      }),
  },
  {
    name: 'content_create',
    description: 'Create a content item under a parent path.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        parentPath: { type: 'string' },
        displayName: { type: 'string' },
        contentType: { type: 'string' },
        data: { type: 'object' },
      },
      required: ['name', 'parentPath', 'contentType'],
    },
    handler: (args) =>
      inProject(() =>
        contentLib.create({
          name: requireArg(args, 'name'),
          parentPath: requireArg(args, 'parentPath'),
          displayName: str(args, 'displayName'),
          contentType: requireArg(args, 'contentType'),
          data: (args.data ?? {}) as Record<string, unknown>,
        }),
      ),
  },
  {
    name: 'content_modify',
    description: 'Replace the data of an existing content item.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        displayName: { type: 'string' },
        data: { type: 'object' },
      },
      required: ['key'],
    },
    handler: (args) =>
      inProject(() =>
        contentLib.modify({
          key: requireArg(args, 'key'),
          editor: (content) => ({
            ...content,
            displayName: str(args, 'displayName') ?? content.displayName,
            data: (args.data ?? content.data) as typeof content.data,
          }),
        }),
      ),
  },
  {
    name: 'content_delete',
    description: 'Delete a content item by path or id.',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string' } },
      required: ['key'],
    },
    handler: (args) =>
      inProject(() => ({ deleted: contentLib.delete({ key: requireArg(args, 'key') }) })),
  },
];
