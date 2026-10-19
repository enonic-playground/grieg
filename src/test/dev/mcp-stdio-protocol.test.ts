import { describe, expect, it } from 'vitest';

import type { JsonRpcMessage, Session } from '../../../dev/mcp-stdio-protocol.ts';
import type { HttpReply, Server, Tool } from '../../main/resources/lib/mcp';

import {
  createSession,
  createSseParser,
  encodeHeaderValue,
  headersFor,
  isHeaderValue,
  isJsonRpcMessage,
  outgoingVersion,
  recordResponse,
  replyFor,
  resolveToken,
  TRANSPORT_ERROR,
} from '../../../dev/mcp-stdio-protocol.ts';
import {
  decodeHeaderValue,
  handle,
  LATEST_VERSION,
  LEGACY_VERSIONS,
} from '../../main/resources/lib/mcp';

const echo: Tool = {
  name: 'echo',
  title: 'Echo',
  description: 'Echoes its argument',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args) => ({ ok: true, value: { echoed: args.value } }),
};

const SERVER: Server = {
  info: { name: 'grieg', title: 'Grieg', version: '1.0.0', description: 'Test' },
  instructions: 'Use the tools.',
  tools: [echo, { ...echo, name: 'écho' }],
};

const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': LATEST_VERSION,
  'io.modelcontextprotocol/clientCapabilities': {},
};

// Written by hand, not imported: what an HTTP header value may hold.
const HEADER_VALUE = /^(?:[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?)?$/;

// Sends a message through the forwarder's header logic into the server's real `handle()`.
function forward(session: Session, message: JsonRpcMessage): HttpReply {
  const headers = headersFor(message, outgoingVersion(session, message), 'Bearer t');
  for (const value of Object.values(headers)) expect(value).toMatch(HEADER_VALUE);
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const reply = handle(
    { body: JSON.stringify(message), header: (name) => lower[name.toLowerCase()] },
    SERVER,
  );
  recordResponse(session, message, reply.body);
  return reply;
}

describe('forwarder headers against handle()', () => {
  const modernCall = (id: number, method: string, params: Record<string, unknown> = {}) =>
    forward(createSession(), {
      jsonrpc: '2.0',
      id,
      method,
      params: { ...params, _meta: MODERN_META },
    });

  it('should be accepted for modern server/discover and tools/list', () => {
    const discover = modernCall(1, 'server/discover');
    expect(discover.status).toBe(200);
    expect(discover.body?.result).toMatchObject({ resultType: 'complete' });

    const list = modernCall(2, 'tools/list');
    expect(list.status).toBe(200);
    expect(list.body?.result).toMatchObject({ resultType: 'complete' });
  });

  it.each(['echo', 'écho'])('should be accepted for a modern tools/call of %j', (name) => {
    const reply = modernCall(3, 'tools/call', { name, arguments: { value: 'x' } });

    expect(reply.status).toBe(200);
    expect(reply.body?.result).toMatchObject({
      isError: false,
      structuredContent: { echoed: 'x' },
    });
  });

  it.each(LEGACY_VERSIONS)('should be accepted for a legacy session at %s', (requested) => {
    const session = createSession();

    const init = forward(session, {
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: requested, capabilities: {}, clientInfo: { name: 'c' } },
    });
    expect(init.body?.result).toMatchObject({ protocolVersion: requested });
    expect(session.version).toBe(requested);

    const list = forward(session, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tools = (list.body?.result as { tools?: { name: string }[] } | undefined)?.tools;
    expect(tools?.map((tool) => tool.name)).toEqual(['echo', 'écho']);

    // Claude Code's legacy runtime sends `_meta` on tools/call, but without a version.
    const reply = forward(session, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'écho', arguments: { value: 'y' }, _meta: { progressToken: 2 } },
    });
    expect(reply.body?.result).toMatchObject({
      isError: false,
      structuredContent: { echoed: 'y' },
    });
  });

  it('should carry the last _meta version on messages without one', () => {
    const session = createSession();
    outgoingVersion(session, { method: 'tools/list', params: { _meta: MODERN_META } });

    expect(outgoingVersion(session, { method: 'notifications/initialized' })).toBe(LATEST_VERSION);
  });

  it('should send initialize without a version after a modern discover', () => {
    const session = createSession();
    forward(session, {
      jsonrpc: '2.0',
      id: 1,
      method: 'server/discover',
      params: { _meta: MODERN_META },
    });
    const message = { jsonrpc: '2.0', id: 2, method: 'initialize', params: {} };

    expect(headersFor(message, outgoingVersion(session, message), undefined)).not.toHaveProperty(
      'MCP-Protocol-Version',
    );
    expect(forward(session, message).body?.result).toMatchObject({
      protocolVersion: LEGACY_VERSIONS[0],
    });
    expect(session.version).toBe(LEGACY_VERSIONS[0]);
  });
});

describe('headersFor', () => {
  it('should name the target of resources/read and prompts/get', () => {
    expect(
      headersFor({ method: 'resources/read', params: { uri: 'file:///a' } }, undefined, undefined),
    ).toMatchObject({ 'Mcp-Method': 'resources/read', 'Mcp-Name': 'file:///a' });
    expect(
      headersFor({ method: 'prompts/get', params: { name: 'p' } }, undefined, undefined),
    ).toMatchObject({ 'Mcp-Name': 'p' });
  });

  it('should leave out Mcp-Name for other methods and absent names', () => {
    expect(
      headersFor({ method: 'tools/list', params: { name: 'x' } }, '1', 'B'),
    ).not.toHaveProperty('Mcp-Name');
    expect(headersFor({ method: 'tools/call', params: {} }, '1', 'B')).not.toHaveProperty(
      'Mcp-Name',
    );
  });

  it('should set Authorization, the version and Mcp-Method when given', () => {
    expect(headersFor({ method: 'tools/list' }, '1', 'Bearer x')).toMatchObject({
      Authorization: 'Bearer x',
      'MCP-Protocol-Version': '1',
      'Mcp-Method': 'tools/list',
    });
  });

  it('should leave out Authorization and the version when there are none', () => {
    const headers = headersFor({ method: 'tools/list' }, undefined, undefined);

    expect(headers).not.toHaveProperty('Authorization');
    expect(headers).not.toHaveProperty('MCP-Protocol-Version');
    expect(headers.Accept).toBe('application/json, text/event-stream');
  });
});

describe('encodeHeaderValue', () => {
  it.each(['echo', 'a b', 'résumé', ' padded', 'tab\there', '日本語', ''])(
    'should round-trip %j through the server decoder',
    (value) => {
      const encoded = encodeHeaderValue(value);

      expect(encoded).toMatch(HEADER_VALUE);
      expect(decodeHeaderValue(encoded)).toBe(value);
    },
  );

  it('should keep visible ASCII with inner spaces as is', () => {
    expect(encodeHeaderValue('content_search')).toBe('content_search');
    expect(encodeHeaderValue('a b')).toBe('a b');
  });

  it('should base64-encode non-ASCII and edge whitespace', () => {
    expect(encodeHeaderValue('é')).toBe('=?base64?w6k=?=');
    expect(encodeHeaderValue(' padded')).toBe('=?base64?IHBhZGRlZA==?=');
    expect(encodeHeaderValue('tab\there')).toBe('=?base64?dGFiCWhlcmU=?=');
  });
});

describe('isHeaderValue', () => {
  it.each(['abc-123_.~+/=', 'é', 'tab\there', ' padded '])('should accept %j', (value) => {
    expect(isHeaderValue(value)).toBe(true);
  });

  // fetch rejects these when sending, though `new Headers` accepts the C0 and DEL ones.
  it.each([
    'line\nbreak',
    'carriage\rreturn',
    'nul\0',
    'soh\u0001',
    'bs\b',
    'us\u001f',
    'del\u007f',
    '日本',
  ])('should reject %j', (value) => {
    expect(isHeaderValue(value)).toBe(false);
  });
});

describe('isJsonRpcMessage', () => {
  it('should accept responses, requests and notifications', () => {
    expect(isJsonRpcMessage({ jsonrpc: '2.0', id: 1, result: {} })).toBe(true);
    expect(isJsonRpcMessage({ jsonrpc: '2.0', method: 'notifications/progress' })).toBe(true);
  });

  it.each([42, 'x', null, [], { x: 1 }, { jsonrpc: '1.0', id: 1, result: {} }])(
    'should reject %j',
    (value) => {
      expect(isJsonRpcMessage(value)).toBe(false);
    },
  );
});

describe('resolveToken', () => {
  const noFile = () => {
    throw new Error('not read');
  };

  it('should prefer MCP_TOKEN', () => {
    expect(resolveToken({ MCP_TOKEN: 'a', MCP_TOKEN_FILE: 'f' }, noFile)).toBe('a');
  });

  it('should trim MCP_TOKEN as it trims the file', () => {
    expect(resolveToken({ MCP_TOKEN: ' a\n' }, noFile)).toBe('a');
  });

  it('should read a bare token file', () => {
    expect(resolveToken({ MCP_TOKEN_FILE: 'f' }, () => '  secret\n')).toBe('secret');
  });

  it('should read mcp.token from an XP config', () => {
    const cfg = '# comment\nmcp.user = editor\r\n  mcp.token = s=cret \nmcp.project = default\n';
    expect(resolveToken({ MCP_TOKEN_FILE: 'f' }, () => cfg)).toBe('s=cret');
  });

  it('should return undefined when nothing is set or the file is empty', () => {
    expect(resolveToken({}, noFile)).toBeUndefined();
    expect(resolveToken({ MCP_TOKEN_FILE: 'f' }, () => '\n')).toBeUndefined();
  });
});

describe('replyFor', () => {
  it('should produce nothing for 202 and 204', () => {
    expect(replyFor(202, 'Accepted', '', 1)).toBeUndefined();
    expect(replyFor(204, 'No Content', '', 1)).toBeUndefined();
  });

  it('should pass a JSON-RPC body through whatever the status', () => {
    const body = { jsonrpc: '2.0', id: 1, error: { code: -32_020, message: 'Missing header' } };
    expect(replyFor(400, 'Bad Request', JSON.stringify(body), 1)).toEqual(body);
  });

  it('should map an HTML 401 to a JSON-RPC error carrying the request id', () => {
    expect(replyFor(401, 'Unauthorized', '<html>login</html>', 'abc')).toEqual({
      jsonrpc: '2.0',
      id: 'abc',
      error: { code: TRANSPORT_ERROR, message: 'HTTP 401 Unauthorized', data: { status: 401 } },
    });
  });

  it('should map JSON that is not a JSON-RPC response to an error', () => {
    expect(replyFor(500, '', '{"message":"oops"}', 3)).toMatchObject({
      id: 3,
      error: { code: TRANSPORT_ERROR, message: 'HTTP 500' },
    });
  });
});

describe('createSseParser', () => {
  it('should join multi-line data and skip other fields', () => {
    const parser = createSseParser();

    expect(parser.push('event: message\nid: 1\ndata: {"a":\ndata: 1}\n\n')).toEqual(['{"a":\n1}']);
  });

  it('should accept CRLF split across chunks', () => {
    const parser = createSseParser();

    expect(parser.push('data: one\r')).toEqual([]);
    expect(parser.push('\n\r')).toEqual(['one']);
    expect(parser.push('\ndata: two\r\n\r\n')).toEqual(['two']);
  });

  it('should not read a CRLF split inside an event as two line breaks', () => {
    const parser = createSseParser();

    expect(parser.push('data: a\r')).toEqual([]);
    expect(parser.push('\ndata: b\r\n\r\n')).toEqual(['a\nb']);
  });

  it('should keep a partial line until the next chunk', () => {
    const parser = createSseParser();

    expect(parser.push('da')).toEqual([]);
    expect(parser.push('ta:x\n')).toEqual([]);
    expect(parser.push('\n')).toEqual(['x']);
  });

  it('should flush an unterminated event at the end', () => {
    const parser = createSseParser();
    parser.push('data: last');

    expect(parser.end()).toEqual(['last']);
  });

  it('should ignore comments and events without data', () => {
    const parser = createSseParser();

    expect(parser.push(': keep-alive\n\nevent: ping\n\n')).toEqual([]);
  });
});
