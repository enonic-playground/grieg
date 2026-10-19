// @vitest-environment jsdom

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CardHost } from '../../../main/resources/assets/ui/host';
import type {
  ContentSummary,
  ContentType,
  CronJob,
  JsonObject,
  RunDetail,
  ToolResults,
  WorkflowItem,
} from '../../../main/resources/assets/ui/shapes';

import { Card } from '../../../main/resources/assets/ui/card';
import { readResult } from '../../../main/resources/assets/ui/host';
import { toScreen } from '../../../main/resources/assets/ui/shapes';

const ADMIN = 'http://localhost:8080/admin/tool/com.enonic.app.grieg/main/workflows';

const WORKFLOW: WorkflowItem = {
  id: 'wf-1',
  name: 'weekly-digest',
  displayName: 'Weekly digest',
  description: 'Summarize the week',
  stepCount: 2,
  schedule: {
    name: 'grieg-workflow-wf-1',
    cron: '0 6 * * 1',
    timeZone: 'Europe/Oslo',
    enabled: true,
    user: 'user:system:su',
  },
  lastRun: {
    id: 'run-1',
    status: 'failed',
    trigger: 'schedule',
    startedAt: '2026-09-11T02:00:03Z',
    finishedAt: '2026-09-11T02:00:05Z',
  },
  adminUrl: `${ADMIN}/wf-1`,
};

const RUN_LIST: ToolResults['run_list'] = {
  workflowId: 'wf-1',
  runs: [
    {
      id: 'run-2',
      status: 'done',
      trigger: 'manual',
      user: 'user:system:su',
      startedAt: '2026-09-12T09:00:00Z',
      finishedAt: '2026-09-12T09:00:04Z',
      error: null,
    },
  ],
  adminUrl: `${ADMIN}/wf-1`,
};

const RUN: RunDetail = {
  id: 'run-1',
  status: 'failed',
  trigger: 'schedule',
  user: 'user:system:su',
  startedAt: '2026-09-11T02:00:03Z',
  finishedAt: '2026-09-11T02:00:08Z',
  error: 'Step summary failed: Vertex AI returned 429',
  workflowId: 'wf-1',
  taskId: null,
  steps: [
    { id: 'outline', ms: 1710, output: 'x'.repeat(4000), error: null, truncated: true },
    { id: 'summary', ms: 2220, output: null, error: 'Vertex AI returned 429' },
  ],
  output: null,
  adminUrl: `${ADMIN}/wf-1`,
};

const OWN_JOB: CronJob = {
  name: 'grieg-workflow-wf-1',
  enabled: true,
  descriptor: 'com.enonic.app.grieg:run-workflow',
  cron: '0 6 * * 1',
  timeZone: 'Europe/Oslo',
  user: 'user:system:su',
  workflowId: 'wf-1',
  workflowName: 'Weekly digest',
  adminUrl: `${ADMIN}/wf-1`,
};

const OTHER_JOB: CronJob = {
  name: 'purge-trash',
  enabled: false,
  descriptor: 'com.example.cleanup:purge',
  cron: '0 3 * * 0',
  timeZone: 'UTC',
  user: 'user:system:cleanup',
};

function hit(name: string): ToolResults['node_query']['hits'][number] {
  return {
    _id: `id-${name}`,
    _name: name,
    _path: `/products/${name}`,
    _nodeType: 'product',
    _ts: '2026-09-12T14:05:00Z',
    _versionKey: `v-${name}`,
  };
}

const NODE_ARGS = { repo: 'com.example.catalog', branch: 'master', count: 2 };

const EDIT = 'http://localhost:8080/admin/cs/main/default/edit';

function contentHit(name: string, overrides: Partial<ContentSummary> = {}): ContentSummary {
  return {
    id: `c-${name}`,
    name,
    path: `/site/articles/${name}`,
    displayName: `Article ${name}`,
    type: 'com.example.news:article',
    language: 'en',
    modifiedTime: '2026-10-17T14:20:00Z',
    modifier: 'user:system:ingrid',
    workflowState: 'READY',
    valid: true,
    hasChildren: false,
    editUrl: `${EDIT}/c-${name}`,
    ...overrides,
  };
}

const ARTICLE_TYPE: ContentType = {
  name: 'com.example.news:article',
  displayName: 'Article',
  description: 'A blog article',
  superType: 'base:structured',
  abstract: false,
  allowChildContent: true,
  form: [
    {
      path: 'category',
      kind: 'input',
      label: 'Category',
      inputType: 'ComboBox',
      occurrences: { min: 1, max: 1 },
      config: { config: { option: [{ '@value': 'guide', value: 'Guide' }] } },
    },
    { path: 'author', kind: 'itemSet', label: 'Author', occurrences: { min: 0, max: 0 } },
    {
      path: 'author.name',
      kind: 'input',
      label: 'Name',
      inputType: 'TextLine',
      occurrences: { min: 0, max: 1 },
    },
  ],
};

type FakeHost = { [K in keyof CardHost]: ReturnType<typeof vi.fn> };

function fakeHost(): FakeHost {
  return { callTool: vi.fn(), ask: vi.fn().mockResolvedValue(true), openLink: vi.fn() };
}

function renderCard(data: unknown, args: JsonObject = {}, host = fakeHost()) {
  const initial = toScreen(data, args);
  if (initial == null) throw new Error('fixture has no card');
  const user = userEvent.setup();
  render(<Card host={host as unknown as CardHost} locale="en-US" initial={initial} />);
  return { host, user };
}

describe('workflows card', () => {
  it('should show each workflow with its steps, schedule in words and last run', () => {
    renderCard({ workflows: [WORKFLOW] });

    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Weekly digest')).toBeInTheDocument();
    expect(within(row).getByText('2 steps')).toBeInTheDocument();
    expect(within(row).getByText(/Every Monday at 06:00 \(Europe\/Oslo\)/)).toBeInTheDocument();
    expect(within(row).getByText('On')).toBeInTheDocument();
    expect(within(row).getByText('Failed')).toBeInTheDocument();
  });

  it('should render fifty workflows without truncating', () => {
    const workflows = Array.from({ length: 50 }, (_, index) => ({
      ...WORKFLOW,
      id: `wf-${index}`,
      displayName: `Workflow ${index}`,
    }));

    renderCard({ workflows });

    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    expect(screen.getByText('Workflow 49')).toBeInTheDocument();
  });

  it('should drill down to the runs through run_list, and back', async () => {
    const { host, user } = renderCard({ workflows: [WORKFLOW] });
    host.callTool.mockResolvedValue({ ok: true, data: RUN_LIST });

    await user.click(screen.getByRole('button', { name: 'Runs of Weekly digest' }));

    expect(host.callTool).toHaveBeenCalledWith('run_list', { workflowId: 'wf-1' });
    expect(await screen.findByRole('heading', { name: 'Weekly digest' })).toBeInTheDocument();
    expect(screen.getByText('1 run, newest first')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Workflows' })).toBeInTheDocument();
  });

  it('should ask Claude to run a workflow rather than run it', async () => {
    const { host, user } = renderCard({ workflows: [WORKFLOW] });

    await user.click(screen.getByRole('button', { name: 'Run now' }));

    expect(host.ask).toHaveBeenCalledWith(
      'Run the grieg workflow "Weekly digest" now (workflowId wf-1).',
    );
    expect(host.callTool).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('Asked Claude.');
  });

  it('should ask Claude once when Run now is clicked twice', async () => {
    const host = fakeHost();
    host.ask.mockReturnValue(new Promise(() => undefined));
    const { user } = renderCard({ workflows: [WORKFLOW] }, {}, host);

    await user.dblClick(screen.getByRole('button', { name: 'Run now' }));

    expect(host.ask).toHaveBeenCalledTimes(1);
  });

  it('should tell the user what to ask when the host rejects the message', async () => {
    const host = fakeHost();
    host.ask.mockResolvedValue(false);
    const { user } = renderCard({ workflows: [WORKFLOW] }, {}, host);

    await user.click(screen.getByRole('button', { name: 'Run now' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Ask Claude to run "Weekly digest" now.',
    );
  });

  it('should open the workflow in the admin tool through the host', async () => {
    const { host, user } = renderCard({ workflows: [WORKFLOW] });

    await user.click(screen.getByRole('button', { name: 'Open Weekly digest in the admin tool' }));

    expect(host.openLink).toHaveBeenCalledWith(`${ADMIN}/wf-1`);
  });

  it('should refresh by calling the same tool again', async () => {
    const { host, user } = renderCard({ workflows: [WORKFLOW] });
    host.callTool.mockResolvedValue({
      ok: true,
      data: { workflows: [{ ...WORKFLOW, displayName: 'Renamed' }] },
    });

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(host.callTool).toHaveBeenCalledWith('workflow_list', {});
    expect(await screen.findByText('Renamed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });

  it('should drop a drill-down that lands after the user went back', async () => {
    const { host, user } = renderCard({ workflows: [WORKFLOW] });
    host.callTool.mockResolvedValueOnce({ ok: true, data: RUN_LIST });
    await user.click(screen.getByRole('button', { name: 'Runs of Weekly digest' }));
    await screen.findByRole('button', { name: 'Back' });
    let resolve: (value: unknown) => void = () => undefined;
    host.callTool.mockReturnValueOnce(new Promise((done) => (resolve = done)));

    await user.click(screen.getByRole('button', { name: 'Run run-2' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    resolve({ ok: true, data: RUN });

    expect(await screen.findByRole('heading', { name: 'Workflows' })).toBeInTheDocument();
    expect(screen.queryByText('outline')).not.toBeInTheDocument();
  });

  it('should show a failed read as an alert and keep the card', async () => {
    const { host, user } = renderCard({ workflows: [WORKFLOW] });
    host.callTool.mockResolvedValue({ ok: false, message: 'The workflow tools require admin.' });

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The workflow tools require admin.');
    expect(screen.getByText('Weekly digest')).toBeInTheDocument();
  });
});

describe('runs card', () => {
  it('should drill from a run to its steps through run_get', async () => {
    const { host, user } = renderCard(RUN_LIST);
    host.callTool.mockResolvedValue({ ok: true, data: RUN });

    await user.click(screen.getByRole('button', { name: 'Run run-2' }));

    expect(host.callTool).toHaveBeenCalledWith('run_get', { workflowId: 'wf-1', runId: 'run-2' });
    expect(await screen.findByText('outline')).toBeInTheDocument();
  });

  it('should show each step with its duration, the failed one open with its error', () => {
    renderCard(RUN);

    expect(screen.getByText('1.7 s')).toBeInTheDocument();
    expect(screen.getByText('2.2 s')).toBeInTheDocument();
    const failed = screen.getByText('summary').closest('details');
    expect(failed).toHaveAttribute('open');
    expect(screen.getByText('outline').closest('details')).not.toHaveAttribute('open');
    expect(within(failed as HTMLElement).getByText('Vertex AI returned 429')).toBeVisible();
    // The run's error is the failed step's, so it is shown once.
    expect(screen.queryByText(/Step summary failed/)).not.toBeInTheDocument();
    expect(screen.getByText(/Cut to 4,000 characters/)).toBeInTheDocument();
  });

  it('should show a run error that no step carries', () => {
    renderCard({ ...RUN, error: 'Interrupted by a restart' });

    expect(screen.getByText('Interrupted by a restart')).toBeInTheDocument();
  });

  it('should render a run output as text, never as markup', () => {
    renderCard({ ...RUN, output: '<img src=x onerror="alert(1)">', error: null });

    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('crons card', () => {
  it('should offer disable, delete and admin on an enabled workflow schedule', async () => {
    const { host, user } = renderCard({ jobs: [OWN_JOB, OTHER_JOB] });
    const [own] = screen.getAllByRole('listitem');

    expect(within(own).getByText('Weekly digest')).toBeInTheDocument();
    expect(within(own).getByText('Every Monday at 06:00')).toBeInTheDocument();
    expect(within(own).getByText('0 6 * * 1')).toBeInTheDocument();
    expect(
      within(own)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? button.textContent),
    ).toEqual([
      'Disable',
      'Delete the schedule of Weekly digest',
      'Open Weekly digest in the admin tool',
    ]);

    await user.click(within(own).getByRole('button', { name: 'Disable' }));
    expect(host.ask).toHaveBeenCalledWith(
      'Disable the schedule of the grieg workflow "Weekly digest" (workflowId wf-1).',
    );

    await user.click(
      within(own).getByRole('button', { name: 'Delete the schedule of Weekly digest' }),
    );

    expect(host.ask).toHaveBeenCalledWith(
      'Delete the schedule of the grieg workflow "Weekly digest" (workflowId wf-1). Keep the workflow and its runs.',
    );
  });

  it("should only offer to enable another application's job, by name", async () => {
    const { host, user } = renderCard({ jobs: [OWN_JOB, OTHER_JOB] });
    const other = screen.getAllByRole('listitem')[1];

    expect(
      within(other)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Enable']);
    await user.click(within(other).getByRole('button', { name: 'Enable' }));

    expect(host.ask).toHaveBeenCalledWith(
      `Enable the scheduled job "purge-trash" (another application's job, by name).`,
    );
  });
});

describe('nodes card', () => {
  it('should page with the cursor and append the next hits', async () => {
    const { host, user } = renderCard(
      { total: 3, count: 2, hits: [hit('a'), hit('b')], nextCursor: 'c2' },
      NODE_ARGS,
    );
    host.callTool.mockResolvedValue({
      ok: true,
      data: { total: 3, count: 1, hits: [hit('c')] },
    });

    await user.click(screen.getByRole('button', { name: 'Show more (1 left)' }));

    expect(host.callTool).toHaveBeenCalledWith('node_query', { ...NODE_ARGS, cursor: 'c2' });
    expect(await screen.findByText('c')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /Show more/ })).not.toBeInTheDocument();
  });

  it('should drop a page that lands after a refresh', async () => {
    const { host, user } = renderCard(
      { total: 3, count: 2, hits: [hit('a'), hit('b')], nextCursor: 'c2' },
      NODE_ARGS,
    );
    let resolvePage: (value: unknown) => void = () => undefined;
    host.callTool.mockReturnValueOnce(new Promise((done) => (resolvePage = done)));
    host.callTool.mockResolvedValueOnce({
      ok: true,
      data: { total: 1, count: 1, hits: [hit('z')] },
    });

    await user.click(screen.getByRole('button', { name: 'Show more (1 left)' }));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('z');
    await act(async () => {
      resolvePage({ ok: true, data: { total: 3, count: 1, hits: [hit('c')] } });
    });

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText('c')).not.toBeInTheDocument();
  });

  it('should drill from a hit to the node through node_get', async () => {
    const { host, user } = renderCard({ total: 1, count: 1, hits: [hit('a')] }, NODE_ARGS);
    host.callTool.mockResolvedValue({
      ok: true,
      data: { ...hit('a'), data: { title: 'Espresso', tags: ['coffee', 'kitchen'] } },
    });

    await user.click(screen.getByRole('button', { name: 'Open /products/a' }));

    expect(host.callTool).toHaveBeenCalledWith('node_get', {
      repo: 'com.example.catalog',
      branch: 'master',
      key: 'id-a',
    });
    expect(await screen.findByText('Espresso')).toBeInTheDocument();
    expect(screen.getByText('kitchen')).toBeInTheDocument();
  });

  it("should show a node's properties as a tree with truncation notes", () => {
    renderCard(
      {
        ...hit('a'),
        data: {
          dimensions: { width: 28, unit: 'cm' },
          body: { truncated: true, size: 90_000, message: 'Ask for fields instead.' },
        },
      },
      NODE_ARGS,
    );

    expect(screen.getByText('width')).toBeInTheDocument();
    expect(screen.getByText('28')).toBeInTheDocument();
    expect(screen.getByText('Ask for fields instead.')).toBeInTheDocument();
    expect(screen.queryByText('size')).not.toBeInTheDocument();
  });

  it('should browse a branch from the repository list', async () => {
    const { host, user } = renderCard({
      repos: [
        {
          id: 'com.example.catalog',
          branches: ['master'],
          defaultBranch: 'master',
          access: 'write',
        },
      ],
    });
    host.callTool.mockResolvedValue({ ok: true, data: { total: 0, count: 0, hits: [] } });

    await user.click(screen.getByRole('button', { name: 'Browse com.example.catalog on master' }));

    expect(host.callTool).toHaveBeenCalledWith('node_query', {
      repo: 'com.example.catalog',
      branch: 'master',
      query: "_parentPath = '/'",
      count: 20,
    });
    expect(await screen.findByText('No nodes match.')).toBeInTheDocument();
  });
});

describe('content card', () => {
  it('should list hits with type, language, state and parent path', () => {
    renderCard(
      {
        total: 2,
        start: 0,
        count: 2,
        hits: [
          contentHit('a'),
          contentHit('b', { language: 'nb', workflowState: 'IN_PROGRESS', valid: false }),
        ],
      },
      { text: 'coffee' },
    );

    expect(screen.getByRole('heading', { name: 'Content' })).toBeInTheDocument();
    expect(screen.getByText('2 items · "coffee"')).toBeInTheDocument();
    const [first, second] = screen.getAllByRole('listitem');
    expect(within(first).getByText('Article a')).toBeInTheDocument();
    expect(within(first).getByText('com.example.news:article')).toBeInTheDocument();
    expect(within(first).getByText('Ready')).toBeInTheDocument();
    expect(within(first).getByText('site › articles')).toBeInTheDocument();
    expect(within(second).getByText('nb')).toBeInTheDocument();
    expect(within(second).getByText('In progress')).toBeInTheDocument();
    expect(within(second).getByText('Invalid')).toBeInTheDocument();
  });

  it('should page with the cursor in place of start and append the hits', async () => {
    const { host, user } = renderCard(
      { total: 3, start: 0, count: 2, hits: [contentHit('a'), contentHit('b')], nextCursor: 'c2' },
      { path: '/site/articles', start: 0, count: 2 },
    );
    host.callTool.mockResolvedValue({
      ok: true,
      data: { total: 3, start: 2, count: 1, hits: [contentHit('c')] },
    });

    await user.click(screen.getByRole('button', { name: 'Show more (1 left)' }));

    expect(host.callTool).toHaveBeenCalledWith('content_search', {
      path: '/site/articles',
      count: 2,
      cursor: 'c2',
    });
    expect(await screen.findByText('Article c')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /Show more/ })).not.toBeInTheDocument();
  });

  it('should browse the children of a folder hit', async () => {
    const folder = contentHit('archive', {
      type: 'base:folder',
      displayName: 'Archive',
      hasChildren: true,
    });
    const unknown = contentHit('maybe', { displayName: 'Maybe', hasChildren: null });
    const { host, user } = renderCard({ total: 2, start: 0, count: 2, hits: [folder, unknown] });
    expect(screen.queryByRole('button', { name: 'Browse Maybe' })).not.toBeInTheDocument();
    host.callTool.mockResolvedValue({
      ok: true,
      data: { total: 0, start: 0, count: 0, hits: [] },
    });

    await user.click(screen.getByRole('button', { name: 'Browse Archive' }));

    expect(host.callTool).toHaveBeenCalledWith('content_search', {
      path: '/site/articles/archive',
      count: 20,
    });
    expect(await screen.findByText('No content matches.')).toBeInTheDocument();
  });

  it('should show the project and an inherited or localized chip on layer items only', () => {
    renderCard({
      total: 3,
      start: 0,
      count: 3,
      hits: [
        contentHit('a', { project: 'norway', inheritance: 'inherited' }),
        contentHit('b', { project: 'norway', inheritance: 'localized' }),
        contentHit('c', { project: 'default', inheritance: null }),
      ],
    });

    const [inherited, localized, own] = screen.getAllByRole('listitem');
    expect(within(inherited).getByText('norway')).toBeInTheDocument();
    expect(within(inherited).getByText('Inherited')).toBeInTheDocument();
    expect(within(localized).getByText('Localized')).toBeInTheDocument();
    expect(within(own).queryByText('default')).not.toBeInTheDocument();
    expect(within(own).queryByText(/Inherited|Localized/)).not.toBeInTheDocument();
  });

  it("should keep drill-downs in the item's project", async () => {
    const hit = contentHit('a', { project: 'norway', inheritance: 'inherited', hasChildren: true });
    const { host, user } = renderCard({ total: 1, start: 0, count: 1, hits: [hit] });
    host.callTool.mockResolvedValue({ ok: true, data: { ...hit, data: {} } });

    await user.click(screen.getByRole('button', { name: 'Browse Article a' }));
    expect(host.callTool).toHaveBeenLastCalledWith('content_search', {
      project: 'norway',
      path: '/site/articles/a',
      count: 20,
    });
  });

  it('should drill from a hit to the item through content_get', async () => {
    const { host, user } = renderCard({ total: 1, start: 0, count: 1, hits: [contentHit('a')] });
    host.callTool.mockResolvedValue({
      ok: true,
      data: {
        ...contentHit('a'),
        owner: 'user:system:ingrid',
        createdTime: '2026-03-01T08:00:00Z',
        publishedTime: null,
        data: { title: 'Pour-over', author: { name: 'Ingrid Berg' }, tags: ['brewing'] },
      },
    });

    await user.click(screen.getByRole('button', { name: 'Open /site/articles/a' }));

    expect(host.callTool).toHaveBeenCalledWith('content_get', { key: 'c-a' });
    expect(await screen.findByRole('heading', { name: 'Article a' })).toBeInTheDocument();
    expect(screen.getByText('Pour-over')).toBeInTheDocument();
    expect(screen.getByText('Ingrid Berg')).toBeInTheDocument();
    expect(screen.getByText('brewing')).toBeInTheDocument();
    expect(screen.getByText('Owner ingrid')).toBeInTheDocument();
    expect(screen.queryByText(/Published/)).not.toBeInTheDocument();

    // The card opens no URL taken from tool data, editUrl included.
    expect(screen.queryByRole('button', { name: /^Open in/ })).not.toBeInTheDocument();
  });

  it('should open the content type and a parent folder from an item', async () => {
    const { host, user } = renderCard({ ...contentHit('a'), data: {} });
    host.callTool.mockResolvedValueOnce({ ok: true, data: ARTICLE_TYPE });

    await user.click(screen.getByRole('button', { name: 'Content type com.example.news:article' }));

    expect(host.callTool).toHaveBeenCalledWith('content_type_get', {
      name: 'com.example.news:article',
    });
    expect(await screen.findByRole('heading', { name: 'Article' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    host.callTool.mockResolvedValueOnce({
      ok: true,
      data: { total: 0, start: 0, count: 0, hits: [] },
    });
    await user.click(screen.getByRole('button', { name: 'site' }));

    expect(host.callTool).toHaveBeenLastCalledWith('content_search', { path: '/site', count: 20 });
  });

  it('should count what is left after the page the search started at', () => {
    renderCard({ total: 100, start: 80, count: 10, hits: [contentHit('a')], nextCursor: 'c81' });

    expect(screen.getByRole('button', { name: 'Show more (19 left)' })).toBeInTheDocument();
  });

  it('should title an item opened from a hit without a display name by its name', async () => {
    const { host, user } = renderCard({
      total: 1,
      start: 0,
      count: 1,
      hits: [contentHit('a', { displayName: '' })],
    });
    host.callTool.mockResolvedValue({
      ok: true,
      data: { ...contentHit('a', { displayName: '' }) },
    });

    await user.click(screen.getByRole('button', { name: 'Open /site/articles/a' }));

    expect(await screen.findByRole('heading', { name: 'a' })).toBeInTheDocument();
  });

  it('should title an item without a display name by its name', () => {
    renderCard({ ...contentHit('a'), displayName: '', data: {} });

    expect(screen.getByRole('heading', { name: 'a' })).toBeInTheDocument();
  });

  it('should separate only the dates an item has', () => {
    renderCard({
      ...contentHit('a'),
      modifiedTime: null,
      createdTime: '2026-03-01T08:00:00Z',
      publishedTime: '2026-03-02T08:00:00Z',
    });

    const line = screen.getByText(/^Created/).closest('div');
    expect(line?.textContent).toMatch(/^Created [^·]+·Published [^·]+$/);
  });

  it('should render field values as text, never as markup', () => {
    renderCard({ ...contentHit('a'), data: { body: '<img src=x onerror="alert(1)">' } });

    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it("should list a content type's fields with type, occurrences and options", () => {
    renderCard(ARTICLE_TYPE);

    expect(screen.getByText('com.example.news:article')).toBeInTheDocument();
    const [category, author, name] = screen.getAllByRole('listitem');
    expect(within(category).getByText('ComboBox')).toBeInTheDocument();
    expect(within(category).getByText('Required')).toBeInTheDocument();
    expect(within(category).getByText('Guide')).toBeInTheDocument();
    expect(within(author).getByText('Item set')).toBeInTheDocument();
    expect(within(author).getByText('Any number')).toBeInTheDocument();
    expect(within(name).getByText('author.name')).toBeInTheDocument();
    expect(within(name).getByText('Optional')).toBeInTheDocument();
  });
});

describe('readResult', () => {
  it('should read structured content, and the text of an error result', () => {
    expect(readResult({ structuredContent: { jobs: [] } })).toEqual({
      ok: true,
      data: { jobs: [] },
    });
    expect(readResult({ isError: true, content: [{ type: 'text', text: 'No workflow' }] })).toEqual(
      { ok: false, message: 'No workflow' },
    );
  });
});
