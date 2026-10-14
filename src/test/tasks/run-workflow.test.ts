import * as authLib from '/lib/xp/auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Run } from '../../main/resources/lib/runs';
import type { Workflow } from '../../main/resources/lib/workflows';

import * as runsLib from '../../main/resources/lib/runs';
import { MAX_OUTPUT } from '../../main/resources/lib/steps';
import * as vertexLib from '../../main/resources/lib/vertex';
import * as workflowsLib from '../../main/resources/lib/workflows';
import { run } from '../../main/resources/tasks/run-workflow/run-workflow';

vi.mock('../../main/resources/lib/vertex', () => ({ generate: vi.fn() }));
vi.mock('../../main/resources/lib/workflows', () => ({ getById: vi.fn() }));
vi.mock('../../main/resources/lib/runs', () => ({
  createRun: vi.fn(),
  finishRun: vi.fn(),
  getRun: vi.fn(),
  updateRun: vi.fn(),
  claimRun: vi.fn(),
}));

const getUser = vi.mocked(authLib.getUser);
const hasRole = vi.mocked(authLib.hasRole);
const generate = vi.mocked(vertexLib.generate);
const getById = vi.mocked(workflowsLib.getById);
const createRun = vi.mocked(runsLib.createRun);
const finishRun = vi.mocked(runsLib.finishRun);
const getRun = vi.mocked(runsLib.getRun);
const updateRun = vi.mocked(runsLib.updateRun);
const claimRun = vi.mocked(runsLib.claimRun);

const ADMIN = 'user:system:su';

function workflow(steps: Workflow['steps']): Workflow {
  return {
    id: 'wf-1',
    name: 'nightly',
    displayName: 'Nightly',
    enabled: true,
    steps,
    modifiedAt: '',
  };
}

function llm(id: string, prompt: string, model?: string) {
  return { id, type: 'llm', config: { prompt, model } };
}

function record(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    workflowId: 'wf-1',
    status: 'running',
    trigger: 'manual',
    user: ADMIN,
    startedAt: '2026-10-15T10:00:00.000Z',
    steps: [],
    ...overrides,
  };
}

function signIn(key: string | undefined, admin: boolean): void {
  getUser.mockReturnValue(key == null ? null : ({ key } as never));
  hasRole.mockImplementation((role) => admin && role === 'system.admin');
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('log', { info: vi.fn(), warning: vi.fn(), error: vi.fn() });
  signIn(ADMIN, true);
  getById.mockReturnValue(workflow([llm('a', 'Write')]));
  getRun.mockReturnValue(record());
  createRun.mockImplementation(({ trigger, user, taskId, failed }) =>
    record({ id: 'run-new', trigger, user, taskId, status: failed == null ? 'running' : 'failed' }),
  );
});

describe('access', () => {
  it('should check the admin role before any store access', () => {
    run({ workflowId: 'wf-1', runId: 'run-1' }, 'task-1');

    const [checked] = hasRole.mock.invocationCallOrder;
    const [loaded] = getById.mock.invocationCallOrder;
    expect(checked).toBeLessThan(loaded);
  });

  it.each([
    ['a non-admin', 'user:system:bob', false],
    ['anonymous', undefined, true],
  ])('should record a failed run for %s and never touch the named run', (_name, key, admin) => {
    signIn(key, admin);

    run({ workflowId: 'wf-1', runId: 'run-1' }, 'task-1');

    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: 'manual',
        user: key ?? 'user:system:anonymous',
        failed: 'Runs need an enabled administrator account',
      }),
    );
    expect(getRun).not.toHaveBeenCalled();
    expect(updateRun).not.toHaveBeenCalled();
    expect(claimRun).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(log.warning).mock.calls)).not.toContain('user:');
  });

  it('should do nothing for a workflow that does not exist', () => {
    getById.mockReturnValue(undefined);

    run({ workflowId: 'gone' }, 'task-1');
    run({}, 'task-1');

    expect(createRun).not.toHaveBeenCalled();
    expect(getRun).not.toHaveBeenCalled();
    expect(updateRun).not.toHaveBeenCalled();
    expect(claimRun).not.toHaveBeenCalled();
    expect(finishRun).not.toHaveBeenCalled();
  });
});

describe('binding', () => {
  it('should adopt the manual run and stamp its task id', () => {
    generate.mockReturnValue('out');

    run({ workflowId: 'wf-1', runId: 'run-1' }, 'task-1');

    expect(claimRun).toHaveBeenCalledWith('run-1', 'task-1');
    expect(createRun).not.toHaveBeenCalled();
    expect(finishRun).toHaveBeenCalledWith(
      expect.anything(),
      'run-1',
      expect.objectContaining({ status: 'done' }),
    );
  });

  it.each([
    ['another workflow', record({ workflowId: 'wf-2' })],
    ['a run another task claimed', record({ taskId: 'task-0' })],
    ['a finished run', record({ status: 'done' })],
    ['a missing run', undefined],
  ])('should refuse to adopt %s', (_name, existing) => {
    getRun.mockReturnValue(existing);

    run({ workflowId: 'wf-1', runId: 'run-1' }, 'task-1');

    expect(updateRun).not.toHaveBeenCalled();
    expect(claimRun).not.toHaveBeenCalled();
    expect(finishRun).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('should adopt a run the API already stamped with this task', () => {
    getRun.mockReturnValue(record({ taskId: 'task-1' }));
    generate.mockReturnValue('out');

    run({ workflowId: 'wf-1', runId: 'run-1' }, 'task-1');

    expect(claimRun).not.toHaveBeenCalled();
    expect(finishRun).toHaveBeenCalledWith(
      expect.anything(),
      'run-1',
      expect.objectContaining({ status: 'done' }),
    );
  });

  it('should create a schedule run without a run id, and stop when it is skipped', () => {
    createRun.mockReturnValue(record({ id: 'run-new', status: 'skipped', trigger: 'schedule' }));

    run({ workflowId: 'wf-1' }, 'task-1');

    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'schedule', user: ADMIN, taskId: 'task-1' }),
    );
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('steps', () => {
  it('should feed earlier outputs into later prompts and keep the last output', () => {
    getById.mockReturnValue(
      workflow([llm('a', 'Write'), llm('b', 'Shorten: {{steps.a.output}}', 'gemini-3.1-pro')]),
    );
    generate.mockReturnValueOnce('long text').mockReturnValueOnce('short');

    run({ workflowId: 'wf-1', runId: 'run-1' }, 'task-1');

    expect(generate).toHaveBeenNthCalledWith(1, {
      prompt: 'Write',
      model: undefined,
      runId: 'run-1',
    });
    expect(generate).toHaveBeenNthCalledWith(2, {
      prompt: 'Shorten: long text',
      model: 'gemini-3.1-pro',
      runId: 'run-1',
    });
    expect(finishRun).toHaveBeenCalledWith(expect.anything(), 'run-1', {
      status: 'done',
      steps: [
        { id: 'a', output: 'long text', ms: expect.any(Number) },
        { id: 'b', output: 'short', ms: expect.any(Number) },
      ],
      output: 'short',
    });
  });

  it('should run a step whose id is a prototype key', () => {
    getById.mockReturnValue(
      workflow([llm('__proto__', 'Write'), llm('b', 'Use {{steps.__proto__.output}}')]),
    );
    generate.mockReturnValueOnce('first').mockReturnValueOnce('second');

    run({ workflowId: 'wf-1', runId: 'run-1' }, 'task-1');

    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: 'Use first' }));
    expect(finishRun).toHaveBeenCalledWith(
      expect.anything(),
      'run-1',
      expect.objectContaining({ status: 'done', output: 'second' }),
    );
  });

  it('should fail before calling Vertex when a stored step references a later one', () => {
    getById.mockReturnValue(workflow([llm('a', '{{steps.b.output}}'), llm('b', 'x')]));

    run({ workflowId: 'wf-1', runId: 'run-1' }, 'task-1');

    expect(generate).not.toHaveBeenCalled();
    expect(finishRun).toHaveBeenCalledWith(expect.anything(), 'run-1', {
      status: 'failed',
      error: 'Prompt references `b`, which is not an earlier step',
    });
  });

  it('should fail a workflow without steps', () => {
    getById.mockReturnValue(workflow([]));

    run({ workflowId: 'wf-1', runId: 'run-1' }, 'task-1');

    expect(finishRun).toHaveBeenCalledWith(expect.anything(), 'run-1', {
      status: 'failed',
      error: 'Workflow has no steps',
    });
  });

  it('should store the generate error on the step and stop', () => {
    getById.mockReturnValue(workflow([llm('a', 'x'), llm('b', 'y')]));
    generate.mockImplementation(() => {
      throw new Error('Vertex AI returned 429 (RESOURCE_EXHAUSTED)');
    });

    run({ workflowId: 'wf-1', runId: 'run-1' }, 'task-1');

    expect(generate).toHaveBeenCalledOnce();
    expect(finishRun).toHaveBeenCalledWith(expect.anything(), 'run-1', {
      status: 'failed',
      steps: [
        { id: 'a', error: 'Vertex AI returned 429 (RESOURCE_EXHAUSTED)', ms: expect.any(Number) },
      ],
      error: 'Step a failed: Vertex AI returned 429 (RESOURCE_EXHAUSTED)',
    });
  });

  it('should fall back to a generic message for an error without one', () => {
    generate.mockImplementation(() => {
      throw new Error('');
    });

    run({ workflowId: 'wf-1', runId: 'run-1' }, 'task-1');

    expect(finishRun).toHaveBeenCalledWith(
      expect.anything(),
      'run-1',
      expect.objectContaining({ error: 'Step a failed: Step failed' }),
    );
  });

  it('should cap stored outputs but pass the full output on', () => {
    const long = 'x'.repeat(MAX_OUTPUT + 10);
    getById.mockReturnValue(workflow([llm('a', 'x'), llm('b', '{{steps.a.output}}')]));
    generate.mockReturnValueOnce(long).mockReturnValueOnce(long);

    run({ workflowId: 'wf-1', runId: 'run-1' }, 'task-1');

    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: long }));
    const patch = finishRun.mock.calls[0][2];
    expect(patch.output).toHaveLength(MAX_OUTPUT);
    expect(patch.steps?.map((step) => step.output?.length)).toEqual([MAX_OUTPUT, MAX_OUTPUT]);
  });

  it('should mark the run failed without the error text when the store throws', () => {
    generate.mockReturnValue('out');
    updateRun.mockImplementation((_id, patch) => {
      if (patch.steps != null) throw new Error('secret prompt inside');
    });

    run({ workflowId: 'wf-1', runId: 'run-1' }, 'task-1');

    expect(finishRun).toHaveBeenCalledOnce();
    expect(finishRun).toHaveBeenCalledWith(expect.anything(), 'run-1', {
      status: 'failed',
      error: 'The run failed unexpectedly',
    });
    expect(JSON.stringify(vi.mocked(log.error).mock.calls)).not.toContain('secret');
  });

  it('should not throw when the run cannot be marked failed either', () => {
    generate.mockReturnValue('out');
    updateRun.mockImplementation((_id, patch) => {
      if (patch.steps != null) throw new Error('store down');
    });
    finishRun.mockImplementation(() => {
      throw new Error('store down');
    });

    expect(() => run({ workflowId: 'wf-1', runId: 'run-1' }, 'task-1')).not.toThrow();
    expect(JSON.stringify(vi.mocked(log.error).mock.calls)).toContain('could not be marked failed');
  });
});
