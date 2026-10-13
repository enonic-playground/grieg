import { randomBytes } from 'node:crypto';

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite-plus';

// In-memory stand-ins for the XP server APIs, so the React app runs without a sandbox.
// The shapes here are the contract the real `apis/*` controllers owe the client.

const API_PREFIX = '/dev-api';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

type Reply = { status?: number; data?: unknown; error?: string };

type Handler = (params: URLSearchParams, req: IncomingMessage) => Reply;

const workflows = [
  {
    id: 'wf-1',
    name: 'summarize-articles',
    displayName: 'Summarize articles',
    description: 'Draft summaries for newly published articles',
    enabled: true,
    steps: [
      { id: 'fetch', type: 'content.query' },
      { id: 'summarize', type: 'ai.completion' },
      { id: 'store', type: 'content.modify' },
    ],
    modifiedAt: '2026-09-10T08:12:00Z',
  },
  {
    id: 'wf-2',
    name: 'tag-images',
    displayName: 'Tag images',
    enabled: false,
    steps: [{ id: 'vision', type: 'ai.vision' }],
    modifiedAt: '2026-09-02T14:41:00Z',
  },
];

const cronJobs = [
  {
    name: 'summarize-articles-nightly',
    description: 'Runs the article summarizer',
    enabled: true,
    cron: '0 2 * * *',
    timeZone: 'Europe/Oslo',
    descriptor: 'com.enonic.app.grieg:run-workflow',
    lastRun: '2026-09-11T02:00:03Z',
  },
  {
    name: 'tag-images-hourly',
    enabled: false,
    cron: '0 * * * *',
    descriptor: 'com.enonic.app.grieg:run-workflow',
  },
];

type KeyInfo = { display: string; created: string; expires: string; lastUsed?: string };

const DEV_OWNER = 'user:system:su';
const KEY_TTL_MS = 90 * 24 * 60 * 60 * 1000;

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
  workflows: { GET: () => ({ data: { workflows } }) },
  crons: { GET: () => ({ data: { jobs: cronJobs } }) },
  keys: {
    GET: (params) =>
      params.get('all') === 'true'
        ? { data: { keys: [...keys].map(([owner, info]) => ({ owner, ...info })) } }
        : { data: keys.get(DEV_OWNER) ?? null },
    // Like the real API, refuses a POST that is not JSON.
    POST: (_params, req) =>
      req.headers['content-type']?.split(';')[0].trim() === 'application/json'
        ? { status: 201, data: generateKey(DEV_OWNER) }
        : { status: 415, error: 'Send the request as `application/json`' },
    DELETE: (params) => deleteKey(params.get('owner') ?? DEV_OWNER),
  },
};

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

        const { status = 200, data, error } = handler(new URLSearchParams(query), req);
        send(res, status, error == null ? { data } : { status, message: error });
      });
    },
  };
}
