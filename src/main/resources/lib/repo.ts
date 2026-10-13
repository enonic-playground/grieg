import { run } from '/lib/xp/context';
import { connect, type AccessControlEntry, type RepoConnection } from '/lib/xp/node';
import { create, get } from '/lib/xp/repo';

export const REPO_ID = 'com.enonic.app.grieg';
export const BRANCH = 'master';

const SU_PRINCIPAL = 'role:system.admin';

// Every store operation runs as admin in the app's own repo: the callers are either the
// admin tool (already authorized) or the MCP endpoint (authorized by its own token).
export function runInRepo<T>(callback: () => T): T {
  return run(
    {
      repository: REPO_ID,
      branch: BRANCH,
      principals: [SU_PRINCIPAL],
    },
    callback,
  );
}

export function getConnection(): RepoConnection {
  return connect({ repoId: REPO_ID, branch: BRANCH });
}

// Without an explicit list, lib-node grants `role:system.everyone` READ, and the MCP node
// tools run as non-admin users against this repository.
export const ADMIN_ONLY: AccessControlEntry[] = [
  {
    principal: SU_PRINCIPAL,
    allow: [
      'READ',
      'CREATE',
      'MODIFY',
      'DELETE',
      'PUBLISH',
      'READ_PERMISSIONS',
      'WRITE_PERMISSIONS',
    ],
  },
];

function aclKey(entries: AccessControlEntry[]): string {
  return entries
    .map(
      ({ principal, allow = [], deny = [] }) =>
        `${principal}:${[...allow].sort()}:${[...deny].sort()}`,
    )
    .sort()
    .join('|');
}

// Call inside `runInRepo`. Tolerates another cluster node creating the folder first, and
// resets a folder that already existed with any other ACL, its descendants included.
export function ensureAdminFolder(parentPath: string, name: string): void {
  const connection = getConnection();
  const path = parentPath === '/' ? `/${name}` : `${parentPath}/${name}`;
  if (!connection.exists(path)) {
    try {
      connection.create({ _name: name, _parentPath: parentPath, _permissions: ADMIN_ONLY });
    } catch (e) {
      if (!connection.exists(path)) throw e;
    }
  }
  const node = connection.get(path);
  if (node != null && aclKey(node._permissions ?? []) !== aclKey(ADMIN_ONLY)) {
    connection.applyPermissions({ key: path, permissions: ADMIN_ONLY, scope: 'TREE' });
    log.warning(`Reset ${path} in ${REPO_ID} and its descendants to admin-only permissions`);
  }
}

export function initRepo(): void {
  runInRepo(() => {
    if (get(REPO_ID) == null) {
      create({ id: REPO_ID });
      log.info(`Created repository ${REPO_ID}`);
    }
  });
}
