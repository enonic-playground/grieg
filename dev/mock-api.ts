import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite-plus';

import { scheduleInputError, scheduleName } from '../src/main/resources/lib/schedule.ts';
import { validateSteps } from '../src/main/resources/lib/steps.ts';

// In-memory stand-ins for the XP server APIs, so the React app runs without a sandbox.
// The shapes here are the contract the real `apis/*` controllers owe the client.

const API_PREFIX = '/dev-api';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

type Reply = {
  status?: number;
  data?: unknown;
  error?: string;
  code?: string;
  extra?: Record<string, unknown>;
};

type Handler = (params: URLSearchParams, req: IncomingMessage) => Reply | Promise<Reply>;

type MockStep = { id: string; type: string; config?: { prompt?: string; model?: string } };

export type MockWorkflow = {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  enabled: boolean;
  steps: MockStep[];
  modifiedAt: string;
};

export const workflows: MockWorkflow[] = [
  {
    id: 'wf-1',
    name: 'summarize-articles',
    displayName: 'Summarize articles',
    description: 'Draft summaries for newly published articles',
    enabled: true,
    steps: [
      {
        id: 'outline',
        type: 'llm',
        config: { prompt: 'Outline the key points of a news article.' },
      },
      {
        id: 'summary',
        type: 'llm',
        config: {
          prompt: 'Write a two-sentence summary from this outline:\n{{steps.outline.output}}',
          model: 'gemini-3.1-flash-lite',
        },
      },
    ],
    modifiedAt: '2026-09-10T08:12:00Z',
  },
  {
    id: 'wf-2',
    name: 'tag-images',
    displayName: 'Tag images',
    enabled: false,
    steps: [
      { id: 'tags', type: 'llm', config: { prompt: 'Suggest five tags. Say fail to fail.' } },
    ],
    modifiedAt: '2026-09-02T14:41:00Z',
  },
];

export type MockRun = {
  id: string;
  workflowId: string;
  status: 'running' | 'done' | 'failed' | 'skipped';
  trigger: 'manual' | 'schedule';
  user: string;
  taskId?: string;
  startedAt: string;
  finishedAt?: string;
  steps: { id: string; output?: string; error?: string; ms: number }[];
  output?: string;
  error?: string;
};

// Each mock step "takes" this long, so a run stays `running` long enough to watch it poll.
const MOCK_STEP_MS = 1500;
const MAX_RUNS = 20;

// The steps each run started with, so saving a workflow mid-run does not change the run.
const runSteps = new Map<string, MockStep[]>();

export const runs = new Map<string, MockRun[]>([
  [
    'wf-1',
    [
      {
        id: 'run-seed-2',
        workflowId: 'wf-1',
        status: 'failed',
        trigger: 'schedule',
        user: 'user:system:su',
        startedAt: '2026-09-11T02:00:03Z',
        finishedAt: '2026-09-11T02:00:05Z',
        steps: [{ id: 'outline', error: 'Vertex AI returned 429: quota exceeded', ms: 1840 }],
        error: 'Vertex AI returned 429: quota exceeded',
      },
      {
        id: 'run-seed-1',
        workflowId: 'wf-1',
        status: 'done',
        trigger: 'manual',
        user: 'user:system:su',
        startedAt: '2026-09-10T09:00:00Z',
        finishedAt: '2026-09-10T09:00:04Z',
        steps: [
          { id: 'outline', output: '- Budget passed\n- Taxes unchanged', ms: 1710 },
          { id: 'summary', output: 'The budget passed. Taxes stay as they are.', ms: 2220 },
        ],
        output: 'The budget passed. Taxes stay as they are.',
      },
    ],
  ],
]);

// Advances a running run by wall-clock time: one step per MOCK_STEP_MS. A prompt containing
// "fail" fails its step, so the failed state can be seen too.
export function advance(run: MockRun): void {
  if (run.status !== 'running') return;
  const steps = runSteps.get(run.id) ?? [];
  const elapsed = Date.now() - Date.parse(run.startedAt);
  const finished = Math.min(Math.floor(elapsed / MOCK_STEP_MS), steps.length);
  for (let index = run.steps.length; index < finished; index += 1) {
    const step = steps[index];
    const prompt = step.config?.prompt ?? '';
    if (/\bfail\b/i.test(prompt)) {
      run.steps.push({ id: step.id, error: 'Mock step failed as asked', ms: MOCK_STEP_MS });
      run.status = 'failed';
      run.error = 'Mock step failed as asked';
      run.finishedAt = new Date().toISOString();
      return;
    }
    run.steps.push({
      id: step.id,
      output: `Mock output of ${step.id} for: ${prompt.slice(0, 80)}`,
      ms: MOCK_STEP_MS,
    });
  }
  if (run.steps.length === steps.length) {
    run.status = 'done';
    run.output = run.steps.at(-1)?.output;
    run.finishedAt = new Date().toISOString();
  }
}

function findWorkflow(params: URLSearchParams): MockWorkflow | Reply {
  const id = params.get('id');
  if (id == null) return { status: 400, error: 'Missing `id` parameter' };
  return (
    workflows.find((workflow) => workflow.id === id) ?? {
      status: 404,
      error: `No workflow with id ${id}`,
    }
  );
}

function isReply(value: MockWorkflow | Reply): value is Reply {
  return !('steps' in value);
}

function stepsError(steps: unknown): Reply | undefined {
  if (steps === undefined) return undefined;
  const invalid = validateSteps(steps);
  if (invalid == null) return undefined;
  if (invalid.index < 0) return { status: 400, error: invalid.message, code: 'INVALID_STEPS' };
  return {
    status: 400,
    error: `Step ${invalid.index + 1}: ${invalid.message}`,
    code: 'INVALID_STEPS',
    extra: { step: { index: invalid.index, id: invalid.id } },
  };
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const value: unknown = JSON.parse(body);
        resolve(
          value != null && typeof value === 'object'
            ? (value as Record<string, unknown>)
            : undefined,
        );
      } catch {
        resolve(undefined);
      }
    });
  });
}

function startRun(workflow: MockWorkflow): Reply {
  const list = runs.get(workflow.id) ?? [];
  list.forEach(advance);
  const run: MockRun = {
    id: `run-${randomBytes(4).toString('hex')}`,
    workflowId: workflow.id,
    status: 'running',
    trigger: 'manual',
    user: DEV_OWNER,
    startedAt: new Date().toISOString(),
    steps: [],
  };
  if (list.some((existing) => existing.status === 'running')) {
    run.status = 'skipped';
    run.finishedAt = run.startedAt;
  } else {
    run.taskId = `task-${randomBytes(4).toString('hex')}`;
    runSteps.set(run.id, workflow.steps);
  }
  // Retention never drops a running run, or the next start would not see it and go ahead.
  const kept = [run, ...list];
  while (kept.length > MAX_RUNS) {
    const index = kept.findLastIndex((existing) => existing.status !== 'running');
    if (index < 0) break;
    kept.splice(index, 1);
  }
  runs.set(workflow.id, kept);
  return run.status === 'running'
    ? { status: 202, data: { runId: run.id, taskId: run.taskId, status: run.status } }
    : { data: { runId: run.id, status: run.status } };
}

const workflowsApi: Partial<Record<Method, Handler>> = {
  GET: (params) => {
    if (params.get('id') == null) return { data: { workflows } };
    const workflow = findWorkflow(params);
    if (isReply(workflow)) return workflow;
    if (params.get('runs') !== 'true') return { data: workflow };
    const list = runs.get(workflow.id) ?? [];
    list.forEach(advance);
    return { data: { runs: list } };
  },
  POST: async (params, req) => {
    if (params.get('action') === 'run') {
      const workflow = findWorkflow(params);
      return isReply(workflow) ? workflow : startRun(workflow);
    }
    const input = await readJson(req);
    if (typeof input?.name !== 'string' || input.name === '') {
      return { status: 400, error: 'Body must be a JSON object with a `name`' };
    }
    if (workflows.some((workflow) => workflow.name === input.name)) {
      return { status: 400, error: `A workflow named ${input.name} exists` };
    }
    const invalid = stepsError(input.steps);
    if (invalid != null) return invalid;
    const workflow: MockWorkflow = {
      id: `wf-${randomBytes(4).toString('hex')}`,
      name: input.name,
      displayName: typeof input.displayName === 'string' ? input.displayName : input.name,
      enabled: false,
      steps: (input.steps as MockStep[] | undefined) ?? [],
      modifiedAt: new Date().toISOString(),
    };
    workflows.push(workflow);
    return { status: 201, data: workflow };
  },
  PUT: async (params, req) => {
    const workflow = findWorkflow(params);
    if (isReply(workflow)) return workflow;
    const input = await readJson(req);
    if (input == null) return { status: 400, error: 'Body must be a JSON object' };
    const invalid = stepsError(input.steps);
    if (invalid != null) return invalid;
    if (typeof input.displayName === 'string') workflow.displayName = input.displayName;
    if (Array.isArray(input.steps)) workflow.steps = input.steps as MockStep[];
    workflow.modifiedAt = new Date().toISOString();
    return { data: workflow };
  },
};

export type MockJob = {
  name: string;
  description?: string;
  enabled: boolean;
  cron: string;
  timeZone: string;
  descriptor: string;
  user?: string;
  workflowId?: string;
  lastRun?: string;
};

const RUN_TASK = 'com.enonic.app.grieg:run-workflow';

export const cronJobs: MockJob[] = [
  {
    name: scheduleName('wf-1'),
    enabled: true,
    cron: '0 2 * * *',
    timeZone: 'Europe/Oslo',
    descriptor: RUN_TASK,
    user: 'user:system:su',
    workflowId: 'wf-1',
    lastRun: '2026-09-11T02:00:03Z',
  },
  {
    name: 'purge-trash-weekly',
    description: "Another application's job",
    enabled: false,
    cron: '0 3 * * 0',
    timeZone: 'UTC',
    descriptor: 'com.example.app.cleanup:purge-trash',
    user: 'user:system:cleanup',
  },
];

function isTimeZone(id: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: id });
    return true;
  } catch {
    return false;
  }
}

function scheduleError(
  input: Record<string, unknown> | undefined,
  required: boolean,
): Reply | undefined {
  const invalid = scheduleInputError(input, required);
  if (invalid != null) return { status: 400, error: invalid, code: 'BAD_REQUEST' };
  const timeZone = input?.timeZone;
  if (typeof timeZone === 'string' && !isTimeZone(timeZone)) {
    return { status: 400, error: `Unknown time zone ${timeZone}`, code: 'INVALID_TIME_ZONE' };
  }
  return undefined;
}

function findJob(params: URLSearchParams): MockJob | Reply {
  const name = params.get('name');
  if (name == null) return { status: 400, error: 'Missing `name` parameter' };
  return (
    cronJobs.find((job) => job.name === name) ?? {
      status: 404,
      error: `No scheduled job named ${name}`,
      code: 'NOT_FOUND',
    }
  );
}

function isJob(value: MockJob | Reply): value is MockJob {
  return 'descriptor' in value;
}

// Mirrors apis/crons, including re-owning a workflow schedule on save.
const cronsApi: Partial<Record<Method, Handler>> = {
  GET: (params) => {
    const workflowId = params.get('workflowId');
    if (workflowId == null) return { data: { jobs: cronJobs } };
    return { data: cronJobs.find((job) => job.name === scheduleName(workflowId)) ?? null };
  },
  POST: async (_params, req) => {
    const input = await readJson(req);
    const workflowId = input?.workflowId;
    if (typeof workflowId !== 'string' || workflowId === '') {
      return { status: 400, error: 'Body must name a `workflowId`', code: 'BAD_REQUEST' };
    }
    const invalid = scheduleError(input, true);
    if (invalid != null) return invalid;
    if (!workflows.some((workflow) => workflow.id === workflowId)) {
      return { status: 404, error: `No workflow with id ${workflowId}`, code: 'NOT_FOUND' };
    }
    const name = scheduleName(workflowId);
    if (cronJobs.some((job) => job.name === name)) {
      return {
        status: 409,
        error: `Workflow ${workflowId} already has a schedule`,
        code: 'CONFLICT',
      };
    }
    const job: MockJob = {
      name,
      enabled: input?.enabled !== false,
      cron: String(input?.cron).trim(),
      timeZone: typeof input?.timeZone === 'string' ? input.timeZone : 'UTC',
      descriptor: RUN_TASK,
      user: DEV_OWNER,
      workflowId,
    };
    cronJobs.push(job);
    return { status: 201, data: job };
  },
  PUT: async (params, req) => {
    const input = await readJson(req);
    const invalid = scheduleError(input, false);
    if (invalid != null) return invalid;
    const job = findJob(params);
    if (!isJob(job)) return job;
    const own = job.descriptor === RUN_TASK;
    if (!own && (input?.cron !== undefined || input?.timeZone !== undefined)) {
      return {
        status: 403,
        error: 'Only a workflow cron schedule can change its cron',
        code: 'FORBIDDEN',
      };
    }
    if (typeof input?.enabled === 'boolean') job.enabled = input.enabled;
    if (own) {
      if (typeof input?.cron === 'string') job.cron = input.cron.trim();
      if (typeof input?.timeZone === 'string') job.timeZone = input.timeZone;
      job.user = DEV_OWNER;
    }
    return { data: job };
  },
  DELETE: (params) => {
    const job = findJob(params);
    if (!isJob(job)) return job;
    if (job.descriptor !== RUN_TASK) {
      return {
        status: 403,
        error: 'Only a workflow schedule can be deleted here',
        code: 'FORBIDDEN',
      };
    }
    cronJobs.splice(cronJobs.indexOf(job), 1);
    return { data: { name: job.name } };
  },
};

type KeyInfo = { display: string; created: string; expires: string; lastUsed?: string };

const DEV_OWNER = 'user:system:su';
const KEY_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// A new key is "used" this long after it was generated, so the connection check can be watched.
const MOCK_FIRST_USE_MS = 8000;

const keys = new Map<string, KeyInfo>([
  [
    'user:system:alice',
    {
      display: 'grieg_k3Xa…9fQ2',
      created: '2026-09-01T09:30:00Z',
      expires: '2026-11-30T09:30:00Z',
      lastUsed: '2026-09-12T16:05:00Z',
    },
  ],
]);

function generateKey(owner: string): { key: string } & KeyInfo {
  const random = randomBytes(32).toString('base64url');
  const now = new Date();
  const info: KeyInfo = {
    display: `grieg_${random.slice(0, 4)}…${random.slice(-4)}`,
    created: now.toISOString(),
    expires: new Date(now.getTime() + KEY_TTL_MS).toISOString(),
  };
  keys.set(owner, info);
  return { key: `grieg_${random}`, ...info };
}

function ownKey(owner: string): KeyInfo | null {
  const info = keys.get(owner);
  if (info == null) return null;
  const firstUse = Date.parse(info.created) + MOCK_FIRST_USE_MS;
  if (info.lastUsed == null && Date.now() >= firstUse) {
    info.lastUsed = new Date(firstUse).toISOString();
  }
  return info;
}

function deleteKey(owner: string): Reply {
  if (!keys.delete(owner)) return { status: 404, error: `No MCP key owned by ${owner}` };
  return { data: { owner } };
}

// The dev user is both an admin and an MCP role member.
const HANDLERS: Record<string, Partial<Record<Method, Handler>>> = {
  system: {
    GET: () => ({
      data: {
        xpVersion: '8.0.3',
        appName: 'com.enonic.app.grieg',
        appVersion: '1.0.0-SNAPSHOT',
        mcpKeys: true,
        mcpSharedToken: false,
        mcpProject: 'default',
        mcpBranch: 'draft',
      },
    }),
  },
  workflows: workflowsApi,
  crons: cronsApi,
  keys: {
    GET: (params) =>
      params.get('all') === 'true'
        ? { data: { keys: [...keys].map(([owner, info]) => ({ owner, ...info })) } }
        : { data: ownKey(DEV_OWNER) },
    // Like the real API, refuses a POST that is not JSON.
    POST: (_params, req) =>
      req.headers['content-type']?.split(';')[0].trim() === 'application/json'
        ? { status: 201, data: generateKey(DEV_OWNER) }
        : { status: 415, error: 'Send the request as `application/json`' },
    DELETE: (params) => deleteKey(params.get('owner') ?? DEV_OWNER),
  },
};

const BUNDLE_URL = '/grieg.mcpb';
const BUNDLE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../build/resources/main/assets/grieg.mcpb',
);

function sendBundle(res: ServerResponse): void {
  if (!existsSync(BUNDLE_PATH)) {
    send(res, 404, { status: 404, message: 'No grieg.mcpb yet: run `pnpm build` first' });
    return;
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.end(readFileSync(BUNDLE_PATH));
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(body);
}

export function mockApi(): Plugin {
  return {
    name: 'grieg-mock-api',
    configureServer: (server) => {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url ?? '';
        if (url === BUNDLE_URL) {
          sendBundle(res);
          return;
        }
        if (!url.startsWith(API_PREFIX)) {
          next();
          return;
        }

        const [name, query = ''] = url.slice(API_PREFIX.length + 1).split('?');
        const api = HANDLERS[name];
        if (api == null) {
          send(res, 404, { status: 404, message: `No mock API named ${name}` });
          return;
        }

        const method = req.method ?? 'GET';
        const handler = api[method as Method];
        if (handler == null) {
          send(res, 405, { status: 405, message: `The ${name} mock has no ${method} handler` });
          return;
        }

        void Promise.resolve(handler(new URLSearchParams(query), req)).then(
          ({ status = 200, data, error, code, extra }) =>
            send(
              res,
              status,
              error == null ? { data } : { status, message: error, code, ...extra },
            ),
        );
      });
    },
  };
}
