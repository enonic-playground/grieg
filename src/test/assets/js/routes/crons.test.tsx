// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildConfig, renderRoute, screen, within } from '../test-utils';

vi.mock('../../../../main/resources/assets/js/lib/api/client', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../../../../main/resources/assets/js/lib/config', () => ({
  getConfig: vi.fn(() => buildConfig()),
}));

import { apiFetch } from '../../../../main/resources/assets/js/lib/api/client';

const mockedApiFetch = vi.mocked(apiFetch);

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

function mockApi(jobs: Job[]): void {
  const workflows = { workflows: [{ id: 'wf-1', displayName: 'Summarize articles' }] };
  mockedApiFetch.mockImplementation(async (url: string) =>
    url === buildConfig().apiUris.workflows ? workflows : { jobs },
  );
}

async function findRows(): Promise<HTMLElement[]> {
  await screen.findByRole('columnheader', { name: 'Runs as' });
  return screen.getAllByRole('row').slice(1);
}

afterEach(() => {
  vi.useRealTimers();
  mockedApiFetch.mockReset();
});

describe('CronsPage', () => {
  it('should name a workflow schedule by its workflow and fall back to the job name', async () => {
    mockApi([
      buildJob(),
      buildJob({ name: 'grieg-workflow-wf-gone', workflowId: 'wf-gone' }),
      buildJob({ name: 'purge-trash', descriptor: 'com.example.app:purge', workflowId: undefined }),
    ]);
    renderRoute({ initialLocation: '/crons' });

    const link = await screen.findByRole('link', { name: 'Summarize articles' });
    expect(link).toHaveAttribute('href', '/workflows/wf-1');
    expect(link).toHaveAttribute('title', 'grieg-workflow-wf-1');
    expect(screen.getByRole('link', { name: 'grieg-workflow-wf-gone' })).toHaveAttribute(
      'href',
      '/workflows/wf-gone',
    );

    const [scheduled, , foreign] = await findRows();
    expect(within(scheduled).getByText('user:system:alice')).toBeInTheDocument();
    expect(within(foreign).queryByRole('link')).toBeNull();
    expect(within(foreign).getByText('purge-trash')).toBeInTheDocument();
  });

  it('should say a cron in words, and show the raw expression when it has none', async () => {
    mockApi([buildJob(), buildJob({ name: 'odd', cron: '0 6 */2 * *', timeZone: 'UTC' })]);
    renderRoute({ initialLocation: '/crons' });

    const [daily, odd] = await findRows();
    expect(within(daily).getByText('Daily at 02:00')).toBeInTheDocument();
    expect(within(daily).getByText('0 2 * * *').parentElement).toHaveTextContent(
      '0 2 * * * · Europe/Oslo',
    );
    expect(within(odd).getByText('0 6 */2 * *')).toBeInTheDocument();
    expect(within(odd).getByText('UTC')).toBeInTheDocument();
  });

  it('should say the last run relative to now, with the date in its title', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    mockApi([buildJob({ lastRun: '2026-09-11T12:00:00Z' })]);
    renderRoute({ initialLocation: '/crons' });

    const [row] = await findRows();
    const time = within(row).getByText('yesterday');
    expect(time).toHaveAttribute('dateTime', '2026-09-11T12:00:00Z');
    expect(time.getAttribute('title')).toMatch(/^Sep 11, 2026, \d{1,2}:\d{2}\s[AP]M$/);
  });
});
