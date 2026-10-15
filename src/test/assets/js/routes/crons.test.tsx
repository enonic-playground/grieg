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

afterEach(() => {
  mockedApiFetch.mockReset();
});

describe('CronsPage', () => {
  it('should show who each job runs as and link a workflow schedule to its workflow', async () => {
    mockedApiFetch.mockResolvedValue({
      jobs: [
        {
          name: 'grieg-workflow-wf-1',
          enabled: true,
          cron: '0 2 * * *',
          timeZone: 'Europe/Oslo',
          descriptor: 'com.enonic.app.grieg:run-workflow',
          user: 'user:system:alice',
          workflowId: 'wf-1',
        },
        {
          name: 'purge-trash',
          enabled: false,
          cron: '0 3 * * 0',
          timeZone: 'UTC',
          descriptor: 'com.example.app:purge',
        },
      ],
    });
    renderRoute({ initialLocation: '/crons' });

    const link = await screen.findByRole('link', { name: 'grieg-workflow-wf-1' });
    expect(link).toHaveAttribute('href', '/workflows/wf-1');
    expect(screen.getByRole('columnheader', { name: 'Runs as' })).toBeInTheDocument();

    const [, scheduled, foreign] = screen.getAllByRole('row');
    expect(within(scheduled).getByText('user:system:alice')).toBeInTheDocument();
    expect(within(scheduled).getByText('(Europe/Oslo)')).toBeInTheDocument();
    expect(within(foreign).queryByRole('link')).toBeNull();
    expect(within(foreign).getByText('purge-trash')).toBeInTheDocument();
  });
});
