import * as auditLib from '/lib/xp/auditlog';
import * as authLib from '/lib/xp/auth';
import * as contextLib from '/lib/xp/context';
import * as schedulerLib from '/lib/xp/scheduler';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolsConfig } from '../../main/resources/lib/config';
import type { Tool, ToolOutcome } from '../../main/resources/lib/mcp';
import type { Run } from '../../main/resources/lib/runs';
import type { Workflow } from '../../main/resources/lib/workflows';
import type { ScheduledJob } from '/lib/xp/scheduler';

import * as runStartLib from '../../main/resources/lib/run-start';
import * as runsLib from '../../main/resources/lib/runs';
import * as timeZoneLib from '../../main/resources/lib/time-zone';
import {
  createWorkflowTools,
  MAX_TOOL_OUTPUT,
  workflowInstructions,
} from '../../main/resources/lib/workflow-tools';
import * as workflowsLib from '../../main/resources/lib/workflows';

vi.mock('../../main/resources/lib/workflows', () => ({ getById: vi.fn(), list: vi.fn() }));
vi.mock('../../main/resources/lib/runs', () => ({
  RUN_TASK: 'com.enonic.app.grieg:run-workflow',
  MAX_RUNS: 20,
  getRun: vi.fn(),
  lastRun: vi.fn(),
  listRuns: vi.fn(),
}));
vi.mock('../../main/resources/lib/run-start', () => ({ startRun: vi.fn() }));
vi.mock('../../main/resources/lib/time-zone', () => ({ isTimeZone: vi.fn() }));

type JsonObject = Record<string, unknown>;
type Schema = {
  properties: Record<string, { type: unknown; items: Schema; required: string[] }>;
  required: string[];
};

const auditLog = vi.mocked(auditLib.log);
const hasRole = vi.mocked(authLib.hasRole);
const getContext = vi.mocked(contextLib.get);
const create = vi.mocked(schedulerLib.create);
const deleteJob = vi.mocked(schedulerLib.deleteJob);
const getJob = vi.mocked(schedulerLib.get);
const listJobs = vi.mocked(schedulerLib.list);
const modify = vi.mocked(schedulerLib.modify);
const getById = vi.mocked(workflowsLib.getById);
const listWorkflows = vi.mocked(workflowsLib.list);
const getRun = vi.mocked(runsLib.getRun);
const lastRun = vi.mocked(runsLib.lastRun);
const listRuns = vi.mocked(runsLib.listRuns);
const startRun = vi.mocked(runStartLib.startRun);
const isTimeZone = vi.mocked(timeZoneLib.isTimeZone);

const BASE = 'http://localhost:8080/admin/tool/com.enonic.app.grieg/main';
const ADMIN_URL = `${BASE}/workflows/wf-1`;
const RUN_TASK = 'com.enonic.app.grieg:run-workflow';
const NAME = 'grieg-workflow-wf-1';

const CONFIG: ToolsConfig = {
  project: 'default',
  branch: 'draft',
  user: 'alice',
  idProvider: 'system',
  credential: 'key',
  admin: true,
  allowedOrigins: [],
  allowedHosts: [],
  toolsets: ['workflows'],
  readOnly: false,
  nodeRepos: [],
};

const WORKFLOW: Workflow = {
  id: 'wf-1',
  name: 'weekly-digest',
  displayName: 'Weekly digest',
  enabled: false,
  steps: [
    { id: 'a', type: 'llm', config: { prompt: 'secret prompt' } },
    { id: 'b', type: 'llm', config: { prompt: 'second prompt' } },
  ],
  modifiedAt: '',
};

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    workflowId: 'wf-1',
    status: 'done',
    trigger: 'manual',
    user: 'user:system:alice',
    taskId: 'task-1',
    startedAt: '2026-10-15T10:00:00.000Z',
    finishedAt: '2026-10-15T10:00:03.000Z',
    steps: [{ id: 'a', output: 'short', ms: 1200 }],
    output: 'short',
    ...overrides,
  };
}

function job(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    name: NAME,
    descriptor: RUN_TASK,
    enabled: true,
    config: { workflowId: 'wf-1' },
    user: 'user:system:bob',
    creator: 'user:system:bob',
    modifier: 'user:system:bob',
    createdTime: '2026-10-01T00:00:00Z',
    modifiedTime: '2026-10-01T00:00:00Z',
    schedule: { type: 'CRON', value: '0 2 * * *', timeZone: 'Europe/Oslo' },
    ...overrides,
  };
}

const FOREIGN = job({
  name: 'purge-trash',
  descriptor: 'com.example.app:purge',
  config: {},
  user: 'user:system:cleanup',
});

function tool(name: string, config = CONFIG): Tool {
  const found = createWorkflowTools(config, BASE).find((t) => t.name === name);
  if (found == null) throw new Error(`no tool ${name}`);
  return found;
}

function value(outcome: ToolOutcome): JsonObject {
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.value;
}

function message(outcome: ToolOutcome): string {
  if (outcome.ok) throw new Error('expected a failed outcome');
  return outcome.message;
}

// Runs the editor `modify` was given against `current`, as lib-scheduler does.
function edited(current: ScheduledJob): ScheduledJob {
  const { editor } = modify.mock.calls[0][0];
  return editor(current);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('log', { info: vi.fn(), warning: vi.fn(), error: vi.fn() });
  vi.mocked(contextLib.run).mockImplementation((_context, callback) => callback());
  getContext.mockReturnValue({
    attributes: {},
    authInfo: { user: { login: 'alice', idProvider: 'system' } as never },
  });
  hasRole.mockImplementation((role) => role === 'system.admin');
  getById.mockImplementation((id) => (id === 'wf-1' ? WORKFLOW : undefined));
  listWorkflows.mockReturnValue([WORKFLOW]);
  listJobs.mockReturnValue([]);
  getJob.mockReturnValue(null);
  isTimeZone.mockReturnValue(true);
  create.mockImplementation((params) => job(params as never));
  modify.mockImplementation(({ editor }) => editor(job()));
});

describe('admin gate', () => {
  it.each([
    ['workflow_list', {}],
    ['workflow_run', { workflowId: 'wf-1' }],
    ['run_list', { workflowId: 'wf-1' }],
    ['run_get', { workflowId: 'wf-1', runId: 'run-1' }],
    ['cron_list', {}],
    ['cron_set', { workflowId: 'wf-1', enabled: false }],
    ['cron_delete', { workflowId: 'wf-1' }],
  ])('should refuse %s for a user who lost the admin role since tools/list', (name, args) => {
    hasRole.mockReturnValue(false);

    expect(message(tool(name).handler(args))).toBe(
      'The workflow tools require role:system.admin, which user:system:alice does not hold.',
    );
    expect(getById).not.toHaveBeenCalled();
    expect(listWorkflows).not.toHaveBeenCalled();
    expect(startRun).not.toHaveBeenCalled();
    expect(listJobs).not.toHaveBeenCalled();
    expect(getJob).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('should check the role inside the acting user context', () => {
    const open: unknown[] = [];
    const seen: unknown[][] = [];
    vi.mocked(contextLib.run).mockImplementation((context, callback) => {
      open.push(context);
      try {
        return callback();
      } finally {
        open.pop();
      }
    });
    hasRole.mockImplementation((role) => {
      seen.push([...open]);
      return role === 'system.admin';
    });

    tool('cron_list').handler({});

    expect(seen).toEqual([[{ user: { login: 'alice', idProvider: 'system' } }]]);
    expect(hasRole).toHaveBeenCalledWith('system.admin');
  });
});

describe('workflow_list', () => {
  it('should list each workflow with its schedule, last run and admin link, but no prompts', () => {
    listJobs.mockReturnValue([job(), FOREIGN]);
    lastRun.mockReturnValue(run());

    const result = value(tool('workflow_list').handler({}));

    expect(result).toEqual({
      workflows: [
        {
          id: 'wf-1',
          name: 'weekly-digest',
          displayName: 'Weekly digest',
          description: null,
          stepCount: 2,
          schedule: {
            name: NAME,
            cron: '0 2 * * *',
            timeZone: 'Europe/Oslo',
            enabled: true,
            user: 'user:system:bob',
          },
          lastRun: {
            id: 'run-1',
            status: 'done',
            trigger: 'manual',
            startedAt: '2026-10-15T10:00:00.000Z',
            finishedAt: '2026-10-15T10:00:03.000Z',
          },
          adminUrl: ADMIN_URL,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('prompt');
  });

  it('should not take a run-workflow job under another name for the schedule', () => {
    listJobs.mockReturnValue([job({ name: 'hand-made' })]);

    const [workflow] = value(tool('workflow_list').handler({})).workflows as JsonObject[];

    expect(workflow.schedule).toBeNull();
  });

  it('should report null for a workflow without a schedule or runs', () => {
    const [workflow] = value(tool('workflow_list').handler({})).workflows as JsonObject[];

    expect(workflow).toMatchObject({ schedule: null, lastRun: null });
  });
});

describe('workflow_run', () => {
  it('should start a run as the acting user and audit the run node', () => {
    startRun.mockReturnValue({ ok: true, runId: 'run-2', status: 'running', taskId: 'task-2' });

    const result = value(tool('workflow_run').handler({ workflowId: 'wf-1' }));

    expect(startRun).toHaveBeenCalledWith(WORKFLOW, 'user:system:alice');
    expect(result).toEqual({
      runId: 'run-2',
      status: 'running',
      taskId: 'task-2',
      adminUrl: ADMIN_URL,
    });
    expect(auditLog).toHaveBeenCalledExactlyOnceWith({
      type: 'grieg.mcp.workflow_run',
      user: 'user:system:alice',
      objects: ['com.enonic.app.grieg:master:run-2'],
      data: { tool: 'workflow_run', fields: [] },
    });
  });

  it('should report a skipped run with no task', () => {
    startRun.mockReturnValue({ ok: true, runId: 'run-2', status: 'skipped' });

    expect(value(tool('workflow_run').handler({ workflowId: 'wf-1' }))).toMatchObject({
      status: 'skipped',
      taskId: null,
    });
  });

  it('should fail without an audit entry when the task cannot be started', () => {
    startRun.mockReturnValue({ ok: false, message: 'The run task could not be started' });

    expect(message(tool('workflow_run').handler({ workflowId: 'wf-1' }))).toBe(
      'The run task could not be started. Check the XP log, then retry.',
    );
    expect(auditLog).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown workflow', { workflowId: 'gone' }, 'No workflow with id gone. Call workflow_list'],
    ['a missing workflow id', {}, 'Pass `workflowId`'],
  ])('should refuse %s', (_label, args, expected) => {
    expect(message(tool('workflow_run').handler(args))).toContain(expected);
    expect(startRun).not.toHaveBeenCalled();
  });
});

describe('run_list', () => {
  it('should list the newest runs up to count, without outputs', () => {
    listRuns.mockReturnValue([run({ id: 'r3' }), run({ id: 'r2' }), run({ id: 'r1' })]);

    const result = value(tool('run_list').handler({ workflowId: 'wf-1', count: 2 }));

    expect(result.runs).toEqual([
      expect.objectContaining({ id: 'r3', status: 'done', error: null }),
      expect.objectContaining({ id: 'r2' }),
    ]);
    expect(JSON.stringify(result)).not.toContain('short');
    expect(result).toMatchObject({ workflowId: 'wf-1', adminUrl: ADMIN_URL });
  });

  it.each([0, 21, 1.5, '5'])('should refuse count %s', (count) => {
    expect(message(tool('run_list').handler({ workflowId: 'wf-1', count }))).toBe(
      '`count` must be an integer from 1 to 20.',
    );
    expect(listRuns).not.toHaveBeenCalled();
  });

  it.each([1, 20])('should accept count %s', (count) => {
    listRuns.mockReturnValue(Array.from({ length: 25 }, (_, i) => run({ id: `r${i}` })));

    const result = value(tool('run_list').handler({ workflowId: 'wf-1', count }));

    expect(result.runs).toHaveLength(count);
  });
});

describe('run_get', () => {
  it('should return the run with its steps', () => {
    getById.mockReturnValue({ ...WORKFLOW, modifiedAt: '2026-10-14T08:00:00.000Z' });
    getRun.mockReturnValue(run({ steps: [{ id: 'a', error: 'quota exceeded', ms: 40 }] }));

    expect(value(tool('run_get').handler({ workflowId: 'wf-1', runId: 'run-1' }))).toEqual({
      id: 'run-1',
      workflowId: 'wf-1',
      status: 'done',
      trigger: 'manual',
      user: 'user:system:alice',
      workflow: {
        displayName: 'Weekly digest',
        stepIds: ['a', 'b'],
        modifiedAt: '2026-10-14T08:00:00.000Z',
      },
      taskId: 'task-1',
      startedAt: '2026-10-15T10:00:00.000Z',
      finishedAt: '2026-10-15T10:00:03.000Z',
      error: null,
      steps: [{ id: 'a', ms: 40, output: null, error: 'quota exceeded' }],
      output: 'short',
      adminUrl: ADMIN_URL,
    });
  });

  it('should return exactly the fields its output schema requires', () => {
    getRun.mockReturnValue(run());

    const result = value(tool('run_get').handler({ workflowId: 'wf-1', runId: 'run-1' }));
    const schema = tool('run_get').outputSchema as Schema;

    expect(Object.keys(result).sort()).toEqual([...schema.required].sort());
    expect(Object.keys(result.workflow as JsonObject).sort()).toEqual(
      [...schema.properties.workflow.required].sort(),
    );
  });

  it('should cap each output over the limit and mark it truncated', () => {
    const long = `${'x'.repeat(MAX_TOOL_OUTPUT)}y`;
    getRun.mockReturnValue(run({ steps: [{ id: 'a', output: long, ms: 1 }], output: long }));

    const result = value(tool('run_get').handler({ workflowId: 'wf-1', runId: 'run-1' }));

    expect(result).toMatchObject({ output: 'x'.repeat(MAX_TOOL_OUTPUT), truncated: true });
    expect((result.steps as JsonObject[])[0]).toMatchObject({
      output: 'x'.repeat(MAX_TOOL_OUTPUT),
      truncated: true,
    });
  });

  it('should not end a capped output on half of a surrogate pair', () => {
    const emoji = `${'x'.repeat(MAX_TOOL_OUTPUT - 1)}\u{1F600}y`;
    getRun.mockReturnValue(run({ steps: [], output: emoji }));

    const result = value(tool('run_get').handler({ workflowId: 'wf-1', runId: 'run-1' }));

    expect(result.output).toBe('x'.repeat(MAX_TOOL_OUTPUT - 1));
    expect(result.truncated).toBe(true);
  });

  it('should leave an output of exactly the limit whole and unmarked', () => {
    const full = 'x'.repeat(MAX_TOOL_OUTPUT);
    getRun.mockReturnValue(run({ steps: [{ id: 'a', output: full, ms: 1 }], output: full }));

    const result = value(tool('run_get').handler({ workflowId: 'wf-1', runId: 'run-1' }));

    expect(result.output).toBe(full);
    expect(result).not.toHaveProperty('truncated');
    expect((result.steps as JsonObject[])[0]).not.toHaveProperty('truncated');
  });

  it.each([
    ['a missing run', undefined],
    ['a run of another workflow', run({ workflowId: 'wf-2' })],
  ])('should refuse %s', (_label, found) => {
    getRun.mockReturnValue(found);

    expect(message(tool('run_get').handler({ workflowId: 'wf-1', runId: 'run-1' }))).toBe(
      'No run run-1 of workflow wf-1. Call run_list for run ids.',
    );
  });
});

describe('cron_list', () => {
  it('should list workflow schedules first, naming their workflow', () => {
    listJobs.mockReturnValue([FOREIGN, job()]);

    const { jobs } = value(tool('cron_list').handler({})) as { jobs: JsonObject[] };

    expect(jobs.map((j) => j.name)).toEqual([NAME, 'purge-trash']);
    expect(jobs[0]).toMatchObject({
      workflowId: 'wf-1',
      workflowName: 'Weekly digest',
      adminUrl: ADMIN_URL,
      user: 'user:system:bob',
    });
    expect(jobs[1]).not.toHaveProperty('adminUrl');
    expect(jobs[1]).not.toHaveProperty('workflowName');
  });

  it('should write every missing optional field as null, which the schema allows', () => {
    listJobs.mockReturnValue([
      {
        ...FOREIGN,
        user: undefined,
        schedule: { type: 'ONE_TIME', value: '2026-11-01T00:00:00Z' },
      },
    ]);

    const { jobs } = value(tool('cron_list').handler({})) as { jobs: JsonObject[] };

    expect(jobs[0]).toEqual({
      name: 'purge-trash',
      description: null,
      enabled: true,
      cron: null,
      timeZone: null,
      descriptor: 'com.example.app:purge',
      user: null,
      workflowId: null,
      lastRun: null,
      lastTaskId: null,
    });
    const schema = (tool('cron_list').outputSchema as Schema).properties.jobs.items;
    expect(Object.keys(jobs[0]).sort()).toEqual([...schema.required].sort());
    for (const [key, field] of Object.entries(jobs[0])) {
      if (field === null) expect(schema.properties[key].type).toContain('null');
    }
  });
});

describe('cron_set', () => {
  it('should create a schedule as the acting user, with the REST defaults', () => {
    const result = value(tool('cron_set').handler({ workflowId: 'wf-1', cron: ' 0 6 * * 1 ' }));

    expect(create).toHaveBeenCalledWith({
      name: NAME,
      descriptor: RUN_TASK,
      config: { workflowId: 'wf-1' },
      schedule: { type: 'CRON', value: '0 6 * * 1', timeZone: 'UTC' },
      enabled: true,
      user: 'user:system:alice',
    });
    expect(result).toMatchObject({
      name: NAME,
      workflowName: 'Weekly digest',
      adminUrl: ADMIN_URL,
    });
    expect(auditLog).toHaveBeenCalledExactlyOnceWith({
      type: 'grieg.mcp.cron_set',
      user: 'user:system:alice',
      objects: [`scheduler:${NAME}`],
      data: { tool: 'cron_set', fields: ['cron', 'timeZone', 'enabled', 'user'] },
    });
  });

  it('should re-own an existing workflow schedule, even when only enabled changes', () => {
    getJob.mockReturnValue(job());

    value(tool('cron_set').handler({ workflowId: 'wf-1', enabled: false }));

    expect(create).not.toHaveBeenCalled();
    expect(edited(job())).toMatchObject({
      enabled: false,
      schedule: { value: '0 2 * * *', timeZone: 'Europe/Oslo' },
      user: 'user:system:alice',
    });
    expect(auditLog.mock.calls[0][0].data).toEqual({
      tool: 'cron_set',
      fields: ['enabled', 'user'],
    });
  });

  it("should toggle another application's job by name and keep its user", () => {
    getJob.mockReturnValue(FOREIGN);
    modify.mockImplementation(({ editor }) => editor(FOREIGN));

    const result = value(tool('cron_set').handler({ name: 'purge-trash', enabled: false }));

    expect(edited(FOREIGN)).toMatchObject({ enabled: false, user: 'user:system:cleanup' });
    expect(result).toMatchObject({
      name: 'purge-trash',
      user: 'user:system:cleanup',
      workflowId: null,
      lastRun: null,
    });
    expect(auditLog.mock.calls[0][0]).toMatchObject({
      objects: ['scheduler:purge-trash'],
      data: { fields: ['enabled'] },
    });
  });

  it('should write no audit entry when a save changes nothing', () => {
    getJob.mockReturnValue(FOREIGN);
    modify.mockImplementation(({ editor }) => editor(FOREIGN));

    value(tool('cron_set').handler({ name: 'purge-trash', enabled: true }));

    expect(auditLog).not.toHaveBeenCalled();
  });

  it.each([
    ['a workflow schedule', job()],
    ['a hand-made job of the run task', job({ name: 'hand-made', config: {} })],
  ])('should refuse %s addressed by name, which would re-own it', (_label, found) => {
    getJob.mockReturnValue(found);

    expect(message(tool('cron_set').handler({ name: found.name, enabled: false }))).toBe(
      `\`${found.name}\` runs grieg workflows: address a workflow schedule by \`workflowId\` instead of \`name\`.`,
    );
    expect(modify).not.toHaveBeenCalled();
  });

  it('should refuse a workflow schedule name held by another application', () => {
    getJob.mockReturnValue({ ...FOREIGN, name: NAME });

    expect(message(tool('cron_set').handler({ workflowId: 'wf-1', enabled: true }))).toContain(
      'belongs to another application',
    );
    expect(modify).not.toHaveBeenCalled();
  });

  it('should name the cron the scheduler refuses', () => {
    create.mockImplementation(() => {
      throw new Error("'value' param is not a cron value: '99 6 * * *'");
    });

    expect(message(tool('cron_set').handler({ workflowId: 'wf-1', cron: '99 6 * * *' }))).toMatch(
      /^The scheduler refused the cron expression `99 6 \* \* \*`\. A cron has five fields/,
    );
    expect(auditLog).not.toHaveBeenCalled();
  });

  it.each<[string, JsonObject, string]>([
    ['no target', { enabled: true }, 'Pass either `workflowId`'],
    ['both targets', { workflowId: 'wf-1', name: 'x', enabled: true }, 'Pass either `workflowId`'],
    ['nothing to set', { workflowId: 'wf-1' }, 'Pass at least one of'],
    ['a cron by name', { name: 'purge-trash', cron: '0 6 * * *' }, 'By `name` only `enabled`'],
    ['an unknown workflow', { workflowId: 'gone', enabled: true }, 'No workflow with id gone'],
    ['a new schedule without cron', { workflowId: 'wf-1', enabled: true }, 'pass `cron` to create'],
    ['a non-boolean enabled', { workflowId: 'wf-1', enabled: 'yes' }, '`enabled` must be'],
  ])('should refuse %s without touching the scheduler', (_label, args, expected) => {
    expect(message(tool('cron_set').handler(args))).toContain(expected);
    expect(create).not.toHaveBeenCalled();
    expect(modify).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('should refuse a time zone the JVM does not know', () => {
    isTimeZone.mockReturnValue(false);

    expect(
      message(
        tool('cron_set').handler({ workflowId: 'wf-1', cron: '0 6 * * *', timeZone: 'Mars' }),
      ),
    ).toBe('Unknown time zone Mars. Use a time zone id such as Europe/Oslo or UTC.');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('cron_delete', () => {
  it('should delete a workflow schedule and audit it', () => {
    getJob.mockReturnValue(job());

    expect(value(tool('cron_delete').handler({ workflowId: 'wf-1' }))).toEqual({
      name: NAME,
      workflowId: 'wf-1',
      adminUrl: ADMIN_URL,
    });
    expect(deleteJob).toHaveBeenCalledWith({ name: NAME });
    expect(auditLog).toHaveBeenCalledExactlyOnceWith({
      type: 'grieg.mcp.cron_delete',
      user: 'user:system:alice',
      objects: [`scheduler:${NAME}`],
      data: { tool: 'cron_delete', fields: [] },
    });
  });

  it('should refuse a workflow without a schedule', () => {
    expect(message(tool('cron_delete').handler({ workflowId: 'wf-1' }))).toBe(
      'Workflow wf-1 has no schedule. Call cron_list for schedules.',
    );
    expect(auditLog).not.toHaveBeenCalled();
  });

  it("should refuse to delete another application's job", () => {
    getJob.mockReturnValue({ ...FOREIGN, name: NAME });

    expect(message(tool('cron_delete').handler({ workflowId: 'wf-1' }))).toContain(
      'Only a workflow schedule can be deleted',
    );
    expect(deleteJob).not.toHaveBeenCalled();
  });
});

describe('workflowInstructions', () => {
  it('should explain asynchronous runs and the default time zone', () => {
    const text = workflowInstructions(CONFIG);

    expect(text).toContain('workflow_run returns a runId at once');
    expect(text).toContain('defaults to UTC');
  });

  it('should leave the write tools out when read-only', () => {
    const text = workflowInstructions({ ...CONFIG, readOnly: true });

    expect(text).toContain('workflow_list');
    expect(text).toContain('`adminUrl`');
    expect(text).not.toContain('workflow_run');
    expect(text).not.toContain('cron_set');
  });
});
