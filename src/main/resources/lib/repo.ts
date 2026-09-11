import { run } from '/lib/xp/context';
import { connect, type RepoConnection } from '/lib/xp/node';
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

export function initRepo(): void {
  runInRepo(() => {
    if (get(REPO_ID) == null) {
      create({ id: REPO_ID });
      log.info(`Created repository ${REPO_ID}`);
    }
  });
}
