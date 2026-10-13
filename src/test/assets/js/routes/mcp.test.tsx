// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildConfig, renderRoute, screen, waitFor, within } from '../test-utils';

vi.mock('../../../../main/resources/assets/js/lib/api/client', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../../../../main/resources/assets/js/lib/config', () => ({
  getConfig: vi.fn(() => buildConfig()),
}));

import { buildClaudeCommand } from '../../../../main/resources/assets/js/components/mcp/key-reveal';
import { apiFetch } from '../../../../main/resources/assets/js/lib/api/client';

const mockedApiFetch = vi.mocked(apiFetch);

const NOW = Date.parse('2026-10-01T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const PLAINTEXT = `grieg_${'A'.repeat(43)}`;
const KEYS_URI = '/api/keys';
const MCP_URI = 'http://localhost:8080/api/com.enonic.app.grieg:mcp';

type FetchOptions = { method?: string; body?: unknown; params?: Record<string, string> };

type KeyInfo = { display: string; created: string; expires: string; lastUsed?: string };

function buildKey(daysLeft: number, overrides?: Partial<KeyInfo>): KeyInfo {
  return {
    display: 'grieg_k3Xa…9fQ2',
    created: '2026-09-01T09:30:00Z',
    expires: new Date(NOW + daysLeft * DAY_MS).toISOString(),
    ...overrides,
  };
}

// A stateful stand-in for the keys API, so the cards see what a real server would return.
function mockKeysApi(initial: KeyInfo | null, initialAll: (KeyInfo & { owner: string })[] = []) {
  let all = initialAll;
  let own = initial;
  const calls: FetchOptions[] = [];
  mockedApiFetch.mockImplementation(async (url: string, options: FetchOptions = {}) => {
    if (url !== KEYS_URI) return { workflows: [], jobs: [] };
    calls.push(options);
    const method = options.method ?? 'GET';
    if (method === 'GET') return options.params?.all === 'true' ? { keys: all } : own;
    if (method === 'POST') {
      own = buildKey(90, { display: 'grieg_AAAA…AAAA', created: new Date(NOW).toISOString() });
      return { key: PLAINTEXT, ...own };
    }
    if (options.params?.owner == null) own = null;
    else all = all.filter((key) => key.owner !== options.params?.owner);
    return { owner: options.params?.owner ?? 'user:system:su' };
  });
  return calls;
}

function getCard(name: string): HTMLElement {
  const el = document.querySelector(`[data-component="${name}"]`);
  if (!el) throw new Error(`${name} not found`);
  return el as HTMLElement;
}

describe('McpPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    mockedApiFetch.mockReset();
  });

  it('should generate a key with a JSON body and show it with the setup snippets', async () => {
    const calls = mockKeysApi(null);
    const { user } = renderRoute({ initialLocation: '/mcp' });

    await user.click(await screen.findByRole('button', { name: 'Generate key' }));

    expect(calls).toContainEqual({ method: 'POST', body: {} });
    const reveal = await waitFor(() => getCard('KeyReveal'));
    expect(within(reveal).getByText(PLAINTEXT)).toBeInTheDocument();
    expect(
      within(reveal).getByText(
        `claude mcp add --transport http grieg "${MCP_URI}" --header "Authorization: Bearer ${PLAINTEXT}"`,
      ),
    ).toBeInTheDocument();
    const mcpJson = within(reveal).getByText(/"mcpServers"/);
    expect(mcpJson.textContent).toContain(`"url": "${MCP_URI}"`);
    expect(mcpJson.textContent).toContain('"Authorization": "Bearer ${GRIEG_MCP_TOKEN}"');
    expect(mcpJson.textContent).not.toContain(PLAINTEXT);
  });

  it('should drop the plaintext once the user dismisses it', async () => {
    mockKeysApi(null);
    const { user } = renderRoute({ initialLocation: '/mcp' });

    await user.click(await screen.findByRole('button', { name: 'Generate key' }));
    await user.click(await screen.findByRole('button', { name: 'I have saved the key' }));

    expect(await screen.findByText('grieg_AAAA…AAAA')).toBeInTheDocument();
    expect(screen.queryByText(PLAINTEXT, { exact: false })).not.toBeInTheDocument();
  });

  it('should drop the plaintext once the user leaves the view', async () => {
    mockKeysApi(null);
    const { user, router, queryClient } = renderRoute({ initialLocation: '/mcp' });

    await user.click(await screen.findByRole('button', { name: 'Generate key' }));
    await waitFor(() => getCard('KeyReveal'));

    await router.navigate({ to: '/crons' });
    await waitFor(() => expect(document.querySelector('[data-component="McpPage"]')).toBeNull());
    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toEqual([]));
    await router.navigate({ to: '/mcp' });

    expect(await screen.findByText('grieg_AAAA…AAAA')).toBeInTheDocument();
    expect(screen.queryByText(PLAINTEXT, { exact: false })).not.toBeInTheDocument();
  });

  it('should hide the plaintext once the key is regenerated elsewhere', async () => {
    mockKeysApi(null);
    const { user, queryClient } = renderRoute({ initialLocation: '/mcp' });
    await user.click(await screen.findByRole('button', { name: 'Generate key' }));
    await screen.findByText(PLAINTEXT);

    mockKeysApi(buildKey(90, { display: 'grieg_BBBB…BBBB', created: '2026-10-01T13:00:00Z' }));
    await queryClient.invalidateQueries({ queryKey: ['keys'] });

    expect(await screen.findByText('grieg_BBBB…BBBB')).toBeInTheDocument();
    expect(screen.queryByText(PLAINTEXT, { exact: false })).not.toBeInTheDocument();
  });

  it('should close the confirmation on Escape without acting', async () => {
    const calls = mockKeysApi(buildKey(40));
    const { user } = renderRoute({ initialLocation: '/mcp' });

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    ).toHaveFocus();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('should say the copy failed where the clipboard is unavailable', async () => {
    mockKeysApi(null);
    const { user } = renderRoute({ initialLocation: '/mcp' });
    await user.click(await screen.findByRole('button', { name: 'Generate key' }));
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    const [copyKey] = await screen.findAllByRole('button', { name: 'Copy' });
    await user.click(copyKey);

    expect(copyKey).toHaveTextContent('Copy failed');
  });

  it('should show the masked key and the days left', async () => {
    mockKeysApi(buildKey(40));
    renderRoute({ initialLocation: '/mcp' });

    expect(await screen.findByText('grieg_k3Xa…9fQ2')).toBeInTheDocument();
    const daysLeft = screen.getByText('(40 days left)');
    expect(daysLeft).not.toHaveAttribute('data-soon');
  });

  it('should highlight a key with 14 days left or fewer', async () => {
    mockKeysApi(buildKey(14));
    renderRoute({ initialLocation: '/mcp' });

    expect(await screen.findByText('(14 days left)')).toHaveAttribute('data-soon', 'true');
  });

  it('should say an expired key expired and offer a new one', async () => {
    mockKeysApi(buildKey(-1));
    renderRoute({ initialLocation: '/mcp' });

    expect(await screen.findByText(/Your key expired on/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate key' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Regenerate' })).not.toBeInTheDocument();
  });

  it('should regenerate only after confirmation', async () => {
    const calls = mockKeysApi(buildKey(40));
    const { user } = renderRoute({ initialLocation: '/mcp' });

    await user.click(await screen.findByRole('button', { name: 'Regenerate' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Every client using your current key stops working at once.');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Regenerate' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Regenerate' }),
    );

    expect(calls).toContainEqual({ method: 'POST', body: {} });
    expect(await screen.findByText(PLAINTEXT)).toBeInTheDocument();
  });

  it('should delete only after confirmation', async () => {
    const calls = mockKeysApi(buildKey(40));
    const { user } = renderRoute({ initialLocation: '/mcp' });

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );

    expect(calls).toContainEqual({ method: 'DELETE' });
    expect(await screen.findByRole('button', { name: 'Generate key' })).toBeInTheDocument();
  });

  it('should show the stored state when the key was already deleted elsewhere', async () => {
    mockKeysApi(buildKey(40));
    const { user } = renderRoute({ initialLocation: '/mcp' });
    await screen.findByText('grieg_k3Xa…9fQ2');

    mockedApiFetch.mockImplementation(async (url: string, options: FetchOptions = {}) => {
      if (url !== KEYS_URI) return { workflows: [], jobs: [] };
      if (options.method === 'DELETE') throw { status: 404, message: 'You hold no MCP key' };
      return options.params?.all === 'true' ? { keys: [] } : null;
    });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );

    expect(await screen.findByText('You hold no MCP key')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Generate key' })).toBeInTheDocument();
    expect(screen.queryByText('grieg_k3Xa…9fQ2')).not.toBeInTheDocument();
  });

  it('should clear the error of a failed action once the other action starts', async () => {
    const calls = mockKeysApi(buildKey(40));
    const succeed = mockedApiFetch.getMockImplementation();
    mockedApiFetch.mockImplementation(async (url: string, options: FetchOptions = {}) => {
      if (url === KEYS_URI && options.method === 'DELETE') {
        throw { status: 500, message: 'Delete failed' };
      }
      return succeed?.(url, options);
    });
    const { user } = renderRoute({ initialLocation: '/mcp' });

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    expect(await screen.findByText('Delete failed')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Regenerate' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Regenerate' }),
    );

    expect(await screen.findByText(PLAINTEXT)).toBeInTheDocument();
    expect(screen.queryByText('Delete failed')).not.toBeInTheDocument();
    expect(calls).toContainEqual({ method: 'POST', body: {} });
  });

  it('should list every key for admins and revoke one after confirmation', async () => {
    const calls = mockKeysApi(null, [{ owner: 'user:system:alice', ...buildKey(40) }]);
    const { user } = renderRoute({ initialLocation: '/mcp' });

    const row = (await screen.findByText('user:system:alice')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Revoke' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('user:system:alice');
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    expect(calls).toContainEqual({ method: 'DELETE', params: { owner: 'user:system:alice' } });
    expect(await screen.findByText('No one holds a key.')).toBeInTheDocument();
  });

  it('should hide the key list from members who are not admins', async () => {
    const calls = mockKeysApi(null);
    renderRoute({
      initialLocation: '/mcp',
      config: buildConfig({ access: { admin: false, mcp: true } }),
    });

    expect(await screen.findByRole('button', { name: 'Generate key' })).toBeInTheDocument();
    expect(document.querySelector('[data-component="AllKeysCard"]')).toBeNull();
    expect(calls.some((call) => call.params?.all === 'true')).toBe(false);
  });

  it('should not ask for an own key when the admin lacks the MCP role', async () => {
    const calls = mockKeysApi(null, []);
    renderRoute({
      initialLocation: '/mcp',
      config: buildConfig({ access: { admin: true, mcp: false } }),
    });

    expect(await screen.findByText(/needs the Grieg MCP role/)).toBeInTheDocument();
    expect(await screen.findByText('No one holds a key.')).toBeInTheDocument();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((call) => call.params?.all !== 'true')).toEqual([]);
  });
});

describe('navigation', () => {
  afterEach(() => {
    mockedApiFetch.mockReset();
  });

  const member = buildConfig({ access: { admin: false, mcp: true } });

  it.each(['/', '/workflows', '/crons', '/system'])(
    'should send a member who is not an admin from %s to the MCP route',
    async (initialLocation) => {
      mockKeysApi(null);
      const { router } = renderRoute({ initialLocation, config: member });

      await waitFor(() => expect(router.state.location.pathname).toBe('/mcp'));
      expect(await screen.findByRole('button', { name: 'Generate key' })).toBeInTheDocument();
    },
  );

  it('should show a member only the MCP route in the sidebar', async () => {
    mockKeysApi(null);
    renderRoute({ initialLocation: '/mcp', config: member });

    const sidebar = await waitFor(() => getCard('Sidebar'));
    const links = within(sidebar)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(links).toEqual(['MCP']);
  });

  it('should start admins on Workflows and show them every route', async () => {
    mockedApiFetch.mockResolvedValue({ workflows: [] });
    const { router } = renderRoute({ initialLocation: '/' });

    await waitFor(() => expect(router.state.location.pathname).toBe('/workflows'));
    const links = within(getCard('Sidebar'))
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(links).toEqual(['Workflows', 'Schedules', 'System', 'MCP']);
  });
});

describe('buildClaudeCommand', () => {
  it.each([
    'http://localhost:8080/api/com.enonic.app.grieg:mcp',
    'https://cms.example.com/api/com.enonic.app.grieg:mcp',
    'http://[::1]:8080/api/com.enonic.app.grieg:mcp',
  ])('should keep the plain endpoint %s', (url) => {
    expect(buildClaudeCommand(url, 'grieg_x')).toContain(` "${url}" `);
  });

  it.each([
    'http://$(id).example/api/com.enonic.app.grieg:mcp',
    'http://a`id`.example/api/com.enonic.app.grieg:mcp',
    'http://a"b.example/api/com.enonic.app.grieg:mcp',
  ])('should leave a placeholder for the shell-unsafe endpoint %s', (url) => {
    const command = buildClaudeCommand(url, 'grieg_x');
    expect(command).toContain(' "<endpoint URL>" ');
    expect(command).not.toContain('example');
  });
});
