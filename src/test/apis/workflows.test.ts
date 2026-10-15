import * as authLib from '/lib/xp/auth';
import * as schedulerLib from '/lib/xp/scheduler';
import * as taskLib from '/lib/xp/task';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Run } from '../../main/resources/lib/runs';
import type { Workflow } from '../../main/resources/lib/workflows';
import type { Request, Response } from '@enonic-types/core';

import * as api from '../../main/resources/apis/workflows/workflows';
import * as runsLib from '../../main/resources/lib/runs';
import * as workflowsLib from '../../main/resources/lib/workflows';

vi.mock('../../main/resources/lib/workflows', () => ({
  createWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
  getById: vi.fn(),
  list: vi.fn(),
  updateWorkflow: vi.fn(),
}));
vi.mock('../../main/resources/lib/runs', () => ({
  RUN_TASK: 'com.enonic.app.grieg:run-workflow',
  createRun: vi.fn(),
  finishRun: vi.fn(),
  listRuns: vi.fn(),
  claimRun: vi.fn(),
}));

const getUser = vi.mocked(authLib.getUser);
const hasRole = vi.mocked(authLib.hasRole);
const submitTask = vi.mocked(taskLib.submitTask);
const getById = vi.mocked(workflowsLib.getById);
const createWorkflow = vi.mocked(workflowsLib.createWorkflow);
const deleteWorkflow = vi.mocked(workflowsLib.deleteWorkflow);
const getJob = vi.mocked(schedulerLib.get);
const deleteJob = vi.mocked(schedulerLib.deleteJob);
const updateWorkflow = vi.mocked(workflowsLib.updateWorkflow);
const createRun = vi.mocked(runsLib.createRun);
const finishRun = vi.mocked(runsLib.finishRun);
const listRuns = vi.mocked(runsLib.listRuns);
const claimRun = vi.mocked(runsLib.claimRun);

const WORKFLOW: Workflow = {
  id: 'wf-1',
  name: 'nightly',
  displayName: 'Nightly',
  enabled: true,
  steps: [],
  modifiedAt: '',
};

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    workflowId: 'wf-1',
    status: 'running',
    trigger: 'manual',
    user: 'user:system:su',
    startedAt: '2026-10-15T10:00:00.000Z',
    steps: [],
    ...overrides,
  };
}

function request(params: Record<string, string>, body?: unknown): Request {
  return { params, body: body == null ? undefined : JSON.stringify(body) } as unknown as Request;
}

function json(response: Response): Record<string, unknown> {
  return JSON.parse(response.body as string);
}

const VALID = [{ id: 'a', type: 'llm', config: { prompt: 'Write' } }];

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('log', { info: vi.fn(), warning: vi.fn(), error: vi.fn() });
  hasRole.mockImplementation((role) => role === 'system.admin');
  getUser.mockReturnValue({ key: 'user:system:su' } as never);
  getById.mockReturnValue(WORKFLOW);
});

describe('POST ?action=run', () => {
  it('should create the run first, submit the task with its id, and return both ids', () => {
    createRun.mockReturnValue(run());
    submitTask.mockReturnValue('task-1');

    const response = api.post(request({ id: 'wf-1', action: 'run' }));

    expect(createRun).toHaveBeenCalledWith({
      workflow: WORKFLOW,
      trigger: 'manual',
      user: 'user:system:su',
    });
    expect(submitTask).toHaveBeenCalledWith({
      descriptor: 'com.enonic.app.grieg:run-workflow',
      config: { workflowId: 'wf-1', runId: 'run-1' },
    });
    expect(createRun.mock.invocationCallOrder[0]).toBeLessThan(
      submitTask.mock.invocationCallOrder[0],
    );
    expect(claimRun).toHaveBeenCalledWith('run-1', 'task-1');
    expect(response.status).toBe(202);
    expect(json(response).data).toEqual({ runId: 'run-1', taskId: 'task-1', status: 'running' });
  });

  it('should not submit a task for a skipped run', () => {
    createRun.mockReturnValue(run({ status: 'skipped' }));

    const response = api.post(request({ id: 'wf-1', action: 'run' }));

    expect(submitTask).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(json(response).data).toEqual({ runId: 'run-1', status: 'skipped' });
  });

  it('should fail the run when the task cannot be submitted', () => {
    createRun.mockReturnValue(run());
    submitTask.mockImplementation(() => {
      throw new Error('no task manager');
    });

    const response = api.post(request({ id: 'wf-1', action: 'run' }));

    expect(response.status).toBe(500);
    expect(json(response).code).toBe('TASK_FAILED');
    expect(JSON.stringify(vi.mocked(log.error).mock.calls)).not.toContain('no task manager');
    expect(finishRun).toHaveBeenCalledWith(WORKFLOW, 'run-1', {
      status: 'failed',
      error: 'The run task could not be started',
    });
  });

  it.each([
    ['an unknown workflow', { id: 'gone', action: 'run' }, 404, 'No workflow with id gone'],
    ['a missing id', { action: 'run' }, 400, 'Missing `id` parameter'],
    ['another action', { id: 'wf-1', action: 'stop' }, 400, 'Unknown action stop'],
  ])('should refuse %s', (_name, params, status, message) => {
    getById.mockImplementation((id) => (id === 'wf-1' ? WORKFLOW : undefined));

    const response = api.post(request(params, { name: 'x' }));

    expect(response.status).toBe(status);
    expect(json(response).message).toBe(message);
    expect(createRun).not.toHaveBeenCalled();
    expect(createWorkflow).not.toHaveBeenCalled();
  });
});

describe('DELETE', () => {
  const job = { name: 'grieg-workflow-wf-1', descriptor: 'com.enonic.app.grieg:run-workflow' };

  it('should delete the workflow schedule with the workflow', () => {
    deleteWorkflow.mockReturnValue(true);
    getJob.mockReturnValue(job as never);

    expect(api.delete(request({ id: 'wf-1' })).status).toBe(200);
    expect(getJob).toHaveBeenCalledWith({ name: 'grieg-workflow-wf-1' });
    expect(deleteJob).toHaveBeenCalledWith({ name: 'grieg-workflow-wf-1' });
  });

  it('should leave a job of another application under that name alone', () => {
    deleteWorkflow.mockReturnValue(true);
    getJob.mockReturnValue({ ...job, descriptor: 'com.example.app:purge' } as never);

    expect(api.delete(request({ id: 'wf-1' })).status).toBe(200);
    expect(deleteJob).not.toHaveBeenCalled();
  });

  it('should still answer the deleted workflow when its schedule cannot be deleted', () => {
    deleteWorkflow.mockReturnValue(true);
    getJob.mockReturnValue(job as never);
    deleteJob.mockImplementation(() => {
      throw new Error('Repository unavailable');
    });

    expect(api.delete(request({ id: 'wf-1' })).status).toBe(200);
  });

  it('should not touch the scheduler when the workflow does not exist', () => {
    deleteWorkflow.mockReturnValue(false);

    expect(api.delete(request({ id: 'wf-1' })).status).toBe(404);
    expect(getJob).not.toHaveBeenCalled();
  });
});

describe('GET ?runs=true', () => {
  it("should list the workflow's runs", () => {
    listRuns.mockReturnValue([run({ id: 'r2' }), run({ id: 'r1', status: 'done' })]);

    const response = api.get(request({ id: 'wf-1', runs: 'true' }));

    expect(listRuns).toHaveBeenCalledWith(WORKFLOW);
    expect((json(response).data as { runs: Run[] }).runs.map((r) => r.id)).toEqual(['r2', 'r1']);
  });

  it('should answer 404 for an unknown workflow', () => {
    getById.mockReturnValue(undefined);
    expect(api.get(request({ id: 'gone', runs: 'true' })).status).toBe(404);
  });
});

describe('step validation', () => {
  const INVALID = [
    { id: 'a', type: 'llm', config: { prompt: 'x' } },
    { id: 'b', type: 'llm', config: { prompt: '{{steps.c.output}}' } },
  ];

  it('should reject invalid steps on create and name the step', () => {
    const response = api.post(request({}, { name: 'x', steps: INVALID }));

    expect(response.status).toBe(400);
    expect(json(response)).toEqual({
      status: 400,
      code: 'INVALID_STEPS',
      message: 'Step 2: Prompt references `c`, which is not an earlier step',
      step: { index: 1, id: 'b' },
    });
    expect(createWorkflow).not.toHaveBeenCalled();
  });

  it('should reject invalid steps on update', () => {
    const response = api.put(request({ id: 'wf-1' }, { steps: [{ id: 'a', type: 'http' }] }));

    expect(response.status).toBe(400);
    expect(json(response).code).toBe('INVALID_STEPS');
    expect(updateWorkflow).not.toHaveBeenCalled();
  });

  it('should reject steps that are not an array', () => {
    const response = api.post(request({}, { name: 'x', steps: {} }));

    expect(json(response)).toEqual({
      status: 400,
      code: 'INVALID_STEPS',
      message: '`steps` must be an array',
    });
  });

  it('should accept valid steps and a body without steps', () => {
    createWorkflow.mockReturnValue(WORKFLOW);
    updateWorkflow.mockReturnValue(WORKFLOW);

    expect(api.post(request({}, { name: 'x', steps: VALID })).status).toBe(201);
    expect(api.put(request({ id: 'wf-1' }, { enabled: false })).status).toBe(200);
  });
});
