import { queryOptions } from '@tanstack/react-query';

import { getConfig } from '../config';
import { apiFetch } from './client';

// Steps stored before runs existed may carry another type or no config.
export type WorkflowStep = {
  id: string;
  type: string;
  config?: { prompt?: string; model?: string };
};

export type Workflow = {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  enabled: boolean;
  steps: WorkflowStep[];
  modifiedAt: string;
};

export type WorkflowInput = {
  name: string;
  displayName?: string;
  steps?: WorkflowStep[];
};

export type RunStatus = 'running' | 'done' | 'failed' | 'skipped';

export type RunStep = {
  id: string;
  output?: string;
  error?: string;
  ms: number;
};

export type Run = {
  id: string;
  workflowId: string;
  status: RunStatus;
  trigger: 'manual' | 'schedule';
  user: string;
  taskId?: string;
  startedAt: string;
  finishedAt?: string;
  steps: RunStep[];
  output?: string;
  error?: string;
};

export type StartedRun = {
  runId: string;
  taskId?: string;
  status: RunStatus;
};

type WorkflowList = {
  workflows: Workflow[];
};

type RunList = {
  runs: Run[];
};

const RUN_POLL_MS = 2000;

export const WORKFLOWS_QUERY_KEY = ['workflows'] as const;

export function workflowQueryKey(id: string) {
  return [...WORKFLOWS_QUERY_KEY, id] as const;
}

export function runsQueryKey(id: string) {
  return [...WORKFLOWS_QUERY_KEY, id, 'runs'] as const;
}

export function saveMutationKey(id: string) {
  return [...WORKFLOWS_QUERY_KEY, id, 'save'] as const;
}

export function fetchWorkflows(): Promise<Workflow[]> {
  const { apiUris } = getConfig();
  return apiFetch<WorkflowList>(apiUris.workflows).then((result) => result.workflows);
}

export function fetchWorkflow(id: string): Promise<Workflow> {
  return apiFetch<Workflow>(getConfig().apiUris.workflows, { params: { id } });
}

export function createWorkflow(input: WorkflowInput): Promise<Workflow> {
  return apiFetch<Workflow>(getConfig().apiUris.workflows, { method: 'POST', body: input });
}

export function updateWorkflow(id: string, input: Partial<WorkflowInput>): Promise<Workflow> {
  return apiFetch<Workflow>(getConfig().apiUris.workflows, {
    method: 'PUT',
    params: { id },
    body: input,
  });
}

export function runWorkflow(id: string): Promise<StartedRun> {
  return apiFetch<StartedRun>(getConfig().apiUris.workflows, {
    method: 'POST',
    params: { id, action: 'run' },
  });
}

export function fetchRuns(id: string): Promise<Run[]> {
  return apiFetch<RunList>(getConfig().apiUris.workflows, {
    params: { id, runs: 'true' },
  }).then((result) => result.runs);
}

export function workflowsQueryOptions() {
  return queryOptions({
    queryKey: WORKFLOWS_QUERY_KEY,
    queryFn: fetchWorkflows,
  });
}

export function workflowQueryOptions(id: string) {
  return queryOptions({
    queryKey: workflowQueryKey(id),
    queryFn: () => fetchWorkflow(id),
  });
}

export function runsQueryOptions(id: string) {
  return queryOptions({
    queryKey: runsQueryKey(id),
    queryFn: () => fetchRuns(id),
    refetchInterval: (query) =>
      query.state.data?.some((run) => run.status === 'running') ? RUN_POLL_MS : false,
  });
}
