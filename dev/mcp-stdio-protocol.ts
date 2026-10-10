export type JsonRpcId = string | number | null;

export type JsonRpcMessage = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

export const TRANSPORT_ERROR = -32_000;

const META_VERSION = 'io.modelcontextprotocol/protocolVersion';

// The `params` key each method names in `Mcp-Name`.
const NAMED_PARAM: Record<string, string> = {
  'tools/call': 'name',
  'prompts/get': 'name',
  'resources/read': 'uri',
};

const VISIBLE_ASCII = /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

export function toId(value: unknown): JsonRpcId {
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

// `MCP_TOKEN` wins. `MCP_TOKEN_FILE` holds either the bare token or an XP config with a
// `mcp.token = …` line, so it can point straight at com.enonic.app.grieg.cfg.
export function resolveToken(
  env: Record<string, string | undefined>,
  readFile: (path: string) => string,
): string | undefined {
  if (env.MCP_TOKEN?.trim()) return env.MCP_TOKEN.trim();
  if (!env.MCP_TOKEN_FILE) return undefined;

  const content = readFile(env.MCP_TOKEN_FILE);
  const line = content.split(/\r?\n/).find((l) => /^\s*mcp\.token\s*=/.test(l));
  const token = line == null ? content.trim() : line.slice(line.indexOf('=') + 1).trim();
  return token === '' ? undefined : token;
}

// What fetch sends in a header value: tab, visible ASCII with spaces, and the rest of Latin-1.
export function isHeaderValue(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code !== 0x09 && (code < 0x20 || code === 0x7f || code > 0xff)) return false;
  }
  return true;
}

// Header values must be visible ASCII; anything else takes the `=?base64?…?=` form.
export function encodeHeaderValue(value: string): string {
  if (VISIBLE_ASCII.test(value)) return value;
  return `=?base64?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export function metaVersionOf(message: JsonRpcMessage): string | undefined {
  const meta = isObject(message.params) ? message.params._meta : undefined;
  const version = isObject(meta) ? meta[META_VERSION] : undefined;
  return typeof version === 'string' ? version : undefined;
}

// Legacy requests and every notification carry no version of their own, so the session
// remembers the last one seen: from a request's `_meta`, or from the `initialize` result.
export type Session = {
  version: string | undefined;
};

export function createSession(): Session {
  return { version: undefined };
}

export function outgoingVersion(session: Session, message: JsonRpcMessage): string | undefined {
  const metaVersion = metaVersionOf(message);
  if (metaVersion != null) {
    session.version = metaVersion;
    return metaVersion;
  }
  // `initialize` is what negotiates; a stale version would make the server read it as modern.
  return message.method === 'initialize' ? undefined : session.version;
}

export function recordResponse(session: Session, request: JsonRpcMessage, response: unknown) {
  if (request.method !== 'initialize' || !isObject(response) || !isObject(response.result)) return;
  const version = response.result.protocolVersion;
  if (typeof version === 'string') session.version = version;
}

export function headersFor(
  message: JsonRpcMessage,
  version: string | undefined,
  authorization: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (authorization != null) headers.Authorization = authorization;
  if (version != null) headers['MCP-Protocol-Version'] = version;
  if (typeof message.method !== 'string') return headers;

  headers['Mcp-Method'] = message.method;
  const key = Object.hasOwn(NAMED_PARAM, message.method) ? NAMED_PARAM[message.method] : undefined;
  const name = key != null && isObject(message.params) ? message.params[key] : undefined;
  if (typeof name === 'string') headers['Mcp-Name'] = encodeHeaderValue(name);
  return headers;
}

// Anything a stream may carry: a response, or a request or notification from the server.
export function isJsonRpcMessage(value: unknown): boolean {
  return isObject(value) && value.jsonrpc === '2.0';
}

export function isJsonRpcResponse(value: unknown): boolean {
  return (
    isObject(value) &&
    value.jsonrpc === '2.0' &&
    (value.result !== undefined || value.error !== undefined)
  );
}

export function transportError(id: JsonRpcId, message: string, data?: unknown) {
  const error =
    data === undefined
      ? { code: TRANSPORT_ERROR, message }
      : { code: TRANSPORT_ERROR, message, data };
  return { jsonrpc: '2.0', id, error };
}

// What a non-SSE HTTP reply turns into on stdout. A JSON-RPC body passes through whatever the
// status; anything else, such as XP's HTML login page on 401, becomes an error for the request.
export function replyFor(
  status: number,
  statusText: string,
  text: string,
  id: JsonRpcId,
): unknown | undefined {
  if (status === 202 || status === 204) return undefined;

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (isJsonRpcResponse(body)) return body;
  return transportError(id, `HTTP ${status} ${statusText}`.trim(), { status });
}

// Incremental `text/event-stream` parser: feed chunks, get the `data` payload of each event.
// Multi-line `data:` fields join with `\n`; CRLF, LF and CR line endings are all accepted.
export function createSseParser() {
  let buffer = '';
  let data: string[] = [];
  let pendingCr = false;

  function takeLine(line: string, events: string[]) {
    if (line === '') {
      if (data.length > 0) events.push(data.join('\n'));
      data = [];
    } else if (line === 'data' || line.startsWith('data:')) {
      const value = line.slice(5);
      data.push(value.startsWith(' ') ? value.slice(1) : value);
    }
  }

  return {
    push(chunk: string): string[] {
      const events: string[] = [];
      buffer += pendingCr && chunk.startsWith('\n') ? chunk.slice(1) : chunk;
      pendingCr = false;

      let match: RegExpExecArray | null;
      const eol = /\r\n|\r|\n/g;
      let start = 0;
      while ((match = eol.exec(buffer)) != null) {
        // A lone CR at the end may be the first half of a CRLF split across chunks.
        if (match[0] === '\r' && match.index === buffer.length - 1) pendingCr = true;
        takeLine(buffer.slice(start, match.index), events);
        start = match.index + match[0].length;
      }
      buffer = buffer.slice(start);
      return events;
    },
    end(): string[] {
      const events: string[] = [];
      if (buffer !== '') takeLine(buffer, events);
      buffer = '';
      takeLine('', events);
      return events;
    },
  };
}
