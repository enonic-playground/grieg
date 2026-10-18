import { log as auditLog } from '/lib/xp/auditlog';

import type { ToolsConfig } from './config';

import { userKey } from './run-as';

export type AuditTarget = { repository: string; branch: string; id: string } | { schedule: string };

// The URI form XP gives its own content entries, so one search by object finds both.
function objectOf(target: AuditTarget): string {
  if ('schedule' in target) return `scheduler:${target.schedule}`;
  return `${target.repository}:${target.branch}:${target.id}`;
}

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
      objects: [objectOf(target)],
      data: { tool, fields },
    });
  } catch (e) {
    log.warning(`MCP could not write the audit log entry for ${tool}: ${String(e)}`);
  }
}
