import { useMemo, useState } from 'react';

import type { CronJob, ScheduleInput } from '../../lib/api/crons';

export type ScheduleDraft = {
  fields: ScheduleInput;
  // False while a workflow without a schedule has no cron: there is nothing to save yet.
  dirty: boolean;
  change: <K extends keyof ScheduleInput>(field: K, value: ScheduleInput[K]) => void;
  reset: () => void;
};

const FALLBACK_TIME_ZONE = 'UTC';

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIME_ZONE;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

// A workflow without a schedule starts from an empty cron in the browser's time zone.
function toFields(job: CronJob | null | undefined): ScheduleInput {
  if (job == null) return { cron: '', timeZone: browserTimeZone(), enabled: true };
  return {
    cron: job.cron ?? '',
    timeZone: job.timeZone ?? FALLBACK_TIME_ZONE,
    enabled: job.enabled,
  };
}

export function same(a: ScheduleInput, b: ScheduleInput): boolean {
  return a.cron.trim() === b.cron.trim() && a.timeZone === b.timeZone && a.enabled === b.enabled;
}

// Like the steps draft, a refetch or a save replaces the fields only while they are untouched.
export function useScheduleDraft(saved: CronJob | null | undefined): ScheduleDraft {
  const [fields, setFields] = useState(() => toFields(saved));
  const [seed, setSeed] = useState(saved);

  if (seed !== saved) {
    setSeed(saved);
    if (same(fields, toFields(seed))) setFields(toFields(saved));
  }

  const savedFields = useMemo(() => toFields(saved), [saved]);

  return {
    fields,
    dirty: !same(fields, savedFields) && (saved != null || fields.cron.trim() !== ''),
    change: (field, value) => setFields((current) => ({ ...current, [field]: value })),
    reset: () => setFields(savedFields),
  };
}
