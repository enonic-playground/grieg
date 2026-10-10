import { get as getContext, run } from '/lib/xp/context';

import type { ToolsConfig } from './config';
import type { ToolOutcome } from './mcp';

export type RunTarget = { repository: string; branch: string };

export function userKey(config: ToolsConfig): string {
  return `user:${config.idProvider}:${config.user}`;
}

// No `principals` override: the configured user's own permissions apply, and XP records
// that user as the modifier.
export function asConfiguredUser(
  config: ToolsConfig,
  target: RunTarget | undefined,
  callback: () => ToolOutcome,
): ToolOutcome {
  return run({ ...target, user: { login: config.user, idProvider: config.idProvider } }, () => {
    // XP falls back to anonymous without an error when the login is missing or disabled.
    const user = getContext().authInfo?.user;
    if (user?.login !== config.user || user.idProvider !== config.idProvider) {
      log.warning(`MCP tools could not run as ${userKey(config)}: user is missing or disabled`);
      return {
        ok: false,
        message:
          `The server could not act as ${userKey(config)}: the user is missing or disabled. ` +
          'An administrator must fix `mcp.user` / `mcp.idProvider` in the app config.',
      };
    }
    return callback();
  });
}
