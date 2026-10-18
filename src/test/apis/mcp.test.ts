import * as adminLib from '/lib/xp/admin';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Request } from '@enonic-types/core';

import { post } from '../../main/resources/apis/mcp/mcp';
import * as keysLib from '../../main/resources/lib/keys';

vi.mock('../../main/resources/lib/keys', () => ({ authenticate: vi.fn(), isAdmin: vi.fn() }));

const authenticate = vi.mocked(keysLib.authenticate);
const isAdmin = vi.mocked(keysLib.isAdmin);
const getToolUrl = vi.mocked(adminLib.getToolUrl);
const warning = vi.fn();

const KEY = `grieg_${'k'.repeat(43)}`;

const WORKFLOW_TOOLS = [
  'workflow_list',
  'workflow_run',
  'run_list',
  'run_get',
  'cron_list',
  'cron_set',
  'cron_delete',
];

function request(
  headers: Record<string, string>,
  body = '{"jsonrpc":"2.0","id":1,"method":"ping"}',
): Request {
  return {
    scheme: 'http',
    host: 'localhost',
    port: 8080,
    remoteAddress: '127.0.0.1',
    body,
    cookies: {},
    getHeader: (name: string) => headers[name] ?? null,
  } as unknown as Request;
}

function withConfig(config: Record<string, string> = {}): void {
  vi.stubGlobal('app', { name: 'com.enonic.app.grieg', version: '1.0.0', config });
}

type Reply = { result: Record<string, unknown> };

function rpc(method: string, params: Record<string, unknown> = {}): string {
  return JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
}

function call(auth: string, body: string): Reply {
  return JSON.parse(post(request({ Authorization: `Bearer ${auth}` }, body)).body as string);
}

function listedTools(auth: string): string[] {
  const { tools } = call(auth, rpc('tools/list')).result as { tools: { name: string }[] };
  return tools.map((tool) => tool.name);
}

function instructions(auth: string): string {
  return call(auth, rpc('initialize')).result.instructions as string;
}

function callTool(auth: string, name: string): { isError: boolean; text: string } {
  const { result } = call(auth, rpc('tools/call', { name, arguments: { workflowId: 'wf-1' } }));
  const content = result.content as { text: string }[];
  return { isError: result.isError as boolean, text: content[0].text };
}

beforeEach(() => {
  vi.resetAllMocks();
  withConfig();
  vi.stubGlobal('log', { warning, info: vi.fn(), error: vi.fn() });
  getToolUrl.mockReturnValue('/admin/tool/app/main');
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

describe('workflow toolset', () => {
  function owner(admin: boolean): void {
    authenticate.mockReturnValue({ login: 'alice', idProvider: 'system', admin });
  }

  it('should list every workflow tool and its instructions to an admin key owner', () => {
    owner(true);

    expect(listedTools(KEY)).toEqual(expect.arrayContaining(WORKFLOW_TOOLS));
    expect(instructions(KEY)).toContain('workflow_run');
  });

  it('should hide the toolset from a key owner who is not an admin, and say why on a call', () => {
    owner(false);

    expect(listedTools(KEY).filter((name) => WORKFLOW_TOOLS.includes(name))).toEqual([]);
    expect(instructions(KEY)).not.toContain('workflow_run');
    expect(callTool(KEY, 'workflow_run')).toEqual({
      isError: true,
      text: 'workflow_run requires role:system.admin, which user:system:alice does not hold.',
    });
  });

  it('should hide the toolset from a shared-token user who is not an admin', () => {
    withConfig({ 'mcp.token': 'shared', 'mcp.user': 'editor' });
    isAdmin.mockReturnValue(false);

    expect(listedTools('shared').filter((name) => WORKFLOW_TOOLS.includes(name))).toEqual([]);
    expect(isAdmin).toHaveBeenCalledWith('user:system:editor');
  });

  it('should list the toolset to a shared-token user who is an admin', () => {
    withConfig({ 'mcp.token': 'shared', 'mcp.user': 'editor' });
    isAdmin.mockReturnValue(true);

    expect(listedTools('shared')).toEqual(expect.arrayContaining(WORKFLOW_TOOLS));
  });

  it('should drop the write tools under mcp.readOnly', () => {
    withConfig({ 'mcp.readOnly': 'true' });
    owner(true);

    const listed = listedTools(KEY).filter((name) => WORKFLOW_TOOLS.includes(name));
    expect(listed).toEqual(['workflow_list', 'run_list', 'run_get', 'cron_list']);
  });

  it('should serve no workflow tools when mcp.toolsets leaves the toolset out', () => {
    withConfig({ 'mcp.toolsets': 'content,nodes' });
    owner(true);

    expect(listedTools(KEY).filter((name) => WORKFLOW_TOOLS.includes(name))).toEqual([]);
    expect(callTool(KEY, 'cron_list').text).toContain('`workflows` toolset');
  });
});
