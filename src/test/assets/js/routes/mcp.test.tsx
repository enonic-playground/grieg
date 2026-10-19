// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildConfig, renderRoute, screen, waitFor, within } from '../test-utils';

vi.mock('../../../../main/resources/assets/js/lib/api/client', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../../../../main/resources/assets/js/lib/config', () => ({
  getConfig: vi.fn(() => buildConfig()),
}));

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

  it('should generate a key with a JSON body and show it once in step 1', async () => {
    const calls = mockKeysApi(null);
    const { user } = renderRoute({ initialLocation: '/mcp' });

    await user.click(await screen.findByRole('button', { name: 'Generate key' }));

    expect(calls).toContainEqual({ method: 'POST', body: {} });
    const reveal = await waitFor(() => getCard('KeyReveal'));
    expect(within(reveal).getByText(PLAINTEXT)).toBeInTheDocument();
    expect(getCard('OwnKeyCard')).toHaveAttribute('data-done', 'true');
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
    expect(
      JSON.stringify(
        queryClient
          .getQueryCache()
          .getAll()
          .map((query) => query.state.data),
      ),
    ).not.toContain(PLAINTEXT);

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
    await waitFor(() => getCard('KeyReveal'));

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
    expect(within(await waitFor(() => getCard('KeyReveal'))).getByText(PLAINTEXT)).toBeVisible();
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

    expect(within(await waitFor(() => getCard('KeyReveal'))).getByText(PLAINTEXT)).toBeVisible();
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

describe('client setup', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    mockedApiFetch.mockReset();
  });

  async function generate(): Promise<ReturnType<typeof renderRoute>> {
    mockKeysApi(null);
    const rendered = renderRoute({ initialLocation: '/mcp' });
    await rendered.user.click(await screen.findByRole('button', { name: 'Generate key' }));
    await waitFor(() => getCard('KeyReveal'));
    return rendered;
  }

  it('should open on Claude Desktop with the bundle and both values to paste', async () => {
    await generate();
    const setup = getCard('DesktopSetup');

    expect(within(setup).getByRole('link', { name: 'Download grieg.mcpb' })).toHaveAttribute(
      'href',
      '/assets/grieg.mcpb',
    );
    const fields = [...setup.querySelectorAll('[data-component="CopyField"]')];
    expect(fields.map((field) => field.querySelector('code')?.textContent)).toEqual([
      MCP_URI,
      PLAINTEXT,
    ]);
    const fallback = within(setup).getByText(/"mcpServers"/).textContent ?? '';
    expect(JSON.parse(fallback).mcpServers.grieg).toEqual({
      command: 'npx',
      args: ['-y', 'mcp-remote@0.14.3', MCP_URI, '--header', 'Authorization:${AUTH_HEADER}'],
      env: { AUTH_HEADER: `Bearer ${PLAINTEXT}` },
    });
  });

  it('should keep the key out of every Claude Code command', async () => {
    const { user } = await generate();

    await user.click(screen.getByRole('tab', { name: 'Claude Code' }));
    const setup = getCard('CodeSetup');

    expect(
      within(setup).getByText('read -rs GRIEG_MCP_TOKEN && export GRIEG_MCP_TOKEN'),
    ).toBeVisible();
    const command = within(setup).getByText(/^claude mcp add/).textContent;
    expect(command).toBe(
      `claude mcp add --transport http grieg "${MCP_URI}" \\\n  --header "Authorization: Bearer $GRIEG_MCP_TOKEN"`,
    );
    const mcpJson = within(setup).getByText(/"mcpServers"/).textContent;
    expect(mcpJson).toContain('"Authorization": "Bearer ${GRIEG_MCP_TOKEN}"');
    for (const pre of setup.querySelectorAll('pre')) {
      expect(pre.textContent).not.toContain(PLAINTEXT);
    }
  });

  it('should put the key into the configs of other clients while it is shown', async () => {
    const { user } = await generate();

    await user.click(screen.getByRole('tab', { name: 'Other clients' }));
    const setup = getCard('OtherSetup');

    expect(within(setup).getByText(/"mcpServers"[\s\S]*"headers"/).textContent).toContain(
      `Bearer ${PLAINTEXT}`,
    );
    expect(within(setup).getByText(/"servers"/).textContent).toContain(`Bearer ${PLAINTEXT}`);
    expect(within(setup).getByText(/"MCP_TOKEN"/).textContent).toContain(PLAINTEXT);
    const curl = within(setup).getByText(/^curl/).textContent;
    expect(curl).toContain('$GRIEG_MCP_TOKEN');
    expect(curl).not.toContain(PLAINTEXT);
  });

  it('should tell ChatGPT users keys do not work there and give the URL without the key', async () => {
    const { user } = await generate();

    await user.click(screen.getByRole('tab', { name: 'ChatGPT' }));
    const setup = getCard('ChatGptSetup');

    expect(within(setup).getByText("ChatGPT can't use personal keys yet")).toBeVisible();
    const fields = [...setup.querySelectorAll('[data-component="CopyField"]')];
    expect(fields.map((field) => field.querySelector('code')?.textContent)).toEqual([MCP_URI]);
    expect(within(setup).getByRole('link', { name: 'README' })).toHaveAttribute(
      'href',
      'https://github.com/enonic-playground/grieg#chatgpt',
    );
    expect(setup.textContent).not.toContain(PLAINTEXT);
  });

  it('should show the same instructions with a placeholder once the key is no longer shown', async () => {
    mockKeysApi(buildKey(40));
    const { user } = renderRoute({ initialLocation: '/mcp' });
    const desktop = await waitFor(() => getCard('DesktopSetup'));

    expect(within(desktop).getByText('The key you saved in step 1')).toBeVisible();
    expect(within(desktop).getByText(/"AUTH_HEADER": "Bearer <your key>"/)).toBeInTheDocument();
    const keyField = within(desktop)
      .getByText('The key you saved in step 1')
      .closest('[data-component="CopyField"]') as HTMLElement;
    expect(within(keyField).queryByRole('button')).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Other clients' }));
    expect(within(getCard('OtherSetup')).getByText(/"servers"/).textContent).toContain(
      'Bearer <your key>',
    );
  });

  it('should hand the plaintext to no snippet once the user dismisses it', async () => {
    const { user } = await generate();

    await user.click(screen.getByRole('button', { name: 'I have saved the key' }));

    expect(await screen.findByText('grieg_AAAA…AAAA')).toBeInTheDocument();
    for (const tab of ['Claude Desktop', 'Claude Code', 'ChatGPT', 'Other clients']) {
      await user.click(screen.getByRole('tab', { name: tab }));
      expect(document.body.textContent).not.toContain(PLAINTEXT);
    }
  });

  it('should state what the server serves this user', async () => {
    mockKeysApi(null);
    renderRoute({
      initialLocation: '/mcp',
      config: buildConfig({
        access: { admin: false, mcp: true },
        mcp: { ...buildConfig().mcp, readOnly: true, workflowTools: false },
      }),
    });
    const check = await waitFor(() => getCard('ConnectionCard'));

    expect(within(check).getByText(MCP_URI)).toBeVisible();
    expect(within(check).getByRole('button', { name: 'Copy' })).toBeVisible();
    expect(within(check).getByText('content')).toBeVisible();
    expect(within(check).getByText('Read-only: the write tools are switched off')).toBeVisible();
    expect(within(check).getByText('Administrators only')).toBeVisible();
  });

  it('should say the workflow tools are off when the server does not serve them', async () => {
    mockKeysApi(null);
    renderRoute({
      initialLocation: '/mcp',
      config: buildConfig({ mcp: { ...buildConfig().mcp, toolsets: ['content'] } }),
    });

    const check = await waitFor(() => getCard('ConnectionCard'));
    expect(within(check).getByText('Switched off on this server')).toBeVisible();
    expect(within(check).queryByText('nodes')).not.toBeInTheDocument();
  });
});

describe('connection check', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    mockedApiFetch.mockReset();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  function ownKeyReads(calls: FetchOptions[]): number {
    return calls.filter((call) => call.method == null && call.params == null).length;
  }

  function markUsed(lastUsed: string): void {
    const serve = mockedApiFetch.getMockImplementation();
    mockedApiFetch.mockImplementation(async (url: string, options: FetchOptions = {}) => {
      const result = await serve?.(url, options);
      const ownRead = url === KEYS_URI && options.method == null && options.params == null;
      return ownRead && result != null ? { ...(result as KeyInfo), lastUsed } : result;
    });
  }

  async function generate(calls: FetchOptions[]): Promise<number> {
    const { user } = renderRoute({ initialLocation: '/mcp' });
    await user.click(await screen.findByRole('button', { name: 'Generate key' }));
    await screen.findByText('Waiting for the first request…');
    return ownKeyReads(calls);
  }

  it('should poll until the first request arrives, then say connected and stop', async () => {
    const calls = mockKeysApi(null);
    const before = await generate(calls);

    await vi.advanceTimersByTimeAsync(3000);
    expect(ownKeyReads(calls)).toBe(before + 1);

    markUsed('2026-10-01T12:00:05Z');
    await vi.advanceTimersByTimeAsync(3000);

    const check = getCard('ConnectionCard');
    expect(await within(check).findByText(/^Connected Oct 1, 2026/)).toBeVisible();
    expect(check).toHaveAttribute('data-done', 'true');
    expect(getCard('ClientSetupCard')).toHaveAttribute('data-done', 'true');
    const after = ownKeyReads(calls);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ownKeyReads(calls)).toBe(after);
  });

  // Five simulated minutes run about a hundred polls, each a fetch and a full re-render.
  it('should stop polling five minutes after the key was generated', async () => {
    const calls = mockKeysApi(null);
    await generate(calls);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 10_000);
    expect(screen.getByText('Waiting for the first request…')).toBeVisible();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await screen.findByText('No client has used this key yet')).toBeVisible();
    const after = ownKeyReads(calls);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ownKeyReads(calls)).toBe(after);
  }, 15_000);

  it('should not poll while the page is hidden', async () => {
    const calls = mockKeysApi(null);
    const before = await generate(calls);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(ownKeyReads(calls)).toBe(before);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(ownKeyReads(calls)).toBeGreaterThan(before);
  });

  it('should check again only when asked for a key that has never been used', async () => {
    const calls = mockKeysApi(buildKey(40));
    const { user } = renderRoute({ initialLocation: '/mcp' });
    await screen.findByText('No client has used this key yet');
    const before = ownKeyReads(calls);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(ownKeyReads(calls)).toBe(before);

    markUsed('2026-09-30T08:00:00Z');
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText(/^Last used Sep 30, 2026/)).toBeVisible();
  });

  it('should show when an older key was last used, without polling', async () => {
    const calls = mockKeysApi(buildKey(40, { lastUsed: '2026-09-30T08:00:00Z' }));
    renderRoute({ initialLocation: '/mcp' });

    expect(await screen.findByText(/^Last used Sep 30, 2026/)).toBeVisible();
    const before = ownKeyReads(calls);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ownKeyReads(calls)).toBe(before);
  });

  it('should not call a key regenerated elsewhere connected', async () => {
    await generate(mockKeysApi(null));

    mockKeysApi(
      buildKey(90, {
        display: 'grieg_BBBB…BBBB',
        created: '2026-10-01T12:30:00Z',
        lastUsed: '2026-10-01T12:31:00Z',
      }),
    );
    await vi.advanceTimersByTimeAsync(3000);

    expect(await screen.findByText(/^Last used Oct 1, 2026/)).toBeVisible();
    expect(screen.queryByText(/^Connected/)).not.toBeInTheDocument();
  });

  it('should stop polling once the key was regenerated elsewhere', async () => {
    await generate(mockKeysApi(null));

    const calls = mockKeysApi(
      buildKey(90, { display: 'grieg_BBBB…BBBB', created: '2026-10-01T12:30:00Z' }),
    );
    await vi.advanceTimersByTimeAsync(3000);
    expect(await screen.findByText('No client has used this key yet')).toBeVisible();

    const after = ownKeyReads(calls);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ownKeyReads(calls)).toBe(after);
  });

  it('should say the check failed and offer a retry when the key cannot be read', async () => {
    mockedApiFetch.mockRejectedValue({ status: 500, message: 'Server error' });
    renderRoute({ initialLocation: '/mcp' });

    const check = await waitFor(() => getCard('ConnectionCard'));
    expect(await within(check).findByText('Something went wrong')).toBeVisible();
    expect(within(check).getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  it('should ask for a key first when there is none', async () => {
    mockKeysApi(null);
    renderRoute({ initialLocation: '/mcp' });

    expect(await screen.findByText('No key yet')).toBeVisible();
    expect(getCard('ConnectionCard')).not.toHaveAttribute('data-done');
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
