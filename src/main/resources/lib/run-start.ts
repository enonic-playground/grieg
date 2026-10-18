import { submitTask } from '/lib/xp/task';

import type { RunStatus } from './runs';
import type { Workflow } from './workflows';

import { RUN_TASK, claimRun, createRun, finishRun } from './runs';

export const TASK_FAILED = 'The run task could not be started';

export type StartedRun =
  | { ok: true; runId: string; status: RunStatus; taskId?: string }
  | { ok: false; message: string };

// Call outside `runInRepo`: the task checks `role:system.admin` on the context it inherits from
// here, and `runInRepo` would hand it the store's admin principal whoever the caller is.
export function startRun(workflow: Workflow, user: string): StartedRun {
  const run = createRun({ workflow, trigger: 'manual', user });
  if (run.status !== 'running') return { ok: true, runId: run.id, status: run.status };

  let taskId: string;
  try {
    taskId = submitTask({
      descriptor: RUN_TASK,
      config: { workflowId: workflow.id, runId: run.id },
    });
  } catch {
    finishRun(workflow, run.id, { status: 'failed', error: TASK_FAILED });
    log.error(`Workflow run ${run.id} could not be submitted`);
    return { ok: false, message: TASK_FAILED };
  }
  try {
    claimRun(run.id, taskId);
  } catch {
    log.warning(`Workflow run ${run.id} could not be stamped with its task`);
  }
  return { ok: true, runId: run.id, status: run.status, taskId };
}
