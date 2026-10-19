export type TimelineState = 'done' | 'running' | 'pending' | 'failed' | 'skipped';

export type TimelineStep = {
  id: string;
  state: TimelineState;
  ms?: number;
  output?: string;
  error?: string;
  truncated?: boolean;
  // Epoch ms the running step started at, for its elapsed time.
  since?: number;
};

export type TimelineRun = {
  status: 'running' | 'done' | 'failed' | 'skipped';
  startedAt: string;
  steps: {
    id: string;
    ms: number;
    output?: string | null;
    error?: string | null;
    truncated?: boolean;
  }[];
};

export type TimelinePlan = {
  stepIds: string[];
  modifiedAt: string;
};

// The run does not record which steps it started with, so the workflow's current steps stand
// in for them only when the workflow has not changed since and the recorded steps agree.
function plannedRest(run: TimelineRun, plan: TimelinePlan | undefined): string[] {
  if (plan == null || Date.parse(plan.modifiedAt) > Date.parse(run.startedAt)) return [];
  const agrees = run.steps.every((step, index) => plan.stepIds[index] === step.id);
  return agrees ? plan.stepIds.slice(run.steps.length) : [];
}

export function runTimeline(run: TimelineRun, plan?: TimelinePlan): TimelineStep[] {
  const recorded = run.steps.map(
    (step): TimelineStep => ({
      id: step.id,
      state: step.error != null ? 'failed' : 'done',
      ms: step.ms,
      output: step.output ?? undefined,
      error: step.error ?? undefined,
      truncated: step.truncated === true || undefined,
    }),
  );
  if (run.status === 'done' || run.status === 'skipped') return recorded;

  const rest = plannedRest(run, plan);
  if (run.status === 'failed') {
    return [...recorded, ...rest.map((id): TimelineStep => ({ id, state: 'skipped' }))];
  }

  const since = Date.parse(run.startedAt) + run.steps.reduce((sum, step) => sum + step.ms, 0);
  return [
    ...recorded,
    ...rest.map(
      (id, index): TimelineStep =>
        index === 0 ? { id, state: 'running', since } : { id, state: 'pending' },
    ),
  ];
}
