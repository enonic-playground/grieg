import * as nodeLib from '/lib/xp/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ADMIN_ONLY } from '../../main/resources/lib/repo';
import {
  WORKFLOWS_PATH,
  createWorkflow,
  initWorkflows,
  list,
} from '../../main/resources/lib/workflows';

const connect = vi.mocked(nodeLib.connect);

const connection = {
  exists: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  query: vi.fn(),
  applyPermissions: vi.fn(),
};

const LIB_NODE_DEFAULT = [
  { principal: 'role:system.admin', allow: ['READ', 'CREATE', 'MODIFY', 'DELETE'], deny: [] },
  { principal: 'role:system.everyone', allow: ['READ'], deny: [] },
];

// XP returns the allow list in its own order, so the check must not depend on it.
const STORED_ADMIN_ONLY = [
  {
    principal: 'role:system.admin',
    allow: [
      'WRITE_PERMISSIONS',
      'READ_PERMISSIONS',
      'PUBLISH',
      'DELETE',
      'MODIFY',
      'CREATE',
      'READ',
    ],
    deny: [],
  },
];

function withSubtree(parent: unknown[], children: unknown[][]): void {
  connection.exists.mockReturnValue(true);
  connection.query.mockReturnValue({
    total: children.length,
    count: children.length,
    hits: children.map((_, i) => ({ id: `c${i}` })),
  });
  connection.get.mockImplementation((key: string | string[]) =>
    key === WORKFLOWS_PATH
      ? { _id: 'p', _permissions: parent }
      : children.map((permissions, i) => ({ _id: `c${i}`, _permissions: permissions })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('log', { info: vi.fn(), warning: vi.fn() });
  for (const fn of Object.values(connection)) fn.mockReset();
  connect.mockReturnValue(connection as never);
});

describe('workflow store ACL', () => {
  it('should create the parent with the admin-only ACL', () => {
    connection.exists.mockReturnValue(false);
    connection.query.mockReturnValue({ total: 0, count: 0, hits: [] });
    connection.get.mockReturnValue({ _id: 'p', _permissions: ADMIN_ONLY });

    initWorkflows();

    expect(connection.create).toHaveBeenCalledWith({
      _name: 'workflows',
      _parentPath: '/',
      _permissions: ADMIN_ONLY,
    });
    expect(connection.applyPermissions).not.toHaveBeenCalled();
  });

  it('should create the parent with the ACL when a list call comes first', () => {
    connection.exists.mockReturnValue(false);
    connection.query.mockReturnValue({ total: 0, count: 0, hits: [] });

    list();

    expect(connection.create).toHaveBeenCalledWith(
      expect.objectContaining({ _name: 'workflows', _permissions: ADMIN_ONLY }),
    );
  });

  it('should make each workflow inherit the parent ACL', () => {
    connection.exists.mockReturnValue(true);
    connection.create.mockReturnValue({ _id: 'w1', _name: 'nightly' });

    createWorkflow({ name: 'nightly' });

    expect(connection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        _name: 'nightly',
        _parentPath: WORKFLOWS_PATH,
        _inheritsPermissions: true,
      }),
    );
  });

  it('should apply the ACL to the whole subtree of an install that has the lib-node default', () => {
    withSubtree(LIB_NODE_DEFAULT, [LIB_NODE_DEFAULT]);

    initWorkflows();

    expect(connection.applyPermissions).toHaveBeenCalledWith({
      key: WORKFLOWS_PATH,
      permissions: ADMIN_ONLY,
      scope: 'TREE',
    });
    expect(connection.create).not.toHaveBeenCalled();
  });

  it('should repair a child that kept the default while the parent is already restricted', () => {
    withSubtree(STORED_ADMIN_ONLY, [STORED_ADMIN_ONLY, LIB_NODE_DEFAULT]);

    initWorkflows();

    expect(connection.applyPermissions).toHaveBeenCalledOnce();
    expect(connection.applyPermissions).toHaveBeenCalledWith({
      key: WORKFLOWS_PATH,
      permissions: ADMIN_ONLY,
      scope: 'TREE',
    });
  });

  it('should leave an already restricted subtree untouched regardless of allow order', () => {
    withSubtree(STORED_ADMIN_ONLY, [STORED_ADMIN_ONLY, STORED_ADMIN_ONLY]);

    initWorkflows();

    expect(connection.applyPermissions).not.toHaveBeenCalled();
  });

  it('should query the subtree below the parent', () => {
    withSubtree(STORED_ADMIN_ONLY, [STORED_ADMIN_ONLY]);

    initWorkflows();

    expect(connection.query).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { like: { field: '_path', value: `${WORKFLOWS_PATH}/*` } },
      }),
    );
    expect(connection.get).toHaveBeenCalledWith(['c0']);
  });
});
