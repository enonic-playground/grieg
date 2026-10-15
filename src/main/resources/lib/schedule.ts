// Shared by `apis/crons` and the dev mock, so it imports nothing from XP.

export const DEFAULT_TIME_ZONE = 'UTC';

export type ScheduleInput = {
  cron?: string;
  timeZone?: string;
  enabled?: boolean;
};

// One job per workflow, so the name is derived and the workflow page needs no lookup.
export function scheduleName(workflowId: string): string {
  return `grieg-workflow-${workflowId}`;
}

// lib-scheduler parses cron-utils' UNIX format and has the final say on each field; this only
// catches what is plainly not a five-field expression, with a message that says so.
const CRON_FIELD = /^[0-9A-Za-z*,/?#-]+$/;

export function cronError(cron: unknown): string | undefined {
  if (typeof cron !== 'string') return '`cron` must be a string';
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5 || !fields.every((field) => CRON_FIELD.test(field))) {
    return 'A cron expression has five fields: minute, hour, day of month, month, day of week';
  }
  return undefined;
}

// Checks types and the cron shape; whether a time zone exists is the caller's to check.
export function scheduleInputError(input: unknown, required: boolean): string | undefined {
  if (input == null || typeof input !== 'object') return 'Body must be a JSON object';
  const { cron, timeZone, enabled } = input as Record<string, unknown>;
  if (cron === undefined && timeZone === undefined && enabled === undefined) {
    return 'Body must set `cron`, `timeZone` or `enabled`';
  }
  if (required || cron !== undefined) {
    const invalid = cronError(cron);
    if (invalid != null) return invalid;
  }
  if (timeZone !== undefined && (typeof timeZone !== 'string' || timeZone === '')) {
    return '`timeZone` must be a time zone id';
  }
  if (enabled !== undefined && typeof enabled !== 'boolean') return '`enabled` must be a boolean';
  return undefined;
}
