import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { CallToolResult } from '@modelcontextprotocol/client';
import type { McpUiHostContext, McpUiStyles } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { ReactElement } from 'react';

// A stand-in MCP Apps host: loads the built card in an iframe through the official AppBridge,
// sends a tool's input and result, and answers the card's tools/call from the dev mock. Open
// /cards.html under `pnpm dev`; `?scenario=<name>&theme=dark&width=400` preselects.

type Scenario = { view: string; tool: string; args: Record<string, unknown> };

const DRAFT = {
  parentPath: '/coffee-blog/articles',
  displayName: 'Cold brew at home',
  data: {
    title: 'Cold brew at home',
    lead: 'Smooth, low-acid coffee with nothing but a jar and a night in the fridge.',
    body: '<p>Coarse grind, cold water, 16 hours.</p>',
    category: 'guide',
    tags: ['cold brew', 'summer'],
    readingTime: 6,
    featured: true,
    rating: 4.5,
    layout: 'wide',
    publishOn: '2026-11-02',
    author: { name: 'Ingrid Berg', bio: 'Barista and trainer in Oslo' },
    media: { _selected: ['image'], image: { caption: 'A jar of cold brew' } },
  },
};

const SCENARIOS: Record<string, Scenario> = {
  workflows: { view: 'workflows', tool: 'workflow_list', args: {} },
  runs: { view: 'runs', tool: 'run_list', args: { workflowId: 'wf-1' } },
  run: { view: 'runs', tool: 'run_get', args: { workflowId: 'wf-1', runId: 'run-seed-1' } },
  'failed-run': {
    view: 'runs',
    tool: 'run_get',
    args: { workflowId: 'wf-1', runId: 'run-seed-2' },
  },
  crons: { view: 'crons', tool: 'cron_list', args: {} },
  repos: { view: 'nodes', tool: 'node_repos', args: {} },
  nodes: {
    view: 'nodes',
    tool: 'node_query',
    args: { repo: 'com.example.catalog', branch: 'master', query: '', count: 2 },
  },
  node: {
    view: 'nodes',
    tool: 'node_get',
    args: { repo: 'com.example.catalog', branch: 'master', key: '/products/espresso-machine' },
  },
  search: { view: 'content', tool: 'content_search', args: { text: 'guide' } },
  articles: {
    view: 'content',
    tool: 'content_search',
    args: { path: '/coffee-blog/articles', count: 3 },
  },
  content: {
    view: 'content',
    tool: 'content_get',
    args: { key: '/coffee-blog/articles/brewing-guide' },
  },
  'content-type': {
    view: 'content',
    tool: 'content_type_get',
    args: { name: 'com.example.news:article' },
  },
  'content-form': {
    view: 'content',
    tool: 'content_type_get',
    args: { name: 'com.example.news:article', draft: DRAFT },
  },
  'content-refused': {
    view: 'content',
    tool: 'content_type_get',
    args: {
      name: 'com.example.news:article',
      draft: {
        ...DRAFT,
        data: { ...DRAFT.data, title: undefined, author: [{ bio: 'Roaster' }, { bio: 'Editor' }] },
        error:
          'Nothing was created: the data does not fit `com.example.news:article`. `data.title` needs at least 1 value(s), got 0. `data.author.0.name` needs at least 1 value(s), got 0. `data.author.1.name` needs at least 1 value(s), got 0. Check the fields with content_type_get and retry.',
      },
    },
  },
};

type Theme = 'light' | 'dark';

// Close to what Claude sends, so the screenshots show the card as it looks there.
const VARIABLES: Record<Theme, Partial<McpUiStyles>> = {
  light: {
    '--color-background-primary': '#ffffff',
    '--color-background-secondary': '#f5f4ed',
    '--color-background-tertiary': '#f0eee6',
    '--color-background-inverse': '#141413',
    '--color-background-success': '#e9f2e4',
    '--color-background-danger': '#fbe9e7',
    '--color-background-info': '#e7effa',
    '--color-text-primary': '#141413',
    '--color-text-secondary': '#3d3d3a',
    '--color-text-tertiary': '#73726c',
    '--color-text-inverse': '#ffffff',
    '--color-text-success': '#2e7d32',
    '--color-text-danger': '#b3261e',
    '--color-text-info': '#2c6fbf',
    '--color-border-primary': 'rgb(31 30 29 / 0.15)',
    '--color-ring-primary': '#2c84db',
    '--font-sans': 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    '--font-mono': 'ui-monospace, "SF Mono", Menlo, monospace',
    '--border-radius-md': '8px',
  },
  dark: {
    '--color-background-primary': '#262624',
    '--color-background-secondary': '#30302e',
    '--color-background-tertiary': '#3a3a37',
    '--color-background-inverse': '#faf9f5',
    '--color-background-success': '#1f3320',
    '--color-background-danger': '#3d2523',
    '--color-background-info': '#22303f',
    '--color-text-primary': '#faf9f5',
    '--color-text-secondary': '#c2c0b6',
    '--color-text-tertiary': '#9c9a92',
    '--color-text-inverse': '#141413',
    '--color-text-success': '#7cc47f',
    '--color-text-danger': '#f08a7e',
    '--color-text-info': '#7fb2ec',
    '--color-border-primary': 'rgb(222 220 209 / 0.15)',
    '--color-ring-primary': '#5a9fe0',
    '--font-sans': 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    '--font-mono': 'ui-monospace, "SF Mono", Menlo, monospace',
    '--border-radius-md': '8px',
  },
};

function hostContext(theme: Theme, tool: string): McpUiHostContext {
  return {
    theme,
    styles: { variables: VARIABLES[theme] as McpUiStyles },
    locale: 'en-US',
    platform: 'desktop',
    displayMode: 'inline',
    toolInfo: { tool: { name: tool, inputSchema: { type: 'object' } } },
  };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const response = await fetch('/dev-mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, arguments: args }),
    });
    if (!response.ok) throw new Error(`the dev mock answered ${response.status}`);
    return (await response.json()) as CallToolResult;
  } catch (e) {
    return { content: [{ type: 'text', text: String(e) }], isError: true };
  }
}

const params = new URLSearchParams(window.location.search);
const requested = params.get('scenario') ?? '';

const Harness = (): ReactElement => {
  const [scenario, setScenario] = useState(
    Object.hasOwn(SCENARIOS, requested) ? requested : 'workflows',
  );
  const [theme, setTheme] = useState<Theme>(params.get('theme') === 'dark' ? 'dark' : 'light');
  const [width, setWidth] = useState(Number(params.get('width') ?? 640));
  const [rejectMessages, setRejectMessages] = useState(false);
  const [height, setHeight] = useState(120);
  const [log, setLog] = useState<string[]>([]);
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<AppBridge>(null);
  // Read when the card loads or sends a message, without reloading it on every change.
  const latest = useRef({ theme, rejectMessages });
  const { tool } = SCENARIOS[scenario];

  useEffect(() => {
    latest.current = { theme, rejectMessages };
  }, [theme, rejectMessages]);

  useEffect(() => {
    document.body.classList.toggle('dark', theme === 'dark');
    bridge.current?.setHostContext(hostContext(theme, tool));
  }, [theme, tool]);

  useEffect(() => {
    const iframe = frame.current;
    if (iframe == null) return undefined;
    const { view, tool: name, args } = SCENARIOS[scenario];
    // A call still in flight when the scenario changes must not log into the next one.
    let active = true;
    const record = (line: string) => {
      if (active) setLog((lines) => [...lines, line]);
    };
    setLog([]);
    const host = new AppBridge(
      null,
      { name: 'grieg-dev-host', version: '1.0.0' },
      { openLinks: {}, serverTools: {}, message: { text: {} }, updateModelContext: { text: {} } },
      { hostContext: hostContext(latest.current.theme, name) },
    );
    bridge.current = host;
    host.oncalltool = async (call) => {
      record(`tools/call ${call.name} ${JSON.stringify(call.arguments ?? {})}`);
      return callTool(call.name, call.arguments ?? {});
    };
    host.onmessage = async (message) => {
      const text = message.content.map((item) => ('text' in item ? item.text : '')).join(' ');
      const rejected = latest.current.rejectMessages;
      record(`ui/message${rejected ? ' (rejected)' : ''}: ${text}`);
      return rejected ? { isError: true } : {};
    };
    host.onupdatemodelcontext = async ({ content }) => {
      const text = (content ?? []).map((item) => ('text' in item ? item.text : '')).join(' ');
      record(`ui/update-model-context: ${text}`);
      return {};
    };
    host.onopenlink = async ({ url }) => {
      record(`ui/open-link ${url}`);
      return {};
    };
    host.onsizechange = ({ height: next }) => {
      if (next != null) setHeight(next);
    };
    host.oninitialized = () => {
      record(`initialized; sending ${name} ${JSON.stringify(args)}`);
      void host.sendToolInput({ arguments: args });
      void callTool(name, args).then((result) => {
        if (active) void host.sendToolResult(result);
      });
    };

    const load = () => {
      const target = iframe.contentWindow;
      if (target != null) void host.connect(new PostMessageTransport(target, target));
    };
    iframe.addEventListener('load', load, { once: true });
    iframe.src = `/dev-card/${view}`;
    return () => {
      active = false;
      iframe.removeEventListener('load', load);
      void host.close();
      bridge.current = null;
    };
  }, [scenario]);

  return (
    <>
      <div className="controls">
        {Object.keys(SCENARIOS).map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={name === scenario}
            onClick={() => setScenario(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="controls">
        <button type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
          Theme: {theme}
        </button>
        <button type="button" onClick={() => setWidth(width === 400 ? 640 : 400)}>
          Width: {width}px
        </button>
        <label>
          <input
            type="checkbox"
            checked={rejectMessages}
            onChange={(event) => setRejectMessages(event.target.checked)}
          />{' '}
          Reject ui/message
        </label>
      </div>
      <div className="frame" style={{ width }}>
        <iframe
          ref={frame}
          title="Card"
          sandbox="allow-scripts allow-same-origin"
          style={{ height }}
        />
      </div>
      <pre className="log" aria-label="Host log">
        {log.join('\n')}
      </pre>
    </>
  );
};

createRoot(document.getElementById('harness') as HTMLElement).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
