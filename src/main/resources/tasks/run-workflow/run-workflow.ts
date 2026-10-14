import { getUser, hasRole } from '/lib/xp/auth';

import type { Run, StepResult } from '../../lib/runs';
import type { Workflow } from '../../lib/workflows';

import { claimRun, createRun, finishRun, getRun, updateRun } from '../../lib/runs';
import { capOutput, renderPrompt, validateSteps, type LlmStep } from '../../lib/steps';
import { generate } from '../../lib/vertex';
import { getById } from '../../lib/workflows';

type RunConfig = { workflowId?: string; runId?: string };

const REFUSED = 'Runs need an enabled administrator account';
const UNEXPECTED = 'The run failed unexpectedly';

// Only `renderPrompt` and `generate` errors reach this: both throw messages safe to store.
function messageOf(e: unknown): string {
  return e instanceof Error && e.message !== '' ? e.message : 'Step failed';
}

// The binding is caller-supplied config, so a manual run is adopted only when it is a running
// run of this workflow that no other task has claimed.
function adopt(workflow: Workflow, runId: string, taskId: string): Run | undefined {
  const run = getRun(runId);
  const claimed = run?.taskId != null && run.taskId !== taskId;
  if (run?.workflowId !== workflow.id || run.status !== 'running' || claimed) {
    log.warning(`Workflow run ${runId} was not started: it is not an open run of this workflow`);
    return undefined;
  }
  if (run.taskId == null) claimRun(runId, taskId);
  return run;
}

function execute(workflow: Workflow, run: Run): void {
  const started = Date.now();
  const invalid = validateSteps(workflow.steps);
  if (invalid != null || workflow.steps.length === 0) {
    const message = invalid?.message ?? 'Workflow has no steps';
    finishRun(workflow, run.id, { status: 'failed', error: message });
    log.info(`Workflow run ${run.id} failed in ${Date.now() - started} ms`);
    return;
  }

  const outputs = new Map<string, string>();
  const results: StepResult[] = [];
  let output = '';
  for (const step of workflow.steps as LlmStep[]) {
    const stepStarted = Date.now();
    try {
      const prompt = renderPrompt(step.config.prompt, outputs);
      output = generate({ prompt, model: step.config.model, runId: run.id });
    } catch (e) {
      const error = messageOf(e);
      results.push({ id: step.id, error, ms: Date.now() - stepStarted });
      finishRun(workflow, run.id, {
        status: 'failed',
        steps: results,
        error: `Step ${step.id} failed: ${error}`,
      });
      log.info(`Workflow run ${run.id} failed in ${Date.now() - started} ms`);
      return;
    }
    outputs.set(step.id, output);
    results.push({ id: step.id, output: capOutput(output), ms: Date.now() - stepStarted });
    updateRun(run.id, { steps: results });
  }

  finishRun(workflow, run.id, { status: 'done', steps: results, output: capOutput(output) });
  log.info(`Workflow run ${run.id} done in ${Date.now() - started} ms`);
}

export function run(config: RunConfig, taskId: string): void {
  // First, on the inherited context: everything below runs as admin through `runInRepo`, so a
  // later check would always pass.
  const user = getUser();
  const admitted = user != null && hasRole('system.admin');

  let current: Run | undefined;
  let workflow: Workflow | undefined;
  try {
    workflow = config.workflowId == null ? undefined : getById(config.workflowId);
    if (workflow == null) {
      log.warning('A workflow run task named no existing workflow');
      return;
    }
    const trigger = config.runId == null ? 'schedule' : 'manual';
    const userKey = user?.key ?? 'user:system:anonymous';

    // A refused call never touches the run it names, so it cannot fail someone else's run.
    if (!admitted) {
      const refused = createRun({ workflow, trigger, user: userKey, taskId, failed: REFUSED });
      log.warning(`Workflow run ${refused.id} failed: not run by an administrator`);
      return;
    }

    current =
      config.runId == null
        ? createRun({ workflow, trigger, user: userKey, taskId })
        : adopt(workflow, config.runId, taskId);
    if (current?.status !== 'running') return;

    execute(workflow, current);
  } catch {
    log.error(`Workflow run ${current?.id ?? '-'} failed unexpectedly`);
    if (workflow == null || current == null) return;
    try {
      finishRun(workflow, current.id, { status: 'failed', error: UNEXPECTED });
    } catch {
      log.error(`Workflow run ${current.id} could not be marked failed`);
    }
  }
}
