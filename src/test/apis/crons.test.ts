import * as authLib from '/lib/xp/auth';
import * as schedulerLib from '/lib/xp/scheduler';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScheduledJob } from '/lib/xp/scheduler';
import type { Request, Response } from '@enonic-types/core';

import * as api from '../../main/resources/apis/crons/crons';
import * as timeZoneLib from '../../main/resources/lib/time-zone';
import * as workflowsLib from '../../main/resources/lib/workflows';

vi.mock('../../main/resources/lib/runs', () => ({
  RUN_TASK: 'com.enonic.app.grieg:run-workflow',
}));
vi.mock('../../main/resources/lib/workflows', () => ({ getById: vi.fn() }));
vi.mock('../../main/resources/lib/time-zone', () => ({ isTimeZone: vi.fn() }));

const getUser = vi.mocked(authLib.getUser);
const hasRole = vi.mocked(authLib.hasRole);
const create = vi.mocked(schedulerLib.create);
const deleteJob = vi.mocked(schedulerLib.deleteJob);
const getJob = vi.mocked(schedulerLib.get);
const listJobs = vi.mocked(schedulerLib.list);
const modify = vi.mocked(schedulerLib.modify);
const getById = vi.mocked(workflowsLib.getById);
const isTimeZone = vi.mocked(timeZoneLib.isTimeZone);

const RUN_TASK = 'com.enonic.app.grieg:run-workflow';
const NAME = 'grieg-workflow-wf-1';

function job(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    name: NAME,
    descriptor: RUN_TASK,
    enabled: true,
    config: { workflowId: 'wf-1' },
    user: 'user:system:alice',
    creator: 'user:system:alice',
    modifier: 'user:system:alice',
    createdTime: '2026-10-01T00:00:00Z',
    modifiedTime: '2026-10-01T00:00:00Z',
    schedule: { type: 'CRON', value: '0 2 * * *', timeZone: 'Europe/Oslo' },
    ...overrides,
  };
}

const FOREIGN = job({
  name: 'purge-trash',
  descriptor: 'com.example.app:purge',
  config: { workflowId: 'wf-1' },
  user: 'user:system:cleanup',
});

function request(params: Record<string, string>, body?: unknown): Request {
  return { params, body: body == null ? undefined : JSON.stringify(body) } as unknown as Request;
}

function json(response: Response): Record<string, unknown> {
  return JSON.parse(response.body as string);
}

// Runs the editor `modify` was given against `current`, as lib-scheduler does.
function edited(current: ScheduledJob): ScheduledJob {
  const { editor } = modify.mock.calls[0][0];
  return editor(current);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('log', { info: vi.fn(), warning: vi.fn(), error: vi.fn() });
  hasRole.mockImplementation((role) => role === 'system.admin');
  getUser.mockReturnValue({ key: 'user:system:su' } as never);
  getById.mockReturnValue({ id: 'wf-1' } as never);
  isTimeZone.mockReturnValue(true);
  getJob.mockReturnValue(null);
  create.mockImplementation((params) => job({ ...params, user: params.user } as never));
  modify.mockImplementation(({ editor }) => editor(job()));
});

describe('access', () => {
  it.each([
    ['GET', () => api.get(request({}))],
    ['PUT', () => api.put(request({ name: NAME }, { enabled: false }))],
    ['DELETE', () => api.delete(request({ name: NAME }))],
  ])('should refuse %s from a caller who is not an admin', (_method, call) => {
    hasRole.mockReturnValue(false);
    getJob.mockReturnValue(job());

    expect(call().status).toBe(403);
    expect(listJobs).not.toHaveBeenCalled();
    expect(modify).not.toHaveBeenCalled();
    expect(deleteJob).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  it('should return the workflow schedule by workflow id', () => {
    getJob.mockReturnValueOnce(job());
    expect(json(api.get(request({ workflowId: 'wf-1' }))).data).toMatchObject({
      name: NAME,
      cron: '0 2 * * *',
      user: 'user:system:alice',
      workflowId: 'wf-1',
    });
    expect(getJob).toHaveBeenCalledWith({ name: NAME });
  });

  it('should return null for a workflow without a schedule', () => {
    expect(json(api.get(request({ workflowId: 'wf-2' }))).data).toBeNull();
  });

  it('should not report another application job as a workflow schedule', () => {
    getJob.mockReturnValue({ ...FOREIGN, name: NAME });
    expect(json(api.get(request({ workflowId: 'wf-1' }))).data).toBeNull();
  });

  it('should list every job with its user, and a workflow id only on workflow schedules', () => {
    listJobs.mockReturnValue([job(), FOREIGN]);
    const { jobs } = json(api.get(request({}))).data as { jobs: Record<string, unknown>[] };

    expect(jobs[0]).toMatchObject({ user: 'user:system:alice', workflowId: 'wf-1' });
    expect(jobs[1]).toMatchObject({ user: 'user:system:cleanup' });
    expect(jobs[1].workflowId).toBeUndefined();
  });
});

describe('POST', () => {
  it('should create the job as the caller, whatever user the body names', () => {
    const response = api.post(
      request({}, { workflowId: 'wf-1', cron: ' 0 6 * * 1 ', user: 'user:system:mallory' }),
    );

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith({
      name: NAME,
      descriptor: RUN_TASK,
      config: { workflowId: 'wf-1' },
      schedule: { type: 'CRON', value: '0 6 * * 1', timeZone: 'UTC' },
      enabled: true,
      user: 'user:system:su',
    });
    expect(json(response).data).toMatchObject({ user: 'user:system:su', workflowId: 'wf-1' });
  });

  it('should keep the time zone and enabled the body sets', () => {
    api.post(
      request(
        {},
        { workflowId: 'wf-1', cron: '0 6 * * *', timeZone: 'Europe/Oslo', enabled: false },
      ),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule: { type: 'CRON', value: '0 6 * * *', timeZone: 'Europe/Oslo' },
        enabled: false,
      }),
    );
  });

  it.each([
    ['no cron', { workflowId: 'wf-1', enabled: true }],
    ['four fields', { workflowId: 'wf-1', cron: '0 6 * *' }],
    ['a non-cron character', { workflowId: 'wf-1', cron: '0 6 * * $' }],
    ['a non-boolean enabled', { workflowId: 'wf-1', cron: '0 6 * * *', enabled: 'yes' }],
    ['no workflow id', { cron: '0 6 * * *' }],
  ])('should refuse a body with %s before calling the scheduler', (_case, body) => {
    const response = api.post(request({}, body));
    expect(response.status).toBe(400);
    expect(json(response).code).toBe('BAD_REQUEST');
    expect(create).not.toHaveBeenCalled();
  });

  it('should refuse a time zone the JVM does not know', () => {
    isTimeZone.mockReturnValue(false);
    const response = api.post(
      request({}, { workflowId: 'wf-1', cron: '0 6 * * *', timeZone: 'Mars/Base' }),
    );
    expect(response.status).toBe(400);
    expect(json(response).code).toBe('INVALID_TIME_ZONE');
    expect(isTimeZone).toHaveBeenCalledWith('Mars/Base');
    expect(create).not.toHaveBeenCalled();
  });

  it('should report a cron the scheduler refuses as the caller mistake', () => {
    create.mockImplementation(() => {
      throw new Error("'value' param is not a cron value: '99 6 * * *'");
    });
    const response = api.post(request({}, { workflowId: 'wf-1', cron: '99 6 * * *' }));
    expect(response.status).toBe(400);
    expect(json(response).code).toBe('INVALID_CRON');
  });

  it('should answer 500 for any other scheduler failure', () => {
    create.mockImplementation(() => {
      throw new Error('Repository unavailable');
    });
    const response = api.post(request({}, { workflowId: 'wf-1', cron: '0 6 * * *' }));
    expect(response.status).toBe(500);
    expect(json(response).code).toBe('SCHEDULE_FAILED');
  });

  it('should answer 404 for a missing workflow', () => {
    getById.mockReturnValueOnce(undefined);
    const response = api.post(request({}, { workflowId: 'wf-1', cron: '0 6 * * *' }));
    expect(response.status).toBe(404);
    expect(json(response).code).toBe('NOT_FOUND');
    expect(create).not.toHaveBeenCalled();
  });

  it('should answer 409 when the workflow already has a schedule', () => {
    getJob.mockReturnValue(job());
    const response = api.post(request({}, { workflowId: 'wf-1', cron: '0 6 * * *' }));
    expect(response.status).toBe(409);
    expect(json(response).code).toBe('CONFLICT');
    expect(create).not.toHaveBeenCalled();
  });

  it('should refuse a caller who is not an admin', () => {
    hasRole.mockReturnValue(false);
    expect(api.post(request({}, { workflowId: 'wf-1', cron: '0 6 * * *' })).status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('PUT', () => {
  it('should change the cron of a workflow schedule and make the caller its user', () => {
    getJob.mockReturnValue(job());
    const response = api.put(request({ name: NAME }, { cron: '0 7 * * *' }));

    expect(response.status).toBe(200);
    expect(edited(job())).toMatchObject({
      enabled: true,
      schedule: { type: 'CRON', value: '0 7 * * *', timeZone: 'Europe/Oslo' },
      user: 'user:system:su',
    });
  });

  it('should re-own a workflow schedule even when only enabled changes', () => {
    getJob.mockReturnValue(job());
    api.put(request({ name: NAME }, { enabled: false }));
    expect(edited(job())).toMatchObject({
      enabled: false,
      schedule: { value: '0 2 * * *', timeZone: 'Europe/Oslo' },
      user: 'user:system:su',
    });
  });

  it('should toggle another application job without changing its user', () => {
    getJob.mockReturnValue(FOREIGN);
    api.put(request({ name: 'purge-trash' }, { enabled: false }));
    expect(edited(FOREIGN)).toMatchObject({ enabled: false, user: 'user:system:cleanup' });
  });

  it('should refuse a cron or time zone change on another application job', () => {
    getJob.mockReturnValue(FOREIGN);
    expect(api.put(request({ name: 'purge-trash' }, { cron: '0 7 * * *' })).status).toBe(403);
    expect(api.put(request({ name: 'purge-trash' }, { timeZone: 'UTC' })).status).toBe(403);
    expect(modify).not.toHaveBeenCalled();
  });

  it('should answer 404 for a missing job without calling modify', () => {
    const response = api.put(request({ name: NAME }, { enabled: true }));
    expect(response.status).toBe(404);
    expect(modify).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty body', {}],
    ['an invalid cron', { cron: 'nightly' }],
  ])('should refuse %s', (_case, body) => {
    getJob.mockReturnValue(job());
    const response = api.put(request({ name: NAME }, body));
    expect(response.status).toBe(400);
    expect(json(response).code).toBe('BAD_REQUEST');
    expect(modify).not.toHaveBeenCalled();
  });

  it('should trim the cron it saves', () => {
    getJob.mockReturnValue(job());
    api.put(request({ name: NAME }, { cron: ' 0 7 * * * ' }));
    expect(edited(job()).schedule).toMatchObject({ value: '0 7 * * *' });
  });
});

describe('DELETE', () => {
  it('should delete a workflow schedule', () => {
    getJob.mockReturnValue(job());
    const response = api.delete(request({ name: NAME }));
    expect(response.status).toBe(200);
    expect(deleteJob).toHaveBeenCalledWith({ name: NAME });
  });

  it('should refuse to delete another application job', () => {
    getJob.mockReturnValue(FOREIGN);
    const response = api.delete(request({ name: 'purge-trash' }));
    expect(response.status).toBe(403);
    expect(json(response).code).toBe('FORBIDDEN');
    expect(deleteJob).not.toHaveBeenCalled();
  });

  it('should answer 404 for a missing job', () => {
    expect(api.delete(request({ name: NAME })).status).toBe(404);
    expect(deleteJob).not.toHaveBeenCalled();
  });
});
