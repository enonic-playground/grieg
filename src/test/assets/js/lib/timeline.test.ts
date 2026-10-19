import { describe, expect, it } from 'vitest';

import type { TimelinePlan, TimelineRun } from '../../../../main/resources/assets/js/lib/timeline';

import { runTimeline } from '../../../../main/resources/assets/js/lib/timeline';

const STARTED = '2026-10-15T10:00:00.000Z';

const PLAN: TimelinePlan = {
  stepIds: ['outline', 'draft', 'polish'],
  modifiedAt: '2026-10-14T08:00:00.000Z',
};

function run(overrides: Partial<TimelineRun> = {}): TimelineRun {
  return { status: 'running', startedAt: STARTED, steps: [], ...overrides };
}

const states = (steps: ReturnType<typeof runTimeline>) =>
  steps.map((step) => `${step.id}:${step.state}`);

describe('runTimeline', () => {
  it('should show the first planned step running and the rest pending before any step ends', () => {
    const steps = runTimeline(run(), PLAN);

    expect(states(steps)).toEqual(['outline:running', 'draft:pending', 'polish:pending']);
    expect(steps[0].since).toBe(Date.parse(STARTED));
  });

  it('should keep finished steps and start the next one after their combined duration', () => {
    const steps = runTimeline(
      run({
        steps: [
          { id: 'outline', ms: 1200, output: 'Points' },
          { id: 'draft', ms: 800, output: null, error: null, truncated: true },
        ],
      }),
      PLAN,
    );

    expect(states(steps)).toEqual(['outline:done', 'draft:done', 'polish:running']);
    expect(steps[0]).toEqual({ id: 'outline', state: 'done', ms: 1200, output: 'Points' });
    expect(steps[1]).toEqual({ id: 'draft', state: 'done', ms: 800, truncated: true });
    expect(steps[2].since).toBe(Date.parse(STARTED) + 2000);
  });

  it('should mark the steps after a failed one as not run', () => {
    const steps = runTimeline(
      run({ status: 'failed', steps: [{ id: 'outline', ms: 900, error: 'quota exceeded' }] }),
      PLAN,
    );

    expect(states(steps)).toEqual(['outline:failed', 'draft:skipped', 'polish:skipped']);
    expect(steps[0].error).toBe('quota exceeded');
  });

  it('should mark every planned step as not run when an interrupted run recorded none', () => {
    expect(states(runTimeline(run({ status: 'failed' }), PLAN))).toEqual([
      'outline:skipped',
      'draft:skipped',
      'polish:skipped',
    ]);
  });

  it.each([
    ['done', 'done'],
    ['skipped', 'skipped'],
  ] as const)('should show only the recorded steps of a %s run', (_label, status) => {
    const steps = runTimeline(run({ status, steps: [{ id: 'outline', ms: 5 }] }), PLAN);

    expect(states(steps)).toEqual(['outline:done']);
  });

  it('should not invent steps when the workflow changed after the run started', () => {
    const edited = { ...PLAN, modifiedAt: '2026-10-15T10:00:01.000Z' };

    expect(states(runTimeline(run({ steps: [{ id: 'outline', ms: 5 }] }), edited))).toEqual([
      'outline:done',
    ]);
  });

  it('should plan the remaining steps when the workflow last changed as the run started', () => {
    const steps = runTimeline(run({ steps: [{ id: 'outline', ms: 5 }] }), {
      ...PLAN,
      modifiedAt: STARTED,
    });

    expect(states(steps)).toEqual(['outline:done', 'draft:running', 'polish:pending']);
  });

  it('should not invent steps when the recorded steps disagree with the workflow', () => {
    const steps = runTimeline(run({ steps: [{ id: 'renamed', ms: 5 }] }), PLAN);

    expect(states(steps)).toEqual(['renamed:done']);
  });

  it('should show only the recorded steps without a workflow', () => {
    expect(states(runTimeline(run({ steps: [{ id: 'outline', ms: 5 }] })))).toEqual([
      'outline:done',
    ]);
  });
});
