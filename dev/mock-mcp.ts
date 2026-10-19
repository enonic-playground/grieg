import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite-plus';

import { stampView, type CardView } from '../src/main/resources/lib/cards.ts';
import { scheduleName } from '../src/main/resources/lib/schedule.ts';
import { advance, cronJobs, runs, workflows, type MockRun } from './mock-api.ts';
import { getContent, getContentType, searchContent } from './mock-content.ts';

// The read tools a card calls, answered from the mock API's in-memory state in the shapes
// lib/workflow-tools.ts, lib/node-tools.ts and lib/tools.ts return. Writes are left to Claude,
// as in a host. With GRIEG_MCP_TOKEN set, every call goes to a running XP instead (GRIEG_XP_URL,
// default http://localhost:8080), so a card renders live data; the token stays in this process.

const CARD_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../build/resources/main/ui/card.html',
);
const CARD_PREFIX = '/dev-card/';
const MCP_PATH = '/dev-mcp';
const ADMIN_TOOL = 'http://localhost:8080/admin/tool/com.enonic.app.grieg/main';
const CARD_VIEWS: CardView[] = ['workflows', 'runs', 'crons', 'nodes', 'content'];
const LIVE_TOKEN = process.env.GRIEG_MCP_TOKEN;
const LIVE_ENDPOINT = `${process.env.GRIEG_XP_URL ?? 'http://localhost:8080'}/api/com.enonic.app.grieg:mcp`;

type Json = Record<string, unknown>;

type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Json;
  isError: boolean;
};

function ok(value: Json): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value,
    isError: false,
  };
}

function fail(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

const adminUrl = (workflowId: string) => `${ADMIN_TOOL}/workflows/${workflowId}`;

function runsOf(workflowId: string): MockRun[] {
  const list = runs.get(workflowId) ?? [];
  list.forEach(advance);
  return list;
}

function summary(run: MockRun): Json {
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    user: run.user,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? null,
    error: run.error ?? null,
  };
}

type MockNode = { _name: string; _path: string; _nodeType: string; _ts: string; data: Json };

const NODES: MockNode[] = [
  { _name: '', _path: '/', _nodeType: 'default', _ts: '2026-08-01T10:00:00Z', data: {} },
  {
    _name: 'products',
    _path: '/products',
    _nodeType: 'default',
    _ts: '2026-09-02T08:30:00Z',
    data: { title: 'Products' },
  },
  {
    _name: 'espresso-machine',
    _path: '/products/espresso-machine',
    _nodeType: 'product',
    _ts: '2026-09-12T14:05:00Z',
    data: {
      title: 'Espresso machine',
      price: 649,
      inStock: true,
      tags: ['coffee', 'kitchen'],
      dimensions: { width: 28, height: 36, depth: 41, unit: 'cm' },
      variants: [
        { sku: 'EM-1-BLK', color: 'black' },
        { sku: 'EM-1-STL', color: 'steel' },
      ],
    },
  },
  {
    _name: 'grinder',
    _path: '/products/grinder',
    _nodeType: 'product',
    _ts: '2026-09-10T09:12:00Z',
    data: { title: 'Burr grinder', price: 189, inStock: false, tags: ['coffee'] },
  },
  {
    _name: 'settings',
    _path: '/settings',
    _nodeType: 'default',
    _ts: '2026-07-20T16:45:00Z',
    data: { currency: 'EUR', locale: 'nb-NO' },
  },
];

function nodeSummary(node: MockNode): Json {
  const id = `node-${node._name || 'root'}`;
  const { data: _data, ...rest } = node;
  return { _id: id, ...rest, _versionKey: `${id}-v1` };
}

function findNode(key: unknown): MockNode | undefined {
  return NODES.find((node) => key === node._path || key === nodeSummary(node)._id);
}

function parentOf(nodePath: string): string {
  return nodePath === '/' ? '' : path.posix.dirname(nodePath);
}

const READ_TOOLS: Record<string, (args: Json) => ToolResult> = {
  workflow_list: () =>
    ok({
      workflows: workflows.map((workflow) => {
        const job = cronJobs.find((candidate) => candidate.name === scheduleName(workflow.id));
        const last = runsOf(workflow.id)[0];
        return {
          id: workflow.id,
          name: workflow.name,
          displayName: workflow.displayName,
          description: workflow.description ?? null,
          stepCount: workflow.steps.length,
          schedule:
            job == null
              ? null
              : {
                  name: job.name,
                  cron: job.cron,
                  timeZone: job.timeZone,
                  enabled: job.enabled,
                  user: job.user ?? null,
                },
          lastRun:
            last == null
              ? null
              : {
                  id: last.id,
                  status: last.status,
                  trigger: last.trigger,
                  startedAt: last.startedAt,
                  finishedAt: last.finishedAt ?? null,
                },
          adminUrl: adminUrl(workflow.id),
        };
      }),
    }),
  run_list: ({ workflowId }) => {
    if (!workflows.some((workflow) => workflow.id === workflowId)) {
      return fail(`No workflow with id ${String(workflowId)}. Call workflow_list for ids.`);
    }
    const id = String(workflowId);
    return ok({ workflowId: id, runs: runsOf(id).map(summary), adminUrl: adminUrl(id) });
  },
  run_get: ({ workflowId, runId }) => {
    const workflow = workflows.find((candidate) => candidate.id === workflowId);
    const run = runsOf(String(workflowId)).find((candidate) => candidate.id === runId);
    if (workflow == null || run == null) {
      return fail(`No run ${String(runId)} of workflow ${String(workflowId)}.`);
    }
    return ok({
      ...summary(run),
      workflowId: run.workflowId,
      workflow: {
        displayName: workflow.displayName,
        stepIds: workflow.steps.map((step) => step.id),
        modifiedAt: workflow.modifiedAt,
      },
      taskId: run.taskId ?? null,
      steps: run.steps.map((step) => ({
        id: step.id,
        ms: step.ms,
        output: step.output ?? null,
        error: step.error ?? null,
      })),
      output: run.output ?? null,
      adminUrl: adminUrl(run.workflowId),
    });
  },
  cron_list: () => {
    const ordered = [
      ...cronJobs.filter((job) => job.workflowId != null),
      ...cronJobs.filter((job) => job.workflowId == null),
    ];
    return ok({
      jobs: ordered.map((job) => {
        const result = {
          name: job.name,
          description: job.description ?? null,
          enabled: job.enabled,
          cron: job.cron ?? null,
          timeZone: job.timeZone ?? null,
          descriptor: job.descriptor,
          user: job.user ?? null,
          workflowId: job.workflowId ?? null,
          lastRun: job.lastRun ?? null,
          lastTaskId: null,
        };
        const workflow = workflows.find((candidate) => candidate.id === job.workflowId);
        return workflow == null
          ? result
          : { ...result, workflowName: workflow.displayName, adminUrl: adminUrl(workflow.id) };
      }),
    });
  },
  node_repos: () =>
    ok({
      repos: [
        {
          id: 'com.example.catalog',
          branches: ['master'],
          defaultBranch: 'master',
          access: 'write',
        },
        {
          id: 'com.enonic.cms.default',
          branches: ['draft', 'master'],
          defaultBranch: 'draft',
          access: 'read',
        },
      ],
    }),
  // Understands only `_parentPath = '<path>'`; any other query lists every node.
  node_query: ({ query, count = 10, cursor }) => {
    const parent =
      typeof query === 'string' ? /^_parentPath = '(.*)'$/.exec(query)?.[1] : undefined;
    const matches = NODES.filter((node) => parent == null || parentOf(node._path) === parent);
    const start = typeof cursor === 'string' ? Number(cursor) : 0;
    const page = matches.slice(start, start + Number(count));
    const next = start + page.length;
    return ok({
      total: matches.length,
      count: page.length,
      hits: page.map(nodeSummary),
      ...(next < matches.length && { nextCursor: String(next) }),
    });
  },
  node_get: ({ key }) => {
    const node = findNode(key);
    if (node == null) return fail(`No node at \`${String(key)}\`. Use node_query to find it.`);
    return ok({ ...nodeSummary(node), data: node.data });
  },
  content_search: (args) => ok(searchContent(args)),
  content_get: ({ key }) => {
    const content = getContent(key);
    return content == null
      ? fail(`No content at \`${String(key)}\`. Use content_search to find it.`)
      : ok(content);
  },
  content_type_get: ({ name }) => {
    const type = getContentType(name);
    return type == null ? fail(`No content type \`${String(name)}\`.`) : ok(type);
  },
};

function callTool(name: string, args: Json): ToolResult {
  const tool = READ_TOOLS[name];
  return tool == null ? fail(`${name} is not mocked: writes go through Claude.`) : tool(args);
}

// Live, only the read tools a card calls are forwarded, so the token behind this endpoint
// can never be used for a write.
async function answer(name: string, args: Json): Promise<ToolResult> {
  if (LIVE_TOKEN == null || !Object.hasOwn(READ_TOOLS, name)) return callTool(name, args);
  return callLive(LIVE_TOKEN, name, args);
}

// A page on another origin can POST here too; the harness itself sends its own origin.
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  return origin != null && origin === `http://${req.headers.host}`;
}

async function callLive(token: string, name: string, args: Json): Promise<ToolResult> {
  const response = await fetch(LIVE_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const reply = (await response.json().catch(() => ({}))) as {
    result?: ToolResult;
    error?: { message: string };
  };
  return reply.result ?? fail(reply.error?.message ?? `XP answered ${response.status}`);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
  });
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.end(body);
}

export function mockMcp(): Plugin {
  return {
    name: 'grieg-mock-mcp',
    configureServer: (server) => {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url ?? '';
        if (url.startsWith(CARD_PREFIX)) {
          const view = url.slice(CARD_PREFIX.length).split('?')[0] as CardView;
          if (!CARD_VIEWS.includes(view)) {
            send(res, 404, 'text/plain', `No card view named ${view}`);
            return;
          }
          let html: string;
          try {
            html = readFileSync(CARD_FILE, 'utf8');
          } catch {
            send(res, 404, 'text/plain', 'No card.html yet: run `pnpm build:dev:ui` first.');
            return;
          }
          send(res, 200, 'text/html', stampView(html, view));
          return;
        }
        if (url === MCP_PATH && req.method === 'POST') {
          if (!sameOrigin(req)) {
            send(res, 403, 'text/plain', 'Only the dev harness may call the mock tools.');
            return;
          }
          void readBody(req)
            .then((body) => {
              const { name, arguments: args = {} } = JSON.parse(body) as {
                name: string;
                arguments?: Json;
              };
              return answer(name, args);
            })
            .catch((e: unknown) => fail(String(e)))
            .then((result) => send(res, 200, 'application/json', JSON.stringify(result)));
          return;
        }
        next();
      });
    },
  };
}
