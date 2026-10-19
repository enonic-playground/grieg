// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildConfig, renderRoute, screen, waitFor, within } from '../test-utils';

vi.mock('../../../../main/resources/assets/js/lib/api/client', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../../../../main/resources/assets/js/lib/config', () => ({
  getConfig: vi.fn(() => buildConfig()),
}));

import { apiFetch } from '../../../../main/resources/assets/js/lib/api/client';
import { runsQueryOptions } from '../../../../main/resources/assets/js/lib/api/workflows';

const mockedApiFetch = vi.mocked(apiFetch);

type FetchOptions = { method?: string; body?: unknown; params?: Record<string, string> };

type Step = { id: string; type: string; config?: { prompt?: string; model?: string } };

type Run = {
  id: string;
  workflowId: string;
  status: 'running' | 'done' | 'failed' | 'skipped';
  trigger: 'manual' | 'schedule';
  user: string;
  startedAt: string;
  finishedAt?: string;
  steps: { id: string; output?: string; error?: string; ms: number }[];
  output?: string;
  error?: string;
};

function buildWorkflow(overrides?: Record<string, unknown>) {
  return {
    id: 'wf-1',
    name: 'summarize',
    displayName: 'Summarize articles',
    enabled: true,
    steps: [{ id: 'outline', type: 'llm', config: { prompt: 'Outline it' } }] as Step[],
    modifiedAt: '2026-09-10T08:12:00Z',
    ...overrides,
  };
}

function buildRun(overrides?: Partial<Run>): Run {
  return {
    id: 'run-1',
    workflowId: 'wf-1',
    status: 'done',
    trigger: 'manual',
    user: 'user:system:su',
    startedAt: '2026-09-10T09:00:00Z',
    finishedAt: '2026-09-10T09:00:02Z',
    steps: [{ id: 'outline', output: 'Point one', ms: 1800 }],
    output: 'Point one',
    ...overrides,
  };
}

type Job = {
  name: string;
  enabled: boolean;
  cron?: string;
  timeZone?: string;
  descriptor: string;
  user?: string;
  workflowId?: string;
  lastRun?: string;
};

function buildJob(overrides?: Partial<Job>): Job {
  return {
    name: 'grieg-workflow-wf-1',
    enabled: true,
    cron: '0 2 * * *',
    timeZone: 'Europe/Oslo',
    descriptor: 'com.enonic.app.grieg:run-workflow',
    user: 'user:system:alice',
    workflowId: 'wf-1',
    ...overrides,
  };
}

type MockOptions = {
  workflows?: ReturnType<typeof buildWorkflow>[];
  runs?: Run[] | (() => Run[]);
  put?: (body: { steps: Step[] }) => unknown;
  run?: () => unknown;
  schedule?: Job | null;
  saveSchedule?: (options: FetchOptions) => unknown;
};

const CRONS_URL = buildConfig().apiUris.crons;

// Answers the crons API the way the server does for the workflow's own schedule.
function answerCrons(state: { schedule: Job | null }, options: FetchOptions): unknown {
  const { method = 'GET', body, params = {} } = options;
  if (method === 'GET' && params.workflowId == null) {
    return { jobs: state.schedule == null ? [] : [state.schedule] };
  }
  if (method === 'GET') return state.schedule;
  if (method === 'DELETE') {
    state.schedule = null;
    return { name: 'grieg-workflow-wf-1' };
  }
  const input = body as { cron: string; timeZone: string; enabled: boolean };
  state.schedule = buildJob({ ...state.schedule, ...input, user: 'user:system:su' });
  return state.schedule;
}

function mockWorkflowsApi({
  workflows: initial = [buildWorkflow()],
  runs = [],
  put,
  run,
  schedule = null,
  saveSchedule,
}: MockOptions = {}) {
  const workflows = [...initial];
  const calls: FetchOptions[] = [];
  const crons = { schedule };
  mockedApiFetch.mockImplementation(async (url: string, options: FetchOptions = {}) => {
    if (url === CRONS_URL) {
      cronCalls.push(options);
      if (options.method != null && saveSchedule != null) return saveSchedule(options);
      return answerCrons(crons, options);
    }
    calls.push(options);
    const { method = 'GET', params = {}, body } = options;
    const workflow = workflows.find((item) => item.id === params.id);
    if (method === 'GET' && params.id == null) return { workflows };
    if (params.id != null && workflow == null) {
      throw { status: 404, message: `No workflow with id ${params.id}` };
    }
    if (method === 'GET' && params.runs === 'true') {
      return { runs: typeof runs === 'function' ? runs() : runs };
    }
    if (method === 'GET') return workflow;
    if (method === 'POST' && params.action === 'run') {
      return run?.() ?? { runId: 'run-new', taskId: 'task-1', status: 'running' };
    }
    if (method === 'POST') {
      const input = body as { name: string; displayName?: string };
      // Like the server, a workflow without a display name shows its name.
      const created = buildWorkflow({
        id: 'wf-new',
        ...input,
        displayName: input.displayName ?? input.name,
        steps: [],
      });
      workflows.push(created);
      return created;
    }
    if (method === 'PUT') {
      return put?.(body as { steps: Step[] }) ?? { ...workflow, ...(body as object) };
    }
    throw new Error(`Unexpected ${method}`);
  });
  return calls;
}

let cronCalls: FetchOptions[] = [];

function getComponent(name: string): HTMLElement {
  const el = document.querySelector(`[data-component="${name}"]`);
  if (!el) throw new Error(`${name} not found`);
  return el as HTMLElement;
}

afterEach(() => {
  vi.useRealTimers();
  mockedApiFetch.mockReset();
  vi.restoreAllMocks();
  cronCalls = [];
});

describe('WorkflowsPage', () => {
  it('should render a row per workflow that links to its page', async () => {
    const step = { id: 'a', type: 'llm', config: { prompt: 'A' } };
    mockWorkflowsApi({
      workflows: [
        buildWorkflow(),
        buildWorkflow({ id: 'wf-2', displayName: 'Digest', steps: [step, step, step] }),
      ],
    });
    const { user, router } = renderRoute({ initialLocation: '/workflows' });

    const link = await screen.findByRole('link', { name: 'Summarize articles' });
    const rows = within(getComponent('WorkflowsPage')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('1')).toBeInTheDocument();
    expect(within(rows[1]).getByText('3')).toBeInTheDocument();

    await user.click(link);
    await waitFor(() => expect(router.state.location.pathname).toBe('/workflows/wf-1'));
  });

  it("should show each workflow's schedule and how long ago it was modified", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-12T08:12:00Z'));
    mockWorkflowsApi({
      // Stored `enabled` is ignored: only a schedule makes a workflow run on its own.
      workflows: [buildWorkflow(), buildWorkflow({ id: 'wf-2', displayName: 'Digest' })],
      schedule: buildJob(),
    });
    renderRoute({ initialLocation: '/workflows' });

    await screen.findByRole('link', { name: 'Summarize articles' });
    const [scheduled, unscheduled] = within(getComponent('WorkflowsPage'))
      .getAllByRole('row')
      .slice(1);
    expect(await within(scheduled).findByTitle('0 2 * * * · Europe/Oslo')).toHaveTextContent(
      'Daily at 02:00',
    );
    expect(within(unscheduled).getByText('Not scheduled')).toBeInTheDocument();
    const modified = within(scheduled).getByText('2 days ago');
    expect(modified).toHaveAttribute('dateTime', '2026-09-10T08:12:00Z');
  });

  it('should tell a failed schedule lookup apart from no schedule', async () => {
    mockWorkflowsApi();
    const answer = mockedApiFetch.getMockImplementation();
    mockedApiFetch.mockImplementation(async (url: string, options?: FetchOptions) => {
      if (url === CRONS_URL) throw { status: 500, message: 'Scheduler down' };
      return answer?.(url, options);
    });
    renderRoute({ initialLocation: '/workflows' });

    await screen.findByRole('link', { name: 'Summarize articles' });
    const [row] = within(getComponent('WorkflowsPage')).getAllByRole('row').slice(1);
    expect(await within(row).findByTitle('Something went wrong')).toHaveTextContent('-');
    expect(within(row).queryByText('Not scheduled')).toBeNull();
  });

  it('should create a workflow from the empty state and open it', async () => {
    const calls = mockWorkflowsApi({ workflows: [] });
    const { user, router } = renderRoute({ initialLocation: '/workflows' });

    expect(await screen.findByText('No workflows yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New workflow' }));
    await user.type(screen.getByLabelText('Name'), '  daily-digest  ');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(calls).toContainEqual({ method: 'POST', body: { name: 'daily-digest' } });
    await waitFor(() => expect(router.state.location.pathname).toBe('/workflows/wf-new'));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'daily-digest' }),
    ).toBeInTheDocument();
  });
});

describe('WorkflowPage', () => {
  it('should say when the workflow does not exist', async () => {
    mockWorkflowsApi();
    renderRoute({ initialLocation: '/workflows/missing' });

    expect(await screen.findByText('No workflow with this id.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Workflows');
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
  });

  it('should name the workflow in the header breadcrumb', async () => {
    mockWorkflowsApi();
    const { user, router } = renderRoute({ initialLocation: '/workflows/wf-1' });

    const breadcrumb = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(
      await within(breadcrumb).findByRole('heading', { level: 1, name: 'Summarize articles' }),
    ).toBeInTheDocument();
    await user.click(within(breadcrumb).getByRole('link', { name: 'Workflows' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/workflows'));
  });

  it('should show a paused schedule next to the workflow name', async () => {
    mockWorkflowsApi({ schedule: buildJob({ enabled: false }) });
    renderRoute({ initialLocation: '/workflows/wf-1' });

    const heading = await screen.findByRole('heading', { level: 2, name: 'Summarize articles' });
    const state = await within(heading.parentElement as HTMLElement).findByTitle(
      '0 2 * * * · Europe/Oslo',
    );
    expect(within(state).getByText('Paused')).toBeInTheDocument();
    expect(within(state).getByText('Daily at 02:00')).toBeInTheDocument();
  });

  it('should list the steps before the runs and the schedule', async () => {
    mockWorkflowsApi();
    renderRoute({ initialLocation: '/workflows/wf-1' });

    await screen.findByText('No runs yet.');
    const titles = screen.getAllByRole('heading', { level: 3 }).map((title) => title.textContent);
    expect(titles.filter((title) => ['Steps', 'Runs', 'Schedule'].includes(title ?? ''))).toEqual([
      'Steps',
      'Runs',
      'Schedule',
    ]);
  });

  it('should show that a workflow has no runs yet', async () => {
    mockWorkflowsApi();
    renderRoute({ initialLocation: '/workflows/wf-1' });

    expect(await screen.findByText('No runs yet.')).toBeInTheDocument();
  });

  it('should show a run with its trigger, user, step output and run output as text', async () => {
    mockWorkflowsApi({
      runs: [
        buildRun({
          trigger: 'schedule',
          steps: [{ id: 'outline', output: '<b>step</b>', ms: 1800 }],
          output: '<i>run</i>',
        }),
      ],
    });
    renderRoute({ initialLocation: '/workflows/wf-1' });

    const run = await waitFor(() => getComponent('RunItem'));
    expect(within(run).getByText('Done')).toBeInTheDocument();
    expect(within(run).getByText('Schedule')).toBeInTheDocument();
    expect(within(run).getByText('user:system:su')).toBeInTheDocument();
    expect(within(run).getByText('2.0 s')).toBeInTheDocument();
    expect(within(run).getByText('1.8 s')).toBeInTheDocument();
    expect(within(run).getByText('Step outline')).toBeInTheDocument();
    expect(within(run).getByText('<b>step</b>')).toBeInTheDocument();
    expect(within(run).getByText('<i>run</i>')).toBeInTheDocument();
    expect(run.querySelector('b, i')).toBeNull();
  });

  it('should not repeat the last step output as the run output', async () => {
    mockWorkflowsApi({
      runs: [
        buildRun({
          steps: [
            { id: 'outline', output: 'Point one', ms: 900 },
            { id: 'polish', output: 'Final text', ms: 900 },
          ],
          output: 'Final text',
        }),
      ],
    });
    renderRoute({ initialLocation: '/workflows/wf-1' });

    const run = await waitFor(() => getComponent('RunItem'));
    expect(within(run).getAllByText('Final text')).toHaveLength(1);
    expect(within(run).getAllByText('Point one')).toHaveLength(1);
    expect(within(run).queryByText('Run output')).toBeNull();
  });

  it("should show a failed run's step and run errors", async () => {
    mockWorkflowsApi({
      runs: [
        buildRun({
          status: 'failed',
          steps: [{ id: 'outline', error: 'Vertex AI returned 429', ms: 900 }],
          output: undefined,
          error: 'Run stopped at outline',
        }),
      ],
    });
    renderRoute({ initialLocation: '/workflows/wf-1' });

    const run = await waitFor(() => getComponent('RunItem'));
    expect(within(run).getByText('Failed')).toBeInTheDocument();
    expect(within(run).getByText('Vertex AI returned 429')).toBeInTheDocument();
    expect(within(run).getByText('Run stopped at outline')).toBeInTheDocument();
  });

  describe('step timeline', () => {
    const steps: Step[] = ['outline', 'draft', 'polish'].map((id) => ({ id, type: 'llm' }));

    function timeline(run: HTMLElement): (string | undefined)[][] {
      return Array.from(
        run.querySelectorAll<HTMLElement>('[data-component="TimelineStep"]'),
        (step) => [step.dataset.step, step.dataset.state],
      );
    }

    afterEach(() => vi.useRealTimers());

    it('should show a running run as done, running and waiting steps', async () => {
      vi.useFakeTimers({ now: Date.parse('2026-09-10T09:00:04Z'), toFake: ['Date'] });
      mockWorkflowsApi({
        workflows: [buildWorkflow({ steps })],
        runs: [
          buildRun({
            status: 'running',
            finishedAt: undefined,
            output: undefined,
            steps: [{ id: 'outline', output: 'Point one', ms: 1000 }],
          }),
        ],
      });
      renderRoute({ initialLocation: '/workflows/wf-1' });

      const run = await waitFor(() => getComponent('RunItem'));
      expect(timeline(run)).toEqual([
        ['outline', 'done'],
        ['draft', 'running'],
        ['polish', 'pending'],
      ]);
      expect(within(run).getByText('Running · 3 s')).toBeInTheDocument();
      expect(within(run).getByText('4 s')).toBeInTheDocument();
      expect(within(run).getByText('Waiting')).toBeInTheDocument();
    });

    it('should mark the steps after a failed one as not run', async () => {
      mockWorkflowsApi({
        workflows: [buildWorkflow({ steps })],
        runs: [
          buildRun({
            status: 'failed',
            output: undefined,
            steps: [{ id: 'outline', error: 'Vertex AI returned 429', ms: 900 }],
          }),
        ],
      });
      renderRoute({ initialLocation: '/workflows/wf-1' });

      const run = await waitFor(() => getComponent('RunItem'));
      expect(timeline(run)).toEqual([
        ['outline', 'failed'],
        ['draft', 'skipped'],
        ['polish', 'skipped'],
      ]);
      expect(within(run).getAllByText('Not run')).toHaveLength(2);
    });

    it('should show only the recorded steps once the workflow changed after the run started', async () => {
      mockWorkflowsApi({
        workflows: [buildWorkflow({ steps, modifiedAt: '2026-09-10T09:00:01Z' })],
        runs: [
          buildRun({
            status: 'running',
            finishedAt: undefined,
            output: undefined,
            steps: [{ id: 'outline', output: 'Point one', ms: 1000 }],
          }),
        ],
      });
      renderRoute({ initialLocation: '/workflows/wf-1' });

      const run = await waitFor(() => getComponent('RunItem'));
      expect(timeline(run)).toEqual([['outline', 'done']]);
    });
  });

  it('should poll the runs while one is running and stop once it is done', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let fetches = 0;
    mockWorkflowsApi({
      runs: () => {
        fetches += 1;
        return [
          fetches === 1
            ? buildRun({ status: 'running', finishedAt: undefined, steps: [], output: undefined })
            : buildRun(),
        ];
      },
    });
    renderRoute({ initialLocation: '/workflows/wf-1' });

    expect(await screen.findByText('Running')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await screen.findByText('Done')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetches).toBe(2);
  });

  it('should start a run and refetch the runs', async () => {
    let started = false;
    const calls = mockWorkflowsApi({
      runs: () => (started ? [buildRun({ id: 'run-new' })] : []),
      run: () => {
        started = true;
        return { runId: 'run-new', taskId: 'task-1', status: 'running' };
      },
    });
    const { user } = renderRoute({ initialLocation: '/workflows/wf-1' });

    await screen.findByText('No runs yet.');
    await user.click(screen.getByRole('button', { name: 'Run now' }));

    expect(calls).toContainEqual({ method: 'POST', params: { id: 'wf-1', action: 'run' } });
    await waitFor(() => getComponent('RunItem'));
  });

  it('should say a run was skipped because another is going', async () => {
    mockWorkflowsApi({ run: () => ({ runId: 'run-new', status: 'skipped' }) });
    const { user } = renderRoute({ initialLocation: '/workflows/wf-1' });

    await user.click(await screen.findByRole('button', { name: 'Run now' }));

    expect(await screen.findByRole('status')).toHaveTextContent('so this one was skipped');
  });

  it('should not run a workflow without steps', async () => {
    mockWorkflowsApi({ workflows: [buildWorkflow({ steps: [] })] });
    renderRoute({ initialLocation: '/workflows/wf-1' });

    expect(await screen.findByRole('button', { name: 'Run now' })).toBeDisabled();
    expect(screen.getByText('Add a step before running.')).toBeInTheDocument();
  });

  it('should hold Run now until edited steps are saved', async () => {
    mockWorkflowsApi();
    const { user } = renderRoute({ initialLocation: '/workflows/wf-1' });

    await user.type(await screen.findByLabelText('Prompt'), ' more');

    expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled();
    expect(screen.getByText(/Save the steps first/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Run now' })).toBeEnabled());
  });

  it('should save added and reordered steps as llm steps', async () => {
    const calls = mockWorkflowsApi({
      workflows: [buildWorkflow({ steps: [{ id: 'outline', type: 'content.query' }] })],
    });
    const { user } = renderRoute({ initialLocation: '/workflows/wf-1' });

    await user.click(await screen.findByRole('button', { name: 'Add step' }));
    const prompts = screen.getAllByLabelText('Prompt');
    await user.type(prompts[1], 'Summarize');
    await user.type(screen.getAllByLabelText('Model')[1], '  gemini-pro  ');
    await user.click(screen.getAllByRole('button', { name: 'Move step up' })[1]);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(calls).toContainEqual({
      method: 'PUT',
      params: { id: 'wf-1' },
      body: {
        steps: [
          { id: 'step2', type: 'llm', config: { prompt: 'Summarize', model: 'gemini-pro' } },
          { id: 'outline', type: 'llm', config: { prompt: '' } },
        ],
      },
    });
  });

  it('should show a step validation error next to the step it names', async () => {
    mockWorkflowsApi({
      put: () => {
        throw {
          status: 400,
          code: 'INVALID_STEPS',
          message: 'Step 2: Step needs a non-empty `config.prompt`',
          step: { index: 1, id: 'step2' },
        };
      },
    });
    const { user } = renderRoute({ initialLocation: '/workflows/wf-1' });

    await user.click(await screen.findByRole('button', { name: 'Add step' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const steps = await waitFor(() => {
      const items = within(getComponent('StepsEditorCard')).getAllByRole('listitem');
      expect(within(items[1]).getByLabelText('Prompt')).toHaveAttribute('aria-invalid', 'true');
      return items;
    });
    expect(within(steps[1]).getByRole('alert')).toHaveTextContent('Step 2: Step needs');
    expect(within(steps[0]).queryByRole('alert')).toBeNull();

    await user.type(within(steps[1]).getByLabelText('Prompt'), 'Fixed');

    expect(within(getComponent('StepsEditorCard')).queryByRole('alert')).toBeNull();
  });

  it('should show a save error that names no step under the steps', async () => {
    mockWorkflowsApi({
      put: () => {
        throw { status: 500, message: 'Storage is unavailable' };
      },
    });
    const { user } = renderRoute({ initialLocation: '/workflows/wf-1' });

    await user.type(await screen.findByLabelText('Prompt'), ' more');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const card = getComponent('StepsEditorCard');
    expect(await within(card).findByRole('alert')).toHaveTextContent('Storage is unavailable');
    expect(within(card).getByRole('listitem')).not.toContainElement(
      within(card).getByRole('alert'),
    );
  });

  it('should show why a run could not start', async () => {
    mockWorkflowsApi({
      run: () => {
        throw { status: 500, message: 'The run task could not be started' };
      },
    });
    const { user } = renderRoute({ initialLocation: '/workflows/wf-1' });

    await user.click(await screen.findByRole('button', { name: 'Run now' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The run task could not be started');
  });

  it('should offer to save legacy steps instead of running them', async () => {
    mockWorkflowsApi({
      workflows: [buildWorkflow({ steps: [{ id: 'fetch', type: 'content.query' }] })],
    });
    renderRoute({ initialLocation: '/workflows/wf-1' });

    expect(await screen.findByRole('button', { name: 'Run now' })).toBeDisabled();
    expect(screen.getByText(/Save the steps first/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('should hold Run now while steps are saving', async () => {
    mockWorkflowsApi({ put: () => new Promise(() => {}) });
    const { user } = renderRoute({ initialLocation: '/workflows/wf-1' });

    const prompt = await screen.findByLabelText('Prompt');
    await user.type(prompt, '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.type(prompt, '{Backspace}');

    expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled();
  });

  it('should keep unsaved steps when a background refetch fails', async () => {
    mockWorkflowsApi();
    const { user, queryClient } = renderRoute({ initialLocation: '/workflows/wf-1' });

    await user.type(await screen.findByLabelText('Prompt'), ' more');
    mockedApiFetch.mockRejectedValue({ status: 401, message: 'Unauthorized' });
    await queryClient.refetchQueries({ queryKey: ['workflows', 'wf-1'], exact: true });

    expect(screen.getByLabelText('Prompt')).toHaveValue('Outline it more');
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('should show saved steps that changed under an untouched editor', async () => {
    mockWorkflowsApi();
    const { queryClient } = renderRoute({ initialLocation: '/workflows/wf-1' });

    await screen.findByLabelText('Prompt');
    act(() => {
      queryClient.setQueryData(
        ['workflows', 'wf-1'],
        buildWorkflow({ steps: [{ id: 'outline', type: 'llm', config: { prompt: 'Changed' } }] }),
      );
    });

    expect(await screen.findByDisplayValue('Changed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('should ask before leaving with unsaved steps', async () => {
    mockWorkflowsApi();
    const { user, router } = renderRoute({ initialLocation: '/workflows/wf-1' });

    await user.type(await screen.findByLabelText('Prompt'), ' more');
    await user.click(screen.getByRole('link', { name: 'All workflows' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(router.state.location.pathname).toBe('/workflows/wf-1');

    await user.click(within(dialog).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/workflows'));
  });
});

describe('ScheduleCard', () => {
  async function findCard() {
    await screen.findByLabelText('Cron');
    return within(getComponent('ScheduleCard'));
  }

  it('should create a schedule from the cron, the browser time zone and enabled', async () => {
    const resolved = Intl.DateTimeFormat().resolvedOptions();
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      ...resolved,
      timeZone: 'Asia/Tokyo',
    });
    mockWorkflowsApi();
    const { user } = renderRoute({ initialLocation: '/workflows/wf-1' });
    const card = await findCard();

    expect(card.getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(card.queryByRole('button', { name: 'Delete' })).toBeNull();
    await user.type(card.getByLabelText('Cron'), ' 0 6 * * 1 ');
    await user.click(card.getByRole('button', { name: 'Create' }));

    expect(cronCalls.at(-1)).toEqual({
      method: 'POST',
      body: {
        workflowId: 'wf-1',
        cron: '0 6 * * 1',
        timeZone: 'Asia/Tokyo',
        enabled: true,
      },
    });
    expect(await card.findByText('user:system:su')).toBeInTheDocument();
    expect(card.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('should show the saved schedule and its owner, and save edits by job name', async () => {
    mockWorkflowsApi({ schedule: buildJob() });
    const { user } = renderRoute({ initialLocation: '/workflows/wf-1' });
    const card = await findCard();

    expect(await card.findByDisplayValue('0 2 * * *')).toBeInTheDocument();
    expect(card.getByLabelText('Time zone')).toHaveValue('Europe/Oslo');
    expect(card.getByText('user:system:alice')).toBeInTheDocument();

    await user.click(card.getByLabelText('Enabled'));
    await user.clear(card.getByLabelText('Time zone'));
    await user.type(card.getByLabelText('Time zone'), 'UTC');
    await user.click(card.getByRole('button', { name: 'Save' }));

    expect(cronCalls.at(-1)).toEqual({
      method: 'PUT',
      params: { name: 'grieg-workflow-wf-1' },
      body: { cron: '0 2 * * *', timeZone: 'UTC', enabled: false },
    });
    expect(await card.findByText('user:system:su')).toBeInTheDocument();
  });

  it('should let another admin take over an unchanged schedule by saving it', async () => {
    mockWorkflowsApi({ schedule: buildJob({ user: 'user:system:alice' }) });
    const { user } = renderRoute({ initialLocation: '/workflows/wf-1' });
    const card = await findCard();

    expect(await card.findByText('Save to run it as you')).toBeInTheDocument();
    await user.click(card.getByRole('button', { name: 'Save' }));

    expect(cronCalls.at(-1)).toMatchObject({
      method: 'PUT',
      params: { name: 'grieg-workflow-wf-1' },
      body: { cron: '0 2 * * *', timeZone: 'Europe/Oslo', enabled: true },
    });
    expect(await card.findByText('user:system:su')).toBeInTheDocument();
    expect(card.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('should delete the schedule after confirming', async () => {
    mockWorkflowsApi({ schedule: buildJob() });
    const { user } = renderRoute({ initialLocation: '/workflows/wf-1' });
    const card = await findCard();

    await user.click(await card.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(cronCalls.at(-1)).toEqual({
      method: 'DELETE',
      params: { name: 'grieg-workflow-wf-1' },
    });
    expect(await card.findByRole('button', { name: 'Create' })).toBeInTheDocument();
    expect(card.getByLabelText('Cron')).toHaveValue('');
  });

  it('should show why the server refused the schedule', async () => {
    mockWorkflowsApi({
      saveSchedule: () =>
        Promise.reject({
          status: 400,
          message: 'Unknown time zone Mars/Base',
          code: 'INVALID_TIME_ZONE',
        }),
    });
    const { user } = renderRoute({ initialLocation: '/workflows/wf-1' });
    const card = await findCard();

    await user.type(card.getByLabelText('Cron'), '0 6 * * *');
    await user.click(card.getByRole('button', { name: 'Create' }));

    expect(await card.findByRole('alert')).toHaveTextContent('Unknown time zone Mars/Base');
  });

  it('should keep edited fields when the saved schedule changes under them', async () => {
    mockWorkflowsApi({ schedule: buildJob() });
    const { user, queryClient } = renderRoute({ initialLocation: '/workflows/wf-1' });
    const card = await findCard();

    await user.clear(await card.findByDisplayValue('0 2 * * *'));
    await user.type(card.getByLabelText('Cron'), '0 4 * * *');
    act(() => {
      queryClient.setQueryData(
        ['crons', 'workflow', 'wf-1'],
        buildJob({ cron: '5 5 * * *', user: 'user:system:bob' }),
      );
    });

    expect(await card.findByText('user:system:bob')).toBeInTheDocument();
    expect(card.getByLabelText('Cron')).toHaveValue('0 4 * * *');
  });

  it('should not hold the page for a new schedule that has no cron yet', async () => {
    mockWorkflowsApi();
    const { user, router } = renderRoute({ initialLocation: '/workflows/wf-1' });
    const card = await findCard();

    await user.click(card.getByLabelText('Enabled'));
    expect(card.getByRole('button', { name: 'Create' })).toBeDisabled();
    await user.click(screen.getByRole('link', { name: 'All workflows' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/workflows'));
  });

  it('should ask before leaving with an unsaved schedule', async () => {
    mockWorkflowsApi();
    const { user, router } = renderRoute({ initialLocation: '/workflows/wf-1' });
    const card = await findCard();

    await user.type(card.getByLabelText('Cron'), '0 6 * * *');
    await user.click(screen.getByRole('link', { name: 'All workflows' }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/workflows/wf-1');
  });
});

describe('runsQueryOptions', () => {
  function intervalFor(runs: Run[] | undefined) {
    const { refetchInterval } = runsQueryOptions('wf-1');
    if (typeof refetchInterval !== 'function') throw new Error('refetchInterval is not a function');
    return refetchInterval({ state: { data: runs } } as never);
  }

  it('should poll only while a run is running', () => {
    expect(intervalFor([buildRun({ status: 'running' }), buildRun()])).toBe(2000);
    expect(intervalFor([buildRun(), buildRun({ status: 'failed' })])).toBe(false);
    expect(intervalFor(undefined)).toBe(false);
  });
});
