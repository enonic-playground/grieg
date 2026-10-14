import { log as auditLog } from '/lib/xp/auditlog';

import type { ToolsConfig } from './config';

import { userKey } from './run-as';

export type AuditTarget = { repository: string; branch: string; id: string };

// Called only after a write landed, so a failure here is logged and never fails the call.
export function auditWrite(
  config: ToolsConfig,
  tool: string,
  target: AuditTarget,
  fields: string[],
): void {
  try {
    auditLog({
      type: `grieg.mcp.${tool}`,
      user: userKey(config),
      // The URI form XP gives its own content entries, so one search by object finds both.
      objects: [`${target.repository}:${target.branch}:${target.id}`],
      data: { tool, fields },
    });
  } catch (e) {
    log.warning(`MCP could not write the audit log entry for ${tool}: ${String(e)}`);
  }
}
