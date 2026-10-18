import { get as getTask } from '/lib/xp/task';

import type { Workflow } from './workflows';
import type { Node } from '/lib/xp/node';

import { getConnection, runInRepo } from './repo';
import { WORKFLOWS_PATH, toArray } from './workflows';

export const RUN_TASK = 'com.enonic.app.grieg:run-workflow';
export const MAX_RUNS = 20;
export const INTERRUPTED = 'interrupted';
export const SKIPPED = 'Another run of this workflow is in progress';

export type RunStatus = 'running' | 'done' | 'failed' | 'skipped';
export type RunTrigger = 'manual' | 'schedule';

export type StepResult = { id: string; output?: string; error?: string; ms: number };

export type Run = {
  id: string;
  workflowId: string;
  status: RunStatus;
  trigger: RunTrigger;
  user: string;
  taskId?: string;
  startedAt: string;
  finishedAt?: string;
  steps: StepResult[];
  output?: string;
  error?: string;
};

export type RunPatch = Partial<
  Pick<Run, 'status' | 'taskId' | 'finishedAt' | 'steps' | 'output' | 'error'>
>;

type RunData = Omit<Run, 'id' | 'steps'> & { steps?: StepResult[] | StepResult };

function runsPath(workflow: Workflow): string {
  return `${WORKFLOWS_PATH}/${workflow.name}/runs`;
}

function toRun(node: Node<RunData>): Run {
  return {
    id: node._id,
    workflowId: node.workflowId,
    status: node.status,
    trigger: node.trigger,
    user: node.user,
    taskId: node.taskId,
    startedAt: node.startedAt,
    finishedAt: node.finishedAt,
    steps: toArray(node.steps),
    output: node.output,
    error: node.error,
  };
}

function getRuns(ids: string[]): Run[] {
  if (ids.length === 0) return [];
  return toArray(getConnection().get<RunData>(ids)).map(toRun);
}

// Call inside `runInRepo`. Tolerates a concurrent run creating the folder first.
function ensureRunsFolder(workflow: Workflow): void {
  const connection = getConnection();
  const path = runsPath(workflow);
  if (connection.exists(path)) return;
  try {
    connection.create({
      _name: 'runs',
      _parentPath: `${WORKFLOWS_PATH}/${workflow.name}`,
      _inheritsPermissions: true,
    });
  } catch (e) {
    if (!connection.exists(path)) throw e;
  }
}

// The API stamps `taskId` right after submitting, so a run without one past this age has no task.
const UNSTAMPED_GRACE_MS = 60_000;

function isLive(run: Run): boolean {
  if (run.taskId == null) return Date.now() - Date.parse(run.startedAt) < UNSTAMPED_GRACE_MS;
  const state = getTask(run.taskId)?.state;
  return state === 'WAITING' || state === 'RUNNING';
}

// Call inside `runInRepo`. Fails every `running` run under `path` (a workflow's runs folder, or
// the whole store with `/*`) that no live task owns, and returns the live ones.
function reapRunning(path: string): Run[] {
  const parent = path.endsWith('/*')
    ? { like: { field: '_path', value: path } }
    : { term: { field: '_parentPath', value: path } };
  const result = getConnection().query({
    count: -1,
    query: { boolean: { must: [parent, { term: { field: 'status', value: 'running' } }] } },
  });
  const running = getRuns(result.hits.map((hit) => hit.id));
  const live = running.filter(isLive);
  const interrupted = running.filter((run) => !live.includes(run));
  for (const run of interrupted) {
    // A run that finished since the query keeps its result.
    getConnection().update<RunData>({
      key: run.id,
      editor: (current) =>
        current.status !== 'running'
          ? current
          : {
              ...current,
              status: 'failed',
              error: INTERRUPTED,
              finishedAt: new Date().toISOString(),
            },
    });
  }
  if (interrupted.length > 0) log.info(`Marked ${interrupted.length} interrupted runs failed`);
  return live;
}

export type NewRun = {
  workflow: Workflow;
  trigger: RunTrigger;
  user: string;
  taskId?: string;
  // Records a run that never started, such as one refused for lack of access.
  failed?: string;
};

// The skip guard is check-then-create, so two runs started in the same instant can both pass it.
export function createRun({ workflow, trigger, user, taskId, failed }: NewRun): Run {
  return runInRepo(() => {
    ensureRunsFolder(workflow);
    const now = new Date().toISOString();
    const skipped = failed == null && reapRunning(runsPath(workflow)).length > 0;
    const finished = failed != null || skipped;
    const node = getConnection().create<RunData>({
      _parentPath: runsPath(workflow),
      _inheritsPermissions: true,
      workflowId: workflow.id,
      status: failed != null ? 'failed' : skipped ? 'skipped' : 'running',
      trigger,
      user,
      taskId,
      startedAt: now,
      finishedAt: finished ? now : undefined,
      steps: [],
      error: failed ?? (skipped ? SKIPPED : undefined),
    });
    if (finished) prune(runsPath(workflow));
    return toRun(node);
  });
}

export function getRun(id: string): Run | undefined {
  return runInRepo(() => {
    const node = getConnection().get<RunData>(id);
    return node == null ? undefined : toRun(node);
  });
}

// Stamps a run with its task, unless it already has one or no longer runs: the task may have
// adopted or finished the run before the API's stamp lands.
export function claimRun(id: string, taskId: string): void {
  runInRepo(() => {
    getConnection().update<RunData>({
      key: id,
      editor: (current) =>
        current.status !== 'running' || current.taskId != null ? current : { ...current, taskId },
    });
  });
}

export function updateRun(id: string, patch: RunPatch): void {
  runInRepo(() => {
    getConnection().update<RunData>({ key: id, editor: (current) => ({ ...current, ...patch }) });
  });
}

export function listRuns(workflow: Workflow): Run[] {
  return runInRepo(() => {
    const result = getConnection().query({
      count: -1,
      query: { term: { field: '_parentPath', value: runsPath(workflow) } },
      sort: 'startedAt DESC',
    });
    return getRuns(result.hits.map((hit) => hit.id));
  });
}

export function lastRun(workflow: Workflow): Run | undefined {
  return runInRepo(() => {
    const result = getConnection().query({
      count: 1,
      query: { term: { field: '_parentPath', value: runsPath(workflow) } },
      sort: 'startedAt DESC',
    });
    return getRuns(result.hits.map((hit) => hit.id))[0];
  });
}

// Call inside `runInRepo`. A running run is never deleted, so a long run cannot lose its record.
function prune(path: string): void {
  const connection = getConnection();
  const result = connection.query({
    count: -1,
    query: { term: { field: '_parentPath', value: path } },
    sort: 'startedAt DESC',
  });
  const stale = getRuns(result.hits.slice(MAX_RUNS).map((hit) => hit.id)).filter(
    (run) => run.status !== 'running',
  );
  for (const run of stale) connection.delete(run.id);
}

export function finishRun(workflow: Workflow, id: string, patch: RunPatch): void {
  runInRepo(() => {
    getConnection().update<RunData>({
      key: id,
      editor: (current) => ({ ...current, ...patch, finishedAt: new Date().toISOString() }),
    });
    prune(runsPath(workflow));
  });
}

// Another cluster node may still be running some of these runs, so only ownerless ones fail.
export function sweepInterrupted(): void {
  runInRepo(() => {
    reapRunning(`${WORKFLOWS_PATH}/*`);
    const folders = getConnection().query({
      count: -1,
      query: { like: { field: '_path', value: `${WORKFLOWS_PATH}/*/runs` } },
    });
    for (const hit of folders.hits) {
      const folder = getConnection().get(hit.id);
      if (folder != null) prune(folder._path);
    }
  });
}
