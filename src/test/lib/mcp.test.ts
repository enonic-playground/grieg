import { describe, expect, it } from 'vitest';

import type { Tool } from '../../main/resources/lib/mcp';

import { dispatch, ErrorCode, PROTOCOL_VERSION } from '../../main/resources/lib/mcp';

const SERVER_INFO = { name: 'com.enonic.app.grieg', version: '1.0.0' };

const echo: Tool = {
  name: 'echo',
  description: 'Echoes its argument',
  inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
  handler: (args) => ({ echoed: args.value }),
};

const boom: Tool = {
  name: 'boom',
  description: 'Always throws',
  inputSchema: { type: 'object' },
  handler: () => {
    throw new Error('exploded');
  },
};

const TOOLS = [echo, boom];

function call(method: string, params?: Record<string, unknown>, id: number | null = 1) {
  return dispatch({ jsonrpc: '2.0', id, method, params }, TOOLS, SERVER_INFO);
}

describe('dispatch', () => {
  it('should answer initialize with the protocol version and server info', () => {
    const response = call('initialize');

    expect(response?.result).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
    });
  });

  it('should list tools without their handlers', () => {
    const response = call('tools/list');

    expect(response?.result).toEqual({
      tools: [
        { name: 'echo', description: echo.description, inputSchema: echo.inputSchema },
        { name: 'boom', description: boom.description, inputSchema: boom.inputSchema },
      ],
    });
  });

  it('should run a tool and wrap its return value as text content', () => {
    const response = call('tools/call', { name: 'echo', arguments: { value: 'hi' } });

    expect(response?.result).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ echoed: 'hi' }, null, 2) }],
      isError: false,
    });
  });

  it('should report a throwing tool as an error result, not a protocol error', () => {
    const response = call('tools/call', { name: 'boom', arguments: {} });

    expect(response?.error).toBeUndefined();
    expect(response?.result).toMatchObject({ isError: true });
  });

  it('should reject an unknown tool with INVALID_PARAMS', () => {
    const response = call('tools/call', { name: 'nope' });

    expect(response?.error?.code).toBe(ErrorCode.INVALID_PARAMS);
  });

  it('should reject an unknown method with METHOD_NOT_FOUND', () => {
    const response = call('tools/unknown');

    expect(response?.error?.code).toBe(ErrorCode.METHOD_NOT_FOUND);
  });

  it('should return nothing for a notification', () => {
    expect(call('notifications/initialized', undefined, null)).toBeUndefined();
  });
});
