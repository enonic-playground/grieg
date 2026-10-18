import type { Tool, UiResource } from './mcp';

// MCP Apps views. One HTML bundle serves every view; each resource stamps its view name onto
// `<html data-view>`, which the bundle reads at boot.

export const CARD_MIME_TYPE = 'text/html;profile=mcp-app';

const CARD_VIEWS = {
  workflows: {
    title: 'Workflows',
    description: 'Workflows with their schedule and last run',
    tools: ['workflow_list'],
  },
  runs: {
    title: 'Workflow runs',
    description: "A workflow's runs, and one run's steps and output",
    tools: ['run_list', 'run_get'],
  },
  crons: {
    title: 'Scheduled jobs',
    description: 'Every scheduled job on the server',
    tools: ['cron_list'],
  },
  nodes: {
    title: 'Repository nodes',
    description: 'Node query results, one node, or the readable repositories',
    tools: ['node_query', 'node_get', 'node_repos'],
  },
} as const;

export type CardView = keyof typeof CARD_VIEWS;

export function cardUri(view: CardView): string {
  return `ui://grieg/${view}`;
}

export function stampView(html: string, view: CardView): string {
  return html.replace(/<html\b/i, `<html data-view="${view}"`);
}

export function cardResources(html: string): UiResource[] {
  return Object.entries(CARD_VIEWS).map(([view, { title, description }]) => ({
    uri: cardUri(view as CardView),
    name: `grieg-${view}`,
    title,
    description,
    mimeType: CARD_MIME_TYPE,
    text: stampView(html, view as CardView),
    // No `csp` domains: the bundle is inline and makes no network requests.
    meta: { ui: { prefersBorder: true } },
  }));
}

const VIEW_BY_TOOL = new Map<string, CardView>(
  Object.entries(CARD_VIEWS).flatMap(([view, { tools }]) =>
    tools.map((tool) => [tool, view as CardView] as const),
  ),
);

export function withCards(tools: Tool[]): Tool[] {
  return tools.map((tool) => {
    const view = VIEW_BY_TOOL.get(tool.name);
    return view == null ? tool : { ...tool, ui: { resourceUri: cardUri(view) } };
  });
}
