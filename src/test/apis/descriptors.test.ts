import * as authLib from '/lib/xp/auth';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Request, Response } from '@enonic-types/core';

import * as crons from '../../main/resources/apis/crons/crons';
import * as system from '../../main/resources/apis/system/system';
import * as workflows from '../../main/resources/apis/workflows/workflows';

const RESOURCES = path.join(import.meta.dirname, '../../main/resources');
const APIS = path.join(RESOURCES, 'apis');

const hasRole = vi.mocked(authLib.hasRole);

// Reads the `allow:` list of a descriptor; the descriptors keep it as a flat list of quoted strings.
function allowOf(file: string): string[] | undefined {
  const text = readFileSync(file, 'utf8');
  const block = /^allow:\n((?:\s+- .+\n?)+)/m.exec(text)?.[1];
  return block?.match(/'[^']+'/g)?.map((entry) => entry.slice(1, -1));
}

function apiNames(): string[] {
  return readdirSync(APIS);
}

function request(params: Record<string, string> = {}): Request {
  return { params, body: '{"name":"x","enabled":true}' } as unknown as Request;
}

describe('API descriptors', () => {
  it('should declare an allow list on every API, so none inherits the admin tool’s', () => {
    for (const name of apiNames()) {
      expect(allowOf(path.join(APIS, name, `${name}.yaml`)), name).toBeDefined();
    }
  });

  it('should keep system, workflows and crons admin-only', () => {
    for (const name of ['system', 'workflows', 'crons']) {
      expect(allowOf(path.join(APIS, name, `${name}.yaml`)), name).toEqual(['role:system.admin']);
    }
  });

  it('should open the keys API and the admin tool to MCP role members and admins', () => {
    const both = ['role:com.enonic.app.grieg.mcp', 'role:system.admin'];
    expect(allowOf(path.join(APIS, 'keys/keys.yaml'))?.toSorted()).toEqual(both);
    expect(allowOf(path.join(RESOURCES, 'admin/tools/main/main.yaml'))?.toSorted()).toEqual(both);
  });
});

describe('admin-only APIs', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    hasRole.mockImplementation((role) => role === 'com.enonic.app.grieg.mcp');
  });

  const handlers: Record<string, (req: Request) => Response> = {
    'system GET': system.get,
    'workflows GET': workflows.get,
    'workflows POST': workflows.post,
    'workflows PUT': workflows.put,
    'workflows DELETE': workflows.delete,
    'crons GET': crons.get,
    'crons PUT': crons.put,
  };

  it.each(Object.entries(handlers))('should refuse %s to an MCP role member', (_name, handler) => {
    expect(handler(request({ id: 'wf-1', name: 'job' })).status).toBe(403);
  });
});
