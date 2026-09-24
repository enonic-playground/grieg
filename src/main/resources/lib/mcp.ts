// Model Context Protocol over a stateless HTTP POST. Serves both eras from one method table:
// the 2026-07-28 per-request-metadata protocol and the legacy `initialize` handshake.

export const LATEST_VERSION = '2026-07-28';
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
export const SUPPORTED_VERSIONS = [LATEST_VERSION, ...LEGACY_VERSIONS];

const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

const CACHE_TTL_MS = 300_000;

export const ErrorCode = {
  PARSE_ERROR: -32_700,
  INVALID_REQUEST: -32_600,
  METHOD_NOT_FOUND: -32_601,
  INVALID_PARAMS: -32_602,
  HEADER_MISMATCH: -32_020,
  UNSUPPORTED_PROTOCOL_VERSION: -32_022,
} as const;

export type Era = 'modern' | 'legacy';

export type JsonRpcId = string | number | null;

type JsonObject = Record<string, unknown>;

type RpcError = { code: number; message: string; data?: unknown };

export type Implementation = {
  name: string;
  title: string;
  version: string;
  description: string;
};

export type ToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export type ToolOutcome = { ok: true; value: JsonObject } | { ok: false; message: string };

export type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonObject;
  outputSchema: JsonObject;
  annotations: ToolAnnotations;
  handler: (args: JsonObject) => ToolOutcome;
};

export type Server = {
  info: Implementation;
  instructions: string;
  tools: Tool[];
};

export type HttpRequest = {
  body: string | undefined;
  // Case-insensitive lookup, `undefined` when the header is absent.
  header: (name: string) => string | undefined;
};

// `body` undefined means an empty response (202 for accepted notifications).
export type HttpReply = { status: number; body?: JsonObject };

type Message = {
  id: JsonRpcId;
  method: string;
  params: JsonObject;
};

type MethodContext = { params: JsonObject; server: Server };

type MethodOutcome = { result: JsonObject } | { error: RpcError };

type MethodEntry = {
  legacyOnly?: boolean;
  // Modern results of cacheable methods carry `ttlMs` and `cacheScope`.
  cacheable?: boolean;
  run: (context: MethodContext) => MethodOutcome;
};

//
// * Helpers
//

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function errorBody(id: JsonRpcId, error: RpcError): JsonObject {
  return { jsonrpc: '2.0', id, error };
}

function reject(status: number, id: JsonRpcId, code: number, message: string, data?: unknown) {
  const error: RpcError = data === undefined ? { code, message } : { code, message, data };
  return { status, body: errorBody(id, error) };
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_PREFIX = '=?base64?';
const BASE64_SUFFIX = '?=';

// XP's script engine has neither `atob` nor `Buffer`, hence the hand-rolled decoder.
export function decodeBase64Utf8(encoded: string): string | undefined {
  const clean = encoded.replace(/=+$/, '');
  if (clean.length % 4 === 1) return undefined;

  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const index = BASE64_ALPHABET.indexOf(char);
    if (index < 0) return undefined;
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  try {
    const percentEncoded = bytes.map((b) => `%${b.toString(16).padStart(2, '0')}`).join('');
    return decodeURIComponent(percentEncoded);
  } catch {
    return undefined;
  }
}

// Decodes the `=?base64?…?=` sentinel form of `Mcp-Name`; plain values pass through.
export function decodeHeaderValue(value: string): string | undefined {
  if (!value.startsWith(BASE64_PREFIX)) return value;
  if (
    !value.endsWith(BASE64_SUFFIX) ||
    value.length < BASE64_PREFIX.length + BASE64_SUFFIX.length
  ) {
    return undefined;
  }
  return decodeBase64Utf8(value.slice(BASE64_PREFIX.length, -BASE64_SUFFIX.length));
}

// Compares every character so the time taken does not reveal how much of a token matched.
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function isLegacyVersion(version: string | undefined): boolean {
  return version == null || LEGACY_VERSIONS.includes(version);
}

// The header decides first, then `_meta`. `_meta` alone is not a signal: the legacy runtime
// of Claude Code sends `_meta` with its own keys on `tools/call`.
export function detectEra(headerVersion: string | undefined, metaVersion: string | undefined): Era {
  return isLegacyVersion(headerVersion ?? metaVersion) ? 'legacy' : 'modern';
}

function metaOf(params: JsonObject): JsonObject | undefined {
  return isObject(params._meta) ? params._meta : undefined;
}

function metaVersionOf(params: JsonObject): string | undefined {
  const version = metaOf(params)?.[META_VERSION];
  return typeof version === 'string' ? version : undefined;
}

//
// * Tool Results
//

function textResult(text: string, isError: boolean): JsonObject {
  return { content: [{ type: 'text', text }], isError };
}

function runTool(tool: Tool, args: JsonObject): JsonObject {
  let outcome: ToolOutcome;
  try {
    outcome = tool.handler(args);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return textResult(`${tool.name} failed: ${message}`, true);
  }

  if (!outcome.ok) return textResult(outcome.message, true);
  return {
    ...textResult(JSON.stringify(outcome.value), false),
    structuredContent: outcome.value,
  };
}

function describeTools(tools: Tool[]): JsonObject[] {
  return tools.map(({ name, title, description, inputSchema, outputSchema, annotations }) => ({
    name,
    title,
    description,
    inputSchema,
    outputSchema,
    annotations: { title, ...annotations },
  }));
}

//
// * Method Table
//

const METHODS: Record<string, MethodEntry> = {
  initialize: {
    legacyOnly: true,
    run: ({ params, server }) => {
      const requested = params.protocolVersion;
      const protocolVersion =
        typeof requested === 'string' && LEGACY_VERSIONS.includes(requested)
          ? requested
          : LEGACY_VERSIONS[0];
      return {
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: server.info,
          instructions: server.instructions,
        },
      };
    },
  },

  ping: {
    legacyOnly: true,
    run: () => ({ result: {} }),
  },

  'server/discover': {
    cacheable: true,
    run: ({ server }) => ({
      result: {
        supportedVersions: SUPPORTED_VERSIONS,
        capabilities: { tools: { listChanged: false } },
        instructions: server.instructions,
        serverInfo: server.info,
      },
    }),
  },

  'tools/list': {
    cacheable: true,
    run: ({ server }) => ({ result: { tools: describeTools(server.tools) } }),
  },

  'tools/call': {
    run: ({ params, server }) => {
      const tool = server.tools.find((candidate) => candidate.name === params.name);
      if (tool == null) {
        return {
          error: {
            code: ErrorCode.INVALID_PARAMS,
            message: `Unknown tool: ${String(params.name)}. Call tools/list for the available tools.`,
          },
        };
      }

      const args = params.arguments ?? {};
      if (!isObject(args)) {
        return { result: textResult('`arguments` must be a JSON object.', true) };
      }
      return { result: runTool(tool, args) };
    },
  },
};

//
// * Era Wrappers
//

function validateModern(message: Message, request: HttpRequest): HttpReply | undefined {
  const { id, method, params } = message;
  const headerVersion = request.header('MCP-Protocol-Version');
  const metaVersion = metaVersionOf(params);

  if (headerVersion == null) {
    return reject(400, id, ErrorCode.HEADER_MISMATCH, 'Missing MCP-Protocol-Version header');
  }
  if (metaVersion != null && metaVersion !== headerVersion) {
    return reject(
      400,
      id,
      ErrorCode.HEADER_MISMATCH,
      `MCP-Protocol-Version header '${headerVersion}' does not match _meta protocol version '${metaVersion}'`,
    );
  }
  if (headerVersion !== LATEST_VERSION) {
    return reject(400, id, ErrorCode.UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', {
      supported: SUPPORTED_VERSIONS,
      requested: headerVersion,
    });
  }
  if (metaVersion == null || !isObject(metaOf(params)?.[META_CAPABILITIES])) {
    return reject(
      400,
      id,
      ErrorCode.INVALID_PARAMS,
      `params._meta must carry '${META_VERSION}' and '${META_CAPABILITIES}'`,
    );
  }

  const methodHeader = request.header('Mcp-Method');
  if (methodHeader !== method) {
    return reject(
      400,
      id,
      ErrorCode.HEADER_MISMATCH,
      methodHeader == null
        ? 'Missing Mcp-Method header'
        : `Mcp-Method header '${methodHeader}' does not match method '${method}'`,
    );
  }

  if (method === 'tools/call') {
    const nameHeader = request.header('Mcp-Name');
    const name = nameHeader == null ? undefined : decodeHeaderValue(nameHeader);
    if (name !== params.name) {
      return reject(
        400,
        id,
        ErrorCode.HEADER_MISMATCH,
        nameHeader == null
          ? 'Missing Mcp-Name header'
          : `Mcp-Name header '${nameHeader}' does not match params.name '${String(params.name)}'`,
      );
    }
  }

  return undefined;
}

function modernResult(entry: MethodEntry, result: JsonObject, server: Server): JsonObject {
  return {
    ...result,
    ...(entry.cacheable && { ttlMs: CACHE_TTL_MS, cacheScope: 'private' }),
    resultType: 'complete',
    _meta: { [META_SERVER_INFO]: server.info },
  };
}

function dispatch(era: Era, message: Message, server: Server): HttpReply {
  const { id, method, params } = message;
  const entry = Object.hasOwn(METHODS, method) ? METHODS[method] : undefined;

  if (entry == null || (entry.legacyOnly && era === 'modern')) {
    // Modern clients read a 404 with -32601 as "method not here"; legacy ones expect 200.
    return reject(
      era === 'modern' ? 404 : 200,
      id,
      ErrorCode.METHOD_NOT_FOUND,
      `Unknown method: ${method}`,
    );
  }

  const outcome = entry.run({ params, server });
  if ('error' in outcome) return { status: 200, body: errorBody(id, outcome.error) };

  const result = era === 'modern' ? modernResult(entry, outcome.result, server) : outcome.result;
  return { status: 200, body: { jsonrpc: '2.0', id, result } };
}

//
// * Entry Point
//

export function handle(request: HttpRequest, server: Server): HttpReply {
  let payload: unknown;
  try {
    payload = JSON.parse(request.body ?? '');
  } catch {
    return reject(400, null, ErrorCode.PARSE_ERROR, 'Body is not valid JSON');
  }

  if (Array.isArray(payload)) {
    return reject(400, null, ErrorCode.INVALID_REQUEST, 'JSON-RPC batches are not supported');
  }

  if (!isObject(payload) || payload.jsonrpc !== '2.0' || typeof payload.method !== 'string') {
    const id = isObject(payload) ? toId(payload.id) : null;
    return reject(400, id, ErrorCode.INVALID_REQUEST, 'Not a JSON-RPC 2.0 request');
  }

  // A notification carries no id and gets no body.
  if (payload.id === undefined) return { status: 202 };

  if (payload.id !== null && typeof payload.id !== 'string' && typeof payload.id !== 'number') {
    return reject(400, null, ErrorCode.INVALID_REQUEST, '`id` must be a string, number or null');
  }

  if (payload.params !== undefined && !isObject(payload.params)) {
    return reject(400, toId(payload.id), ErrorCode.INVALID_REQUEST, '`params` must be an object');
  }

  const message: Message = {
    id: toId(payload.id),
    method: payload.method,
    params: payload.params ?? {},
  };

  const era = detectEra(request.header('MCP-Protocol-Version'), metaVersionOf(message.params));
  if (era === 'modern') {
    const invalid = validateModern(message, request);
    if (invalid != null) return invalid;
  }

  return dispatch(era, message, server);
}

function toId(value: unknown): JsonRpcId {
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}
