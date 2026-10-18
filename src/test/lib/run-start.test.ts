import * as contextLib from '/lib/xp/context';
import * as taskLib from '/lib/xp/task';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Run } from '../../main/resources/lib/runs';
import type { Workflow } from '../../main/resources/lib/workflows';

import { runInRepo } from '../../main/resources/lib/repo';
import { startRun } from '../../main/resources/lib/run-start';
import * as runsLib from '../../main/resources/lib/runs';

vi.mock('../../main/resources/lib/runs', () => ({
  RUN_TASK: 'com.enonic.app.grieg:run-workflow',
  claimRun: vi.fn(),
  createRun: vi.fn(),
  finishRun: vi.fn(),
}));

const run = vi.mocked(contextLib.run);
const submitTask = vi.mocked(taskLib.submitTask);
const createRun = vi.mocked(runsLib.createRun);
const claimRun = vi.mocked(runsLib.claimRun);
const finishRun = vi.mocked(runsLib.finishRun);

const WORKFLOW: Workflow = {
  id: 'wf-1',
  name: 'nightly',
  displayName: 'Nightly',
  enabled: true,
  steps: [],
  modifiedAt: '',
};

const RUNNING: Run = {
  id: 'run-1',
  workflowId: 'wf-1',
  status: 'running',
  trigger: 'manual',
  user: 'user:system:alice',
  startedAt: '2026-10-15T10:00:00.000Z',
  steps: [],
};

type Context = { user?: unknown; principals?: string[] };

// The contexts open at each moment, innermost last, as XP nests `context.run`.
const open: Context[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('log', { info: vi.fn(), warning: vi.fn(), error: vi.fn() });
  open.length = 0;
  run.mockImplementation((context, callback) => {
    open.push(context as Context);
    try {
      return callback();
    } finally {
      open.pop();
    }
  });
  createRun.mockImplementation(() => runInRepo(() => RUNNING));
});

describe('startRun', () => {
  it("should submit the task in the caller's context, never in the store's admin context", () => {
    const seen: Context[][] = [];
    submitTask.mockImplementation(() => {
      seen.push([...open]);
      return 'task-1';
    });

    const started = run({ user: { login: 'alice', idProvider: 'system' } }, () =>
      startRun(WORKFLOW, 'user:system:alice'),
    );

    expect(started).toEqual({ ok: true, runId: 'run-1', status: 'running', taskId: 'task-1' });
    expect(seen).toEqual([[{ user: { login: 'alice', idProvider: 'system' } }]]);
    expect(createRun).toHaveBeenCalledWith({
      workflow: WORKFLOW,
      trigger: 'manual',
      user: 'user:system:alice',
    });
    expect(submitTask).toHaveBeenCalledWith({
      descriptor: 'com.enonic.app.grieg:run-workflow',
      config: { workflowId: 'wf-1', runId: 'run-1' },
    });
    expect(claimRun).toHaveBeenCalledWith('run-1', 'task-1');
  });

  it('should not submit a task for a skipped run', () => {
    createRun.mockReturnValue({ ...RUNNING, status: 'skipped' });

    expect(startRun(WORKFLOW, 'user:system:alice')).toEqual({
      ok: true,
      runId: 'run-1',
      status: 'skipped',
    });
    expect(submitTask).not.toHaveBeenCalled();
  });

  it('should fail the run with a safe message when the task cannot be submitted', () => {
    submitTask.mockImplementation(() => {
      throw new Error('no task manager');
    });

    expect(startRun(WORKFLOW, 'user:system:alice')).toEqual({
      ok: false,
      message: 'The run task could not be started',
    });
    expect(finishRun).toHaveBeenCalledWith(WORKFLOW, 'run-1', {
      status: 'failed',
      error: 'The run task could not be started',
    });
    expect(claimRun).not.toHaveBeenCalled();
  });

  it('should still report the started run when stamping it with the task fails', () => {
    submitTask.mockReturnValue('task-1');
    claimRun.mockImplementation(() => {
      throw new Error('repository unavailable');
    });

    expect(startRun(WORKFLOW, 'user:system:alice')).toEqual({
      ok: true,
      runId: 'run-1',
      status: 'running',
      taskId: 'task-1',
    });
    expect(log.warning).toHaveBeenCalledWith(
      'Workflow run run-1 could not be stamped with its task',
    );
  });
});
