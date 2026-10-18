import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { build } from 'vite-plus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Server } from '../../main/resources/lib/mcp';

import { mcpbConfig } from '../../../dev/mcpb/bundle.ts';
import { handle } from '../../main/resources/lib/mcp';

const KEY = `grieg_${'k'.repeat(43)}`;

const SERVER: Server = {
  info: { name: 'grieg', title: 'Grieg', version: '1.0.0', description: 'Test' },
  instructions: 'Use the tools.',
  tools: [
    {
      name: 'echo',
      title: 'Echo',
      description: 'Echoes its argument',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true },
      handler: (args) => ({ ok: true, value: { echoed: args.value } }),
    },
  ],
};

let outDir: string;
let endpoint: HttpServer;
let endpointUrl: string;
const authorizations: (string | undefined)[] = [];

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    req.on('end', () => resolve(body));
  });
}

// A stand-in for XP: the real `handle()` behind plain HTTP.
function startEndpoint(): Promise<void> {
  endpoint = createServer(async (req, res) => {
    authorizations.push(req.headers.authorization);
    const reply = handle(
      {
        body: await readBody(req),
        header: (name) => req.headers[name.toLowerCase()]?.toString(),
      },
      SERVER,
    );
    res.statusCode = reply.status;
    if (reply.body != null) res.setHeader('Content-Type', 'application/json');
    res.end(reply.body == null ? undefined : JSON.stringify(reply.body));
  });
  return new Promise((resolve) => {
    endpoint.listen(0, '127.0.0.1', () => {
      const address = endpoint.address() as { port: number };
      endpointUrl = `http://127.0.0.1:${address.port}/api/com.enonic.app.grieg:mcp`;
      resolve();
    });
  });
}

// Runs the compiled server the way Desktop does: plain `node`, the two values in its environment.
async function exchange(messages: unknown[]): Promise<Record<string, unknown>[]> {
  const child = spawn(process.execPath, [path.join(outDir, 'server/index.js')], {
    env: { PATH: process.env.PATH, MCP_URL: endpointUrl, MCP_TOKEN: KEY },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const replies: Record<string, unknown>[] = [];
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => replies.push(JSON.parse(line) as Record<string, unknown>));
  for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
  child.stdin.end();
  await new Promise<void>((resolve) => child.on('close', () => resolve()));
  return replies;
}

beforeAll(async () => {
  outDir = mkdtempSync(path.join(tmpdir(), 'grieg-mcpb-'));
  await build({ ...mcpbConfig(outDir), configFile: false, logLevel: 'silent' });
  await startEndpoint();
}, 60_000);

afterAll(() => {
  endpoint?.close();
  if (outDir != null) rmSync(outDir, { recursive: true, force: true });
});

describe('grieg.mcpb', () => {
  it('should start with plain node and answer initialize and tools/list through the endpoint', async () => {
    const replies = await exchange([
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);

    expect(replies).toHaveLength(2);
    expect(replies[0]).toMatchObject({
      id: 1,
      result: { protocolVersion: '2025-06-18', serverInfo: { name: 'grieg' } },
    });
    expect(replies[1]).toMatchObject({ id: 2, result: { tools: [{ name: 'echo' }] } });
    expect(new Set(authorizations)).toEqual(new Set([`Bearer ${KEY}`]));
  });

  it('should take the endpoint and key from the user config and keep the key sensitive', () => {
    const manifest = JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));

    expect(manifest.server.mcp_config.env).toEqual({
      MCP_URL: '${user_config.url}',
      MCP_TOKEN: '${user_config.key}',
    });
    expect(manifest.user_config.key.sensitive).toBe(true);
    expect(manifest.$schema).toBeUndefined();
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
