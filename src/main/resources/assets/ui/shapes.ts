// The `structuredContent` of each tool a card renders, as lib/workflow-tools.ts and
// lib/node-tools.ts build it. Tool results carry no presentation shape: the card owns that.

export type JsonObject = Record<string, unknown>;

export type RunStatus = 'running' | 'done' | 'failed' | 'skipped';

export type RunTrigger = 'manual' | 'schedule';

export type WorkflowItem = {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  stepCount: number;
  schedule: {
    name: string;
    cron: string | null;
    timeZone: string | null;
    enabled: boolean;
    user: string | null;
  } | null;
  lastRun: {
    id: string;
    status: RunStatus;
    trigger: RunTrigger;
    startedAt: string;
    finishedAt: string | null;
  } | null;
  adminUrl: string;
};

export type RunSummary = {
  id: string;
  status: RunStatus;
  trigger: RunTrigger;
  user: string;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};

export type RunStep = {
  id: string;
  ms: number;
  output: string | null;
  error: string | null;
  truncated?: boolean;
};

export type RunDetail = RunSummary & {
  workflowId: string;
  taskId: string | null;
  steps: RunStep[];
  output: string | null;
  truncated?: boolean;
  adminUrl: string;
};

export type CronJob = {
  name: string;
  enabled: boolean;
  descriptor: string;
  description: string | null;
  cron: string | null;
  timeZone: string | null;
  user: string | null;
  workflowId: string | null;
  workflowName?: string;
  lastRun: string | null;
  lastTaskId: string | null;
  adminUrl?: string;
};

export type NodeSummary = {
  _id: string;
  _name: string;
  _path: string;
  _nodeType: string;
  _ts: string;
  _versionKey: string;
};

export type NodeDetail = NodeSummary & {
  data?: unknown;
  fields?: JsonObject;
  permissions?: unknown;
  indexConfig?: unknown;
};

export type Repo = {
  id: string;
  branches: string[];
  defaultBranch: string;
  access: 'read' | 'write';
};

export type ToolResults = {
  workflow_list: { workflows: WorkflowItem[] };
  run_list: { workflowId: string; runs: RunSummary[]; adminUrl: string };
  run_get: RunDetail;
  cron_list: { jobs: CronJob[] };
  node_query: {
    total: number;
    count: number;
    hits: (NodeSummary & { fields?: JsonObject })[];
    nextCursor?: string;
  };
  node_get: NodeDetail;
  node_repos: { repos: Repo[] };
};

export type CardTool = keyof ToolResults;

export type Screen = {
  [T in CardTool]: { tool: T; args: JsonObject; data: ToolResults[T]; title?: string };
}[CardTool];

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

// Tells the tools apart by the key only that tool's result carries, so a card renders even
// when the host does not say which tool ran.
export function inferTool(data: unknown): CardTool | undefined {
  if (!isObject(data)) return undefined;
  if (Array.isArray(data.workflows)) return 'workflow_list';
  if (Array.isArray(data.runs)) return 'run_list';
  if (Array.isArray(data.steps)) return 'run_get';
  if (Array.isArray(data.jobs)) return 'cron_list';
  if (Array.isArray(data.hits)) return 'node_query';
  if (Array.isArray(data.repos)) return 'node_repos';
  if (typeof data._id === 'string') return 'node_get';
  return undefined;
}

export function toScreen(data: unknown, args: JsonObject, title?: string): Screen | undefined {
  const tool = inferTool(data);
  return tool == null ? undefined : ({ tool, args, data, title } as Screen);
}
