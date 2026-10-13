// Stdio MCP server that forwards each message to grieg's HTTP endpoint. Run it with `node`
// directly: `pnpm run` writes to stdout, which is the protocol channel.
//
// MCP_URL         the MCP endpoint, e.g. http://localhost:8080/api/com.enonic.app.grieg:mcp
// MCP_TOKEN       bearer: a personal key or the shared token, or
// MCP_TOKEN_FILE  a file holding the token, or an XP config with an `mcp.token = …` line

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

import type { JsonRpcMessage } from './mcp-stdio-protocol.ts';

import {
  createSession,
  createSseParser,
  headersFor,
  isHeaderValue,
  isJsonRpcMessage,
  isJsonRpcResponse,
  outgoingVersion,
  recordResponse,
  replyFor,
  resolveToken,
  toId,
  transportError,
} from './mcp-stdio-protocol.ts';

const url = process.env.MCP_URL;
if (url == null || url === '') {
  log('MCP_URL is not set.');
  process.exit(2);
}

let token: string | undefined;
try {
  token = resolveToken(process.env, (file) => readFileSync(file, 'utf8'));
} catch (e) {
  log(`Cannot read MCP_TOKEN_FILE: ${errorMessage(e)}`);
  process.exit(2);
}
// fetch quotes an invalid header value in its error, which would put the token in the output.
if (token != null && !isHeaderValue(token)) {
  log(
    'The MCP token contains characters a header cannot carry: a control character or non-Latin-1.',
  );
  process.exit(2);
}
if (token == null) log('No MCP_TOKEN or MCP_TOKEN_FILE; requests go out without a token.');

const session = createSession();
const inflight = new Map<string | number, AbortController>();
const pending = new Set<Promise<void>>();

function log(message: string) {
  process.stderr.write(`[mcp-stdio] ${message}\n`);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function send(message: unknown) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function authorization(): string | undefined {
  return token == null ? undefined : `Bearer ${token}`;
}

async function forwardSse(
  body: ReadableStream<Uint8Array>,
  request: JsonRpcMessage,
  onResponse: () => void,
) {
  const parser = createSseParser();
  const decoder = new TextDecoder();
  const emit = (events: string[]) => {
    for (const data of events) {
      let message: unknown;
      try {
        message = JSON.parse(data);
      } catch (e) {
        log(`Dropped an SSE event that is not JSON: ${errorMessage(e)}`);
        continue;
      }
      if (!isJsonRpcMessage(message)) {
        log('Dropped an SSE event that is not a JSON-RPC message.');
        continue;
      }
      if (isJsonRpcResponse(message)) {
        recordResponse(session, request, message);
        if ((message as { id?: unknown }).id === request.id) onResponse();
      }
      send(message);
    }
  };
  for await (const chunk of body) emit(parser.push(decoder.decode(chunk, { stream: true })));
  emit(parser.push(decoder.decode()));
  emit(parser.end());
}

async function forward(message: JsonRpcMessage) {
  const isRequest = message.id !== undefined;
  const id = toId(message.id);
  const controller = new AbortController();
  if (id != null) inflight.set(id, controller);
  let answered = false;

  try {
    const version = outgoingVersion(session, message);
    const response = await fetch(url as string, {
      method: 'POST',
      headers: headersFor(message, version, authorization()),
      body: JSON.stringify(message),
      signal: controller.signal,
    });

    const type = response.headers.get('content-type') ?? '';
    if (type.toLowerCase().startsWith('text/event-stream') && response.body != null) {
      await forwardSse(response.body, message, () => (answered = true));
      if (isRequest && !answered) {
        send(transportError(id, 'Forwarder transport error: the stream ended without a response'));
      }
      return;
    }

    const reply = replyFor(response.status, response.statusText, await response.text(), id);
    if (reply == null) return;
    if (!response.ok) log(`HTTP ${response.status} for ${String(message.method)}`);
    recordResponse(session, message, reply);
    if (isRequest) send(reply);
  } catch (e) {
    if (controller.signal.aborted) return;
    log(`${String(message.method)}: ${errorMessage(e)}`);
    if (isRequest && !answered) {
      send(transportError(id, `Forwarder transport error: ${errorMessage(e)}`));
    }
  } finally {
    if (id != null) inflight.delete(id);
  }
}

function onLine(line: string) {
  if (line.trim() === '') return;

  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32_700, message: 'Parse error' } });
    return;
  }
  if (typeof message !== 'object' || message == null || Array.isArray(message)) {
    send({ jsonrpc: '2.0', id: null, error: { code: -32_600, message: 'Invalid request' } });
    return;
  }

  const rpc = message as JsonRpcMessage;
  // Over HTTP, closing the request's stream is the cancellation.
  if (rpc.method === 'notifications/cancelled') {
    const params = rpc.params as { requestId?: unknown } | undefined;
    const requestId = toId(params?.requestId);
    if (requestId != null) inflight.get(requestId)?.abort();
    return;
  }
  // A response to a server-to-client request: stateless HTTP has no channel to carry it.
  if (rpc.method === undefined) return;

  const task = forward(rpc);
  pending.add(task);
  void task.finally(() => pending.delete(task));
}

createInterface({ input: process.stdin })
  .on('line', onLine)
  .on('close', async () => {
    await Promise.allSettled(pending);
    // Pipe writes are asynchronous on macOS; exit only once stdout has flushed.
    process.stdout.write('', () => process.exit(0));
  });
