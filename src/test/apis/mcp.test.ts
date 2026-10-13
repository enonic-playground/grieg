import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Request } from '@enonic-types/core';

import { post } from '../../main/resources/apis/mcp/mcp';
import * as keysLib from '../../main/resources/lib/keys';

vi.mock('../../main/resources/lib/keys', () => ({ authenticate: vi.fn() }));

const authenticate = vi.mocked(keysLib.authenticate);
const warning = vi.fn();

const KEY = `grieg_${'k'.repeat(43)}`;

function request(headers: Record<string, string>): Request {
  return {
    scheme: 'http',
    host: 'localhost',
    port: 8080,
    remoteAddress: '127.0.0.1',
    body: '{"jsonrpc":"2.0","id":1,"method":"ping"}',
    cookies: {},
    getHeader: (name: string) => headers[name] ?? null,
  } as unknown as Request;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('app', { name: 'com.enonic.app.grieg', version: '1.0.0', config: {} });
  vi.stubGlobal('log', { warning, info: vi.fn(), error: vi.fn() });
});

describe('MCP endpoint', () => {
  it('should answer a clean, logged 503 when the key lookup throws', () => {
    authenticate.mockImplementation(() => {
      throw new Error(`repository unavailable while reading ${KEY}`);
    });

    const response = post(request({ Authorization: `Bearer ${KEY}` }));

    expect(response.status).toBe(503);
    expect(JSON.parse(response.body as string)).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32_600, message: 'Key lookup failed, try again later' },
    });
    expect(warning).toHaveBeenCalledTimes(1);
    const logged = String(warning.mock.calls[0][0]);
    expect(logged).toContain('MCP key lookup failed: Error: repository unavailable');
    expect(logged).not.toContain(KEY);
  });
});
