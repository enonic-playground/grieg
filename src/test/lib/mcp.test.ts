import { describe, expect, it } from 'vitest';

import type { HttpReply, Server, Tool, UiResource } from '../../main/resources/lib/mcp';

import {
  decodeHeaderValue,
  detectEra,
  ErrorCode,
  handle,
  LATEST_VERSION,
  safeEqual,
  selectTools,
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
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
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

const CARD: UiResource = {
  uri: 'ui://grieg/echo',
  name: 'grieg-echo',
  title: 'Echo',
  description: 'Shows an echo',
  mimeType: 'text/html;profile=mcp-app',
  text: '<html><body>echo</body></html>',
  meta: { ui: { prefersBorder: true } },
};

const APPS_SERVER: Server = {
  ...SERVER,
  tools: [{ ...echo, ui: { resourceUri: CARD.uri } }, boom],
  resources: [CARD],
};

function send(body: unknown, headers: Record<string, string> = {}, server = SERVER): HttpReply {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return handle(
    {
      body: typeof body === 'string' ? body : JSON.stringify(body),
      header: (name) => lower[name.toLowerCase()],
    },
    server,
  );
}

function modern(
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
  server = SERVER,
): HttpReply {
  const named = params.name ?? params.uri;
  const name = typeof named === 'string' ? { 'Mcp-Name': named } : {};
  return send(
    { jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: MODERN_META } },
    { 'MCP-Protocol-Version': LATEST_VERSION, 'Mcp-Method': method, ...name, ...headers },
    server,
  );
}

function legacy(
  method: string,
  params?: Record<string, unknown>,
  headers = {},
  server = SERVER,
): HttpReply {
  return send({ jsonrpc: '2.0', id: 7, method, params }, headers, server);
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

  it('should reject a null id in the legacy era', () => {
    const reply = send(
      { jsonrpc: '2.0', id: null, method: 'tools/list' },
      { 'MCP-Protocol-Version': '2025-03-26' },
    );

    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: ErrorCode.INVALID_REQUEST, message: '`id` must be a string or number' },
    });
  });

  it('should reject a null id in the modern era', () => {
    const reply = send(
      { jsonrpc: '2.0', id: null, method: 'tools/list', params: { _meta: MODERN_META } },
      { 'MCP-Protocol-Version': LATEST_VERSION, 'Mcp-Method': 'tools/list' },
    );

    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: ErrorCode.INVALID_REQUEST, message: '`id` must be a string or number' },
    });
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

describe('handle: MCP Apps resources', () => {
  const capabilities = {
    tools: { listChanged: false },
    resources: {},
    extensions: { 'io.modelcontextprotocol/ui': {} },
  };
  const listed = {
    uri: CARD.uri,
    name: CARD.name,
    title: CARD.title,
    description: CARD.description,
    mimeType: CARD.mimeType,
    _meta: CARD.meta,
  };
  const contents = [{ uri: CARD.uri, mimeType: CARD.mimeType, text: CARD.text, _meta: CARD.meta }];

  it('should advertise resources and the UI extension on initialize and server/discover', () => {
    expect(result(legacy('initialize', {}, {}, APPS_SERVER)).capabilities).toEqual(capabilities);
    expect(result(modern('server/discover', {}, {}, APPS_SERVER)).capabilities).toEqual(
      capabilities,
    );
  });

  it('should list a tool with its view in _meta, nested, flat and as the ChatGPT alias', () => {
    const tools = result(legacy('tools/list', undefined, {}, APPS_SERVER)).tools as Record<
      string,
      unknown
    >[];

    expect(tools[0]._meta).toEqual({
      ui: { resourceUri: CARD.uri },
      'ui/resourceUri': CARD.uri,
      'openai/outputTemplate': CARD.uri,
    });
    expect(tools[1]).not.toHaveProperty('_meta');
  });

  it('should call a tool with a view exactly as one without', () => {
    const call = { name: 'echo', arguments: { value: 'hi' } };

    expect(legacy('tools/call', call, {}, APPS_SERVER)).toEqual(legacy('tools/call', call));
  });

  it('should list and read resources in the legacy era', () => {
    expect(result(legacy('resources/list', undefined, {}, APPS_SERVER))).toEqual({
      resources: [listed],
    });
    expect(result(legacy('resources/read', { uri: CARD.uri }, {}, APPS_SERVER))).toEqual({
      contents,
    });
  });

  it('should list and read resources in the modern era, cacheable and complete', () => {
    const list = result(modern('resources/list', {}, {}, APPS_SERVER));
    const read = result(modern('resources/read', { uri: CARD.uri }, {}, APPS_SERVER));

    expect(list.resources).toEqual([listed]);
    expect(read.contents).toEqual(contents);
    expect(list).toMatchObject({ ttlMs: 300_000, resultType: 'complete' });
    expect(read).toMatchObject({ ttlMs: 300_000, resultType: 'complete' });
  });

  it('should reject resources/read whose Mcp-Name does not match the uri', () => {
    const missing = send(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/read',
        params: { uri: CARD.uri, _meta: MODERN_META },
      },
      { 'MCP-Protocol-Version': LATEST_VERSION, 'Mcp-Method': 'resources/read' },
      APPS_SERVER,
    );
    const mismatched = modern(
      'resources/read',
      { uri: CARD.uri },
      { 'Mcp-Name': 'ui://grieg/other' },
      APPS_SERVER,
    );

    expect(missing.status).toBe(400);
    expect(error(missing)).toMatchObject({
      code: ErrorCode.HEADER_MISMATCH,
      message: 'Missing Mcp-Name header',
    });
    expect(mismatched.status).toBe(400);
    expect(error(mismatched).message).toBe(
      `Mcp-Name header 'ui://grieg/other' does not match params.uri '${CARD.uri}'`,
    );
  });

  it.each([
    ['legacy', () => legacy('resources/read', { uri: 'ui://grieg/nope' }, {}, APPS_SERVER)],
    ['modern', () => modern('resources/read', { uri: 'ui://grieg/nope' }, {}, APPS_SERVER)],
  ])('should answer an unknown uri with RESOURCE_NOT_FOUND in the %s era', (_era, read) => {
    const reply = read();

    expect(reply.status).toBe(200);
    expect(error(reply)).toEqual({
      code: ErrorCode.RESOURCE_NOT_FOUND,
      message: 'Resource not found',
      data: { uri: 'ui://grieg/nope' },
    });
  });

  it('should refuse a uri that is not a string with INVALID_PARAMS', () => {
    expect(error(legacy('resources/read', { uri: 7 }, {}, APPS_SERVER))).toEqual({
      code: ErrorCode.INVALID_PARAMS,
      message: '`uri` must be a string',
    });
  });

  it('should neither advertise nor answer resources on a server without any', () => {
    expect(result(legacy('initialize')).capabilities).toEqual({ tools: { listChanged: false } });
    expect(error(legacy('resources/list')).code).toBe(ErrorCode.METHOD_NOT_FOUND);
    expect(error(legacy('resources/read', { uri: CARD.uri })).code).toBe(
      ErrorCode.METHOD_NOT_FOUND,
    );
  });
});

describe('selectTools', () => {
  const write: Tool = {
    ...echo,
    name: 'write',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
  const toolsets = { content: [echo, write], nodes: [boom] };

  it('should list every tool of the enabled toolsets', () => {
    const { tools, disabledTools } = selectTools(toolsets, ['content', 'nodes'], false);

    expect(tools.map((t) => t.name)).toEqual(['echo', 'write', 'boom']);
    expect(disabledTools).toEqual({});
  });

  it('should unlist write tools when read-only and tools of toolsets not enabled', () => {
    const { tools, disabledTools } = selectTools(toolsets, ['content'], true);

    expect(tools.map((t) => t.name)).toEqual(['echo']);
    expect(disabledTools.write).toContain('`mcp.readOnly`');
    expect(disabledTools.boom).toContain('`nodes` toolset');
  });

  it('should refuse a call to a disabled tool with its reason instead of Unknown tool', () => {
    const { tools, disabledTools } = selectTools(toolsets, ['content'], true);
    const server: Server = { ...SERVER, tools, disabledTools };

    const reply = handle(
      {
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'write' },
        }),
        header: () => undefined,
      },
      server,
    );

    expect(result(reply)).toEqual({
      content: [{ type: 'text', text: disabledTools.write }],
      isError: true,
    });
  });
});
