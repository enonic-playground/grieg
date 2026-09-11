import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite-plus';

// In-memory stand-ins for the XP server APIs, so the React app runs without a sandbox.
// The shapes here are the contract the real `apis/*` controllers owe the client.

const API_PREFIX = '/dev-api';

type Handler = () => unknown;

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

const HANDLERS: Record<string, Handler> = {
  system: () => ({
    xpVersion: '8.0.3',
    appName: 'com.enonic.app.grieg',
    appVersion: '1.0.0-SNAPSHOT',
    mcpEnabled: true,
    mcpProject: 'default',
    mcpBranch: 'draft',
  }),
  workflows: () => ({ workflows }),
  crons: () => ({ jobs: cronJobs }),
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

        const name = url.slice(API_PREFIX.length + 1).split('?')[0];
        const handler = HANDLERS[name];

        if (handler == null) {
          send(res, 404, { status: 404, message: `No mock API named ${name}` });
          return;
        }

        send(res, 200, { data: handler() });
      });
    },
  };
}
