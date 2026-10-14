import * as nodeLib from '/lib/xp/node';
import * as taskLib from '/lib/xp/task';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Workflow } from '../../main/resources/lib/workflows';

import {
  INTERRUPTED,
  claimRun,
  MAX_RUNS,
  SKIPPED,
  createRun,
  finishRun,
  listRuns,
  sweepInterrupted,
} from '../../main/resources/lib/runs';

const connect = vi.mocked(nodeLib.connect);
const getTask = vi.mocked(taskLib.get);

const connection = {
  exists: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  query: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

const WORKFLOW: Workflow = {
  id: 'wf-1',
  name: 'nightly',
  displayName: 'Nightly',
  enabled: true,
  steps: [],
  modifiedAt: '',
};
const RUNS_PATH = '/workflows/nightly/runs';

type Stored = {
  _id: string;
  _parentPath: string;
  _path: string;
  status?: string;
  startedAt: string;
  taskId?: string;
  steps?: unknown;
};

type Query = { query: Record<string, unknown>; sort?: string };

let stored: Stored[];

function hits(nodes: Stored[]) {
  return { total: nodes.length, count: nodes.length, hits: nodes.map((n) => ({ id: n._id })) };
}

// Answers the store's queries from `stored`, the way lib-node would for these query shapes.
function serve(): void {
  connection.exists.mockReturnValue(true);
  connection.query.mockImplementation(({ query, sort }: Query) => {
    const text = JSON.stringify(query);
    const parent = /"field":"_parentPath","value":"([^"]+)"/.exec(text)?.[1];
    const glob = /"like":\{"field":"_path","value":"([^"]+)"/.exec(text)?.[1];
    const like = glob == null ? undefined : new RegExp(`^${glob.replaceAll('*', '.*')}$`);
    const nodes = stored.filter(
      (n) =>
        (parent == null || n._parentPath === parent) &&
        (like == null || like.test(n._path)) &&
        (!text.includes('"value":"running"') || n.status === 'running'),
    );
    const order = sort === 'startedAt DESC' ? -1 : sort === 'startedAt ASC' ? 1 : 0;
    return hits(nodes.toSorted((a, b) => order * a.startedAt.localeCompare(b.startedAt)));
  });
  connection.get.mockImplementation((key: string | string[]) => {
    const pick = (id: string) => stored.find((n) => n._id === id);
    if (!Array.isArray(key)) return pick(key) ?? null;
    const found = key.map(pick).filter(Boolean);
    return found.length === 1 ? found[0] : found;
  });
  connection.create.mockImplementation((data: Record<string, unknown>) => ({
    _id: 'new',
    ...data,
  }));
}

const NOW = new Date('2026-10-15T11:00:00.000Z');

function folder(workflow: string): Stored {
  const path = `/workflows/${workflow}/runs`;
  return { _id: path, _parentPath: `/workflows/${workflow}`, _path: path, startedAt: '' };
}

function run(id: string, status: string, minute: number, taskId?: string): Stored {
  return {
    _id: id,
    _parentPath: RUNS_PATH,
    _path: `${RUNS_PATH}/${id}`,
    status,
    startedAt: `2026-10-15T10:${String(minute).padStart(2, '0')}:00.000Z`,
    taskId,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('log', { info: vi.fn(), warning: vi.fn(), error: vi.fn() });
  for (const fn of Object.values(connection)) fn.mockReset();
  connect.mockReturnValue(connection as never);
  stored = [];
  serve();
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  getTask.mockImplementation((taskId) =>
    taskId.startsWith('live') ? ({ state: 'RUNNING' } as never) : null,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createRun', () => {
  it('should record a running run that inherits the admin-only ACL', () => {
    const result = createRun({ workflow: WORKFLOW, trigger: 'manual', user: 'user:system:su' });

    expect(connection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        _parentPath: RUNS_PATH,
        _inheritsPermissions: true,
        workflowId: 'wf-1',
        status: 'running',
        trigger: 'manual',
        user: 'user:system:su',
      }),
    );
    expect(result).toMatchObject({ id: 'new', status: 'running', steps: [] });
    expect(result.finishedAt).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it('should not skip because a run of another workflow is running', () => {
    stored = [{ ...run('other', 'running', 1, 'live-1'), _parentPath: '/workflows/other/runs' }];

    const result = createRun({ workflow: WORKFLOW, trigger: 'manual', user: 'user:system:su' });

    expect(result.status).toBe('running');
  });

  it('should tolerate another request creating the runs folder first', () => {
    connection.exists.mockReturnValueOnce(false).mockReturnValue(true);
    connection.create.mockImplementationOnce(() => {
      throw new Error('exists');
    });

    const result = createRun({ workflow: WORKFLOW, trigger: 'manual', user: 'user:system:su' });

    expect(result.status).toBe('running');
  });

  it('should rethrow a folder error when the folder still does not exist', () => {
    connection.exists.mockReturnValue(false);
    connection.create.mockImplementationOnce(() => {
      throw new Error('denied');
    });

    expect(() =>
      createRun({ workflow: WORKFLOW, trigger: 'manual', user: 'user:system:su' }),
    ).toThrow('denied');
  });

  it('should create the runs folder with inherited permissions when it is missing', () => {
    connection.exists.mockReturnValue(false);

    createRun({ workflow: WORKFLOW, trigger: 'manual', user: 'user:system:su' });

    expect(connection.create).toHaveBeenCalledWith({
      _name: 'runs',
      _parentPath: '/workflows/nightly',
      _inheritsPermissions: true,
    });
  });

  it('should record a skipped run while another run of the workflow is running', () => {
    stored = [run('r1', 'running', 1, 'live-1')];

    const result = createRun({ workflow: WORKFLOW, trigger: 'schedule', user: 'user:system:su' });

    expect(result).toMatchObject({ status: 'skipped', error: SKIPPED });
    expect(connection.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'skipped', finishedAt: expect.any(String) }),
    );
  });

  it('should treat a running run whose task is gone as interrupted, not as running', () => {
    stored = [run('dead', 'running', 1, 'task-gone'), run('lost', 'running', 2)];

    const result = createRun({ workflow: WORKFLOW, trigger: 'manual', user: 'user:system:su' });

    expect(result.status).toBe('running');
    expect(connection.update.mock.calls.map(([{ key }]) => key).sort()).toEqual(['dead', 'lost']);
  });

  it('should count a run the API has not stamped yet as running', () => {
    stored = [{ ...run('fresh', 'running', 0), startedAt: '2026-10-15T10:59:30.000Z' }];

    expect(createRun({ workflow: WORKFLOW, trigger: 'manual', user: 'u' }).status).toBe('skipped');
    expect(connection.update).not.toHaveBeenCalled();
  });

  it('should record a refused run as failed even while another run is running, and prune', () => {
    stored = [
      run('r1', 'running', 30, 'live-1'),
      ...Array.from({ length: MAX_RUNS }, (_, i) => run(`d${i}`, 'done', i)),
    ];

    const result = createRun({
      workflow: WORKFLOW,
      trigger: 'schedule',
      user: 'user:system:anonymous',
      failed: 'nope',
    });

    expect(result).toMatchObject({
      status: 'failed',
      error: 'nope',
      finishedAt: expect.any(String),
    });
    expect(connection.delete).toHaveBeenCalledWith('d0');
  });
});

describe('retention', () => {
  it(`should keep the newest ${MAX_RUNS} runs after a run finishes`, () => {
    stored = Array.from({ length: MAX_RUNS + 3 }, (_, i) => run(`r${i}`, 'done', i));

    finishRun(WORKFLOW, 'r22', { status: 'done' });

    expect(connection.delete.mock.calls.map(([id]) => id).sort()).toEqual(['r0', 'r1', 'r2']);
  });

  it('should never delete a run that is still running', () => {
    stored = [
      run('old-running', 'running', 0),
      ...Array.from({ length: MAX_RUNS }, (_, i) => run(`r${i}`, 'done', i + 1)),
    ];

    finishRun(WORKFLOW, 'r19', { status: 'done' });

    expect(connection.delete).not.toHaveBeenCalled();
  });

  it('should prune after recording a skipped run', () => {
    stored = [
      run('live', 'running', 30, 'live-1'),
      ...Array.from({ length: MAX_RUNS }, (_, i) => run(`r${i}`, 'done', i)),
    ];

    createRun({ workflow: WORKFLOW, trigger: 'schedule', user: 'user:system:su' });

    expect(connection.delete).toHaveBeenCalledWith('r0');
  });

  it('should stamp finishedAt over the patch', () => {
    vi.useFakeTimers({ now: new Date('2026-10-15T12:00:00.000Z') });
    finishRun(WORKFLOW, 'r1', { status: 'failed', error: 'x', finishedAt: 'stale' });

    const { editor } = connection.update.mock.calls[0][0];
    const edited = editor({ status: 'running', steps: [] });
    vi.useRealTimers();
    expect(edited).toEqual({
      status: 'failed',
      steps: [],
      error: 'x',
      finishedAt: '2026-10-15T12:00:00.000Z',
    });
  });
});

describe('listRuns', () => {
  it('should list newest first and read a single step back as an array', () => {
    stored = [
      { ...run('r1', 'done', 1), steps: { id: 'a', output: 'x', ms: 3 } },
      run('r2', 'running', 2),
    ];

    const runs = listRuns(WORKFLOW);

    expect(connection.query).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { term: { field: '_parentPath', value: RUNS_PATH } },
        sort: 'startedAt DESC',
      }),
    );
    expect(runs.map((r) => r.id)).toEqual(['r2', 'r1']);
    expect(runs[1].steps).toEqual([{ id: 'a', output: 'x', ms: 3 }]);
  });

  it('should read a single run back as a list', () => {
    stored = [run('r1', 'done', 1)];

    expect(listRuns(WORKFLOW).map((r) => r.id)).toEqual(['r1']);
  });
});

describe('claimRun', () => {
  it('should stamp an unclaimed running run, and leave a claimed or finished one alone', () => {
    claimRun('run-1', 'task-1');

    const { key, editor } = connection.update.mock.calls[0][0];
    expect(key).toBe('run-1');
    expect(editor({ status: 'running' })).toEqual({ status: 'running', taskId: 'task-1' });
    const claimed = { status: 'running', taskId: 'task-0' };
    expect(editor(claimed)).toBe(claimed);
    const finished = { status: 'failed', error: 'Workflow has no steps' };
    expect(editor(finished)).toBe(finished);
  });
});

describe('sweepInterrupted', () => {
  it('should keep the result of a run that finished after it was found', () => {
    stored = [run('gone', 'running', 1, 'task-gone')];

    sweepInterrupted();

    const { editor } = connection.update.mock.calls[0][0];
    const done = { status: 'done', output: 'x' };
    expect(editor(done)).toBe(done);
  });

  it('should fail running runs no live task owns, and leave live ones alone', () => {
    stored = [
      run('gone', 'running', 1, 'task-gone'),
      run('finished', 'running', 2, 'task-finished'),
      run('unstarted', 'running', 3),
      { ...run('fresh', 'running', 0), startedAt: '2026-10-15T10:59:30.000Z' },
      run('live', 'running', 4, 'live-1'),
      run('waiting', 'running', 5, 'task-waiting'),
      run('done', 'done', 6, 'task-gone'),
    ];
    getTask.mockImplementation((taskId) => {
      if (taskId === 'live-1') return { state: 'RUNNING' } as never;
      if (taskId === 'task-waiting') return { state: 'WAITING' } as never;
      if (taskId === 'task-finished') return { state: 'FINISHED' } as never;
      return null;
    });

    sweepInterrupted();

    const updated = connection.update.mock.calls.map(([{ key }]) => key).sort();
    expect(updated).toEqual(['finished', 'gone', 'unstarted']);
    const { editor } = connection.update.mock.calls[0][0];
    expect(editor({ status: 'running' })).toEqual({
      status: 'failed',
      error: INTERRUPTED,
      finishedAt: NOW.toISOString(),
    });
  });

  it('should apply retention to every runs folder', () => {
    stored = [
      folder('nightly'),
      ...Array.from({ length: MAX_RUNS + 1 }, (_, i) => run(`r${i}`, 'done', i)),
    ];

    sweepInterrupted();

    expect(connection.delete).toHaveBeenCalledOnce();
    expect(connection.delete).toHaveBeenCalledWith('r0');
  });
});
