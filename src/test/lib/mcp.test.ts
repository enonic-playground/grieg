import { describe, expect, it } from 'vitest';

import type { HttpReply, Server, Tool } from '../../main/resources/lib/mcp';

import {
  decodeHeaderValue,
  detectEra,
  ErrorCode,
  handle,
  LATEST_VERSION,
  safeEqual,
  SUPPORTED_VERSIONS,
} from '../../main/resources/lib/mcp';

const INFO = {
  name: 'com.enonic.app.grieg',
  title: 'Grieg',
  version: '1.0.0',
  description: 'Test server',
};

const echo: Tool = {
  name: 'echo',
  title: 'Echo',
  description: 'Echoes its argument',
  inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
  outputSchema: { type: 'object', properties: { echoed: { type: 'string' } } },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: (args) =>
    typeof args.value === 'string'
      ? { ok: true, value: { echoed: args.value } }
      : { ok: false, message: 'value must be a string' },
};

const boom: Tool = {
  ...echo,
  name: 'boom',
  title: 'Boom',
  handler: () => {
    throw new Error('exploded');
  },
};

const SERVER: Server = { info: INFO, instructions: 'Use the tools.', tools: [echo, boom] };

const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': LATEST_VERSION,
  'io.modelcontextprotocol/clientCapabilities': {},
};

function send(body: unknown, headers: Record<string, string> = {}): HttpReply {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return handle(
    {
      body: typeof body === 'string' ? body : JSON.stringify(body),
      header: (name) => lower[name.toLowerCase()],
    },
    SERVER,
  );
}

function modern(
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): HttpReply {
  const name = typeof params.name === 'string' ? { 'Mcp-Name': params.name } : {};
  return send(
    { jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: MODERN_META } },
    { 'MCP-Protocol-Version': LATEST_VERSION, 'Mcp-Method': method, ...name, ...headers },
  );
}

function legacy(method: string, params?: Record<string, unknown>, headers = {}): HttpReply {
  return send({ jsonrpc: '2.0', id: 7, method, params }, headers);
}

function result(reply: HttpReply): Record<string, unknown> {
  return reply.body?.result as Record<string, unknown>;
}

function error(reply: HttpReply): { code: number; message: string; data?: unknown } {
  return reply.body?.error as { code: number; message: string; data?: unknown };
}

describe('detectEra', () => {
  it('should treat a request with no version as legacy', () => {
    expect(detectEra(undefined, undefined)).toBe('legacy');
  });

  it('should treat a legacy header version as legacy', () => {
    expect(detectEra('2025-11-25', undefined)).toBe('legacy');
  });

  it('should treat the latest header version as modern', () => {
    expect(detectEra(LATEST_VERSION, undefined)).toBe('modern');
  });

  it('should fall back to the _meta version when there is no header', () => {
    expect(detectEra(undefined, LATEST_VERSION)).toBe('modern');
  });

  it('should treat an unknown version as modern so it can be rejected', () => {
    expect(detectEra('2099-01-01', undefined)).toBe('modern');
  });
});

describe('decodeHeaderValue', () => {
  it('should pass a plain value through', () => {
    expect(decodeHeaderValue('content_search')).toBe('content_search');
  });

  it('should decode the base64 sentinel form as UTF-8', () => {
    expect(decodeHeaderValue('=?base64?SGVsbG8sIOS4lueVjA==?=')).toBe('Hello, 世界');
  });

  it.each([
    ['no suffix', '=?base64?SGVsbG8'],
    ['invalid characters', '=?base64?***?='],
    ['an impossible length', '=?base64?SGVsb?='],
    ['invalid UTF-8', '=?base64?/w==?='],
  ])('should reject a sentinel with %s', (_label, value) => {
    expect(decodeHeaderValue(value)).toBeUndefined();
  });
});

describe('safeEqual', () => {
  it('should match only identical strings', () => {
    expect(safeEqual('dev-token', 'dev-token')).toBe(true);
    expect(safeEqual('dev-token', 'dev-tokem')).toBe(false);
    expect(safeEqual('dev-token', 'dev-token-longer')).toBe(false);
    expect(safeEqual('', 'x')).toBe(false);
  });
});

describe('handle: transport', () => {
  it('should reject a body that is not JSON with 400 and PARSE_ERROR', () => {
    const reply = send('{nope');

    expect(reply.status).toBe(400);
    expect(error(reply).code).toBe(ErrorCode.PARSE_ERROR);
  });

  it('should reject a batch with 400 and INVALID_REQUEST', () => {
    const reply = send([{ jsonrpc: '2.0', id: 1, method: 'ping' }]);

    expect(reply.status).toBe(400);
    expect(error(reply).code).toBe(ErrorCode.INVALID_REQUEST);
  });

  it('should reject a message without jsonrpc 2.0 and keep its id', () => {
    const reply = send({ id: 3, method: 'ping' });

    expect(reply.status).toBe(400);
    expect(reply.body).toMatchObject({ id: 3, error: { code: ErrorCode.INVALID_REQUEST } });
  });

  it.each([
    ['an object', { a: 1 }],
    ['a boolean', true],
  ])('should reject %s as the id', (_label, id) => {
    const reply = send({ jsonrpc: '2.0', id, method: 'ping' });

    expect(reply.status).toBe(400);
    expect(reply.body).toMatchObject({ id: null, error: { code: ErrorCode.INVALID_REQUEST } });
  });

  it('should reject non-object params', () => {
    const reply = send({ jsonrpc: '2.0', id: 4, method: 'ping', params: [1] });

    expect(reply.status).toBe(400);
    expect(reply.body).toMatchObject({ id: 4, error: { code: ErrorCode.INVALID_REQUEST } });
  });

  it('should accept a notification with 202 and no body', () => {
    const reply = send(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { 'MCP-Protocol-Version': '2025-11-25' },
    );

    expect(reply).toEqual({ status: 202 });
  });
});

describe('handle: legacy era', () => {
  it('should echo a supported requested version on initialize', () => {
    const reply = legacy('initialize', { protocolVersion: '2025-06-18' });

    expect(reply.status).toBe(200);
    expect(result(reply)).toEqual({
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: INFO,
      instructions: 'Use the tools.',
    });
  });

  it('should answer 2025-11-25 to an unsupported requested version', () => {
    const reply = legacy('initialize', { protocolVersion: '2024-11-05' });

    expect(result(reply).protocolVersion).toBe('2025-11-25');
  });

  it('should answer ping with an empty result', () => {
    expect(result(legacy('ping'))).toEqual({});
  });

  it('should list tools with title, schemas and annotations, without the handler', () => {
    const reply = legacy('tools/list', undefined, { 'MCP-Protocol-Version': '2025-11-25' });
    const tools = result(reply).tools as Record<string, unknown>[];

    expect(result(reply)).not.toHaveProperty('resultType');
    expect(result(reply)).not.toHaveProperty('ttlMs');
    expect(tools[0]).toEqual({
      name: 'echo',
      title: 'Echo',
      description: echo.description,
      inputSchema: echo.inputSchema,
      outputSchema: echo.outputSchema,
      annotations: { title: 'Echo', ...echo.annotations },
    });
  });

  it('should run a tool with Claude Code v1 _meta and return structured and text content', () => {
    const reply = legacy(
      'tools/call',
      {
        name: 'echo',
        arguments: { value: 'hi' },
        _meta: { 'claudecode/toolUseId': 'toolu_1', progressToken: 2 },
      },
      { 'MCP-Protocol-Version': '2025-11-25' },
    );

    expect(reply.status).toBe(200);
    expect(result(reply)).toEqual({
      content: [{ type: 'text', text: '{"echoed":"hi"}' }],
      isError: false,
      structuredContent: { echoed: 'hi' },
    });
  });

  it('should report a failed outcome as an isError result without structured content', () => {
    const reply = legacy('tools/call', { name: 'echo', arguments: { value: 1 } });

    expect(result(reply)).toEqual({
      content: [{ type: 'text', text: 'value must be a string' }],
      isError: true,
    });
  });

  it('should report a throwing tool as an isError result naming the tool', () => {
    const reply = legacy('tools/call', { name: 'boom', arguments: {} });

    expect(reply.body?.error).toBeUndefined();
    expect(result(reply)).toMatchObject({
      isError: true,
      content: [{ text: 'boom failed: exploded' }],
    });
  });

  it('should report non-object arguments as an isError result', () => {
    const reply = legacy('tools/call', { name: 'echo', arguments: 'hi' });

    expect(result(reply)).toEqual({
      content: [{ type: 'text', text: '`arguments` must be a JSON object.' }],
      isError: true,
    });
  });

  it('should reject an unknown tool with INVALID_PARAMS', () => {
    const reply = legacy('tools/call', { name: 'nope' });

    expect(reply.status).toBe(200);
    expect(error(reply).code).toBe(ErrorCode.INVALID_PARAMS);
  });

  it('should reject an unknown method with 200 and METHOD_NOT_FOUND', () => {
    const reply = legacy('resources/list');

    expect(reply.status).toBe(200);
    expect(error(reply).code).toBe(ErrorCode.METHOD_NOT_FOUND);
  });

  it('should not treat an inherited property name as a method', () => {
    expect(error(legacy('toString')).code).toBe(ErrorCode.METHOD_NOT_FOUND);
  });
});

describe('handle: modern era', () => {
  const serverInfoMeta = { 'io.modelcontextprotocol/serverInfo': INFO };

  it('should answer server/discover with versions, capabilities, instructions and cache hints', () => {
    const reply = modern('server/discover');

    expect(reply.status).toBe(200);
    expect(result(reply)).toEqual({
      supportedVersions: SUPPORTED_VERSIONS,
      capabilities: { tools: { listChanged: false } },
      instructions: 'Use the tools.',
      serverInfo: INFO,
      ttlMs: 300_000,
      cacheScope: 'private',
      resultType: 'complete',
      _meta: serverInfoMeta,
    });
  });

  it('should mark tools/list as cacheable and complete', () => {
    const reply = modern('tools/list');

    expect(result(reply)).toMatchObject({
      ttlMs: 300_000,
      cacheScope: 'private',
      resultType: 'complete',
      _meta: serverInfoMeta,
    });
    expect(result(reply).tools).toHaveLength(2);
  });

  it('should run a tool and mark the result complete without cache hints', () => {
    const reply = modern('tools/call', { name: 'echo', arguments: { value: 'hi' } });

    expect(result(reply)).toEqual({
      content: [{ type: 'text', text: '{"echoed":"hi"}' }],
      isError: false,
      structuredContent: { echoed: 'hi' },
      resultType: 'complete',
      _meta: serverInfoMeta,
    });
  });

  it('should accept a base64-encoded Mcp-Name', () => {
    const reply = modern(
      'tools/call',
      { name: 'echo', arguments: { value: 'hi' } },
      { 'Mcp-Name': '=?base64?ZWNobw==?=' },
    );

    expect(reply.status).toBe(200);
    expect(result(reply)).toMatchObject({ isError: false, structuredContent: { echoed: 'hi' } });
  });

  it.each([
    ['initialize', {}],
    ['ping', {}],
    ['resources/list', {}],
  ])('should answer %s with 404 and METHOD_NOT_FOUND', (method, params) => {
    const reply = modern(method, params);

    expect(reply.status).toBe(404);
    expect(error(reply).code).toBe(ErrorCode.METHOD_NOT_FOUND);
  });

  it('should reject an unsupported version with 400, UNSUPPORTED_PROTOCOL_VERSION and the supported list', () => {
    const reply = send(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2099-01-01',
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      },
      { 'MCP-Protocol-Version': '2099-01-01', 'Mcp-Method': 'tools/list' },
    );

    expect(reply.status).toBe(400);
    expect(error(reply)).toMatchObject({
      code: ErrorCode.UNSUPPORTED_PROTOCOL_VERSION,
      data: { supported: SUPPORTED_VERSIONS, requested: '2099-01-01' },
    });
  });

  it('should reject a header version that disagrees with _meta with HEADER_MISMATCH', () => {
    const reply = send(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2025-11-25',
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      },
      { 'MCP-Protocol-Version': LATEST_VERSION, 'Mcp-Method': 'tools/list' },
    );

    expect(reply.status).toBe(400);
    expect(error(reply).code).toBe(ErrorCode.HEADER_MISMATCH);
  });

  it('should let a legacy header decide the era over a modern _meta version', () => {
    const reply = modern('tools/list', {}, { 'MCP-Protocol-Version': '2025-11-25' });

    expect(reply.status).toBe(200);
    expect(result(reply)).not.toHaveProperty('resultType');
  });

  it('should reject a missing Mcp-Method header', () => {
    const reply = send(
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: MODERN_META } },
      { 'MCP-Protocol-Version': LATEST_VERSION },
    );

    expect(reply.status).toBe(400);
    expect(error(reply)).toMatchObject({
      code: ErrorCode.HEADER_MISMATCH,
      message: 'Missing Mcp-Method header',
    });
  });

  it('should reject a missing MCP-Protocol-Version header when _meta names the latest version', () => {
    const reply = send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: { _meta: MODERN_META },
    });

    expect(reply.status).toBe(400);
    expect(error(reply).code).toBe(ErrorCode.HEADER_MISMATCH);
  });

  it.each([
    ['no _meta', {}],
    [
      'no client capabilities',
      { _meta: { 'io.modelcontextprotocol/protocolVersion': LATEST_VERSION } },
    ],
  ])('should reject a modern request with %s as INVALID_PARAMS', (_label, params) => {
    const reply = send(
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params },
      { 'MCP-Protocol-Version': LATEST_VERSION, 'Mcp-Method': 'tools/list' },
    );

    expect(reply.status).toBe(400);
    expect(error(reply).code).toBe(ErrorCode.INVALID_PARAMS);
  });

  it('should reject an Mcp-Method header that does not match the method', () => {
    const reply = modern('tools/list', {}, { 'Mcp-Method': 'tools/call' });

    expect(reply.status).toBe(400);
    expect(error(reply).code).toBe(ErrorCode.HEADER_MISMATCH);
  });

  it.each([
    ['a mismatched', { 'Mcp-Name': 'boom' }, "Mcp-Name header 'boom' does not match"],
    ['a missing', { 'Mcp-Name': '' }, 'Missing Mcp-Name header'],
  ])('should reject %s Mcp-Name on tools/call', (_label, headers, message) => {
    const reply = send(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', _meta: MODERN_META } },
      {
        'MCP-Protocol-Version': LATEST_VERSION,
        'Mcp-Method': 'tools/call',
        ...(headers['Mcp-Name'] === '' ? {} : headers),
      },
    );

    expect(reply.status).toBe(400);
    expect(error(reply)).toMatchObject({ code: ErrorCode.HEADER_MISMATCH });
    expect(error(reply).message).toContain(message);
  });

  it('should reject an unknown tool with INVALID_PARAMS', () => {
    const reply = modern('tools/call', { name: 'nope' });

    expect(error(reply).code).toBe(ErrorCode.INVALID_PARAMS);
  });
});
