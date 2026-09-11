// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { buildConfig, renderRoute, screen, waitFor, within } from '../test-utils';

vi.mock('../../../../main/resources/assets/js/lib/api/client', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../../../../main/resources/assets/js/lib/config', () => ({
  getConfig: vi.fn(() => buildConfig()),
}));

import { apiFetch } from '../../../../main/resources/assets/js/lib/api/client';

const mockedApiFetch = vi.mocked(apiFetch);

function buildWorkflow(overrides?: Record<string, unknown>) {
  return {
    id: 'wf-1',
    name: 'summarize',
    displayName: 'Summarize articles',
    enabled: true,
    steps: [{ id: 'a', type: 'ai.completion' }],
    modifiedAt: '2026-09-10T08:12:00Z',
    ...overrides,
  };
}

function getPage(): HTMLElement {
  const el = document.querySelector('[data-component="WorkflowsPage"]');
  if (!el) throw new Error('WorkflowsPage not found');
  return el as HTMLElement;
}

describe('WorkflowsPage', () => {
  it('should render a row per workflow', async () => {
    mockedApiFetch.mockResolvedValue({ workflows: [buildWorkflow()] });

    renderRoute({ initialLocation: '/workflows' });

    await waitFor(() => expect(getPage()).toBeInTheDocument());

    const row = within(getPage()).getByText('Summarize articles').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('1')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('Enabled')).toBeInTheDocument();
  });

  it('should show the empty state when there are no workflows', async () => {
    mockedApiFetch.mockResolvedValue({ workflows: [] });

    renderRoute({ initialLocation: '/workflows' });

    expect(await screen.findByText('No workflows yet')).toBeInTheDocument();
  });
});
