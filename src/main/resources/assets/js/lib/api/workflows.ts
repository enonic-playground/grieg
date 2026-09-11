import { queryOptions } from '@tanstack/react-query';

import { getConfig } from '../config';
import { apiFetch } from './client';

export type WorkflowStep = {
  id: string;
  type: string;
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

type WorkflowList = {
  workflows: Workflow[];
};

export function fetchWorkflows(): Promise<Workflow[]> {
  const { apiUris } = getConfig();
  return apiFetch<WorkflowList>(apiUris.workflows).then((result) => result.workflows);
}

export function workflowsQueryOptions() {
  return queryOptions({
    queryKey: ['workflows'],
    queryFn: fetchWorkflows,
  });
}
