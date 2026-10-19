import { useApp, useHostStyles } from '@modelcontextprotocol/ext-apps/react';
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { JsonObject } from './shapes';
import type { CallToolResult } from '@modelcontextprotocol/client';
import type { ReactElement } from 'react';

import { Card } from './card';
import { createHost, localeOf, readResult } from './host';
import { toScreen } from './shapes';
import './card.css';

const APP_INFO = { name: 'grieg-cards', version: '1.0.0' };

const VIEW_TITLES: Record<string, string> = {
  workflows: 'Workflows',
  runs: 'Runs',
  crons: 'Scheduled jobs',
  nodes: 'Nodes',
  content: 'Content',
};

function viewTitle(toolName: string | undefined): string {
  const view = document.documentElement.dataset.view;
  return VIEW_TITLES[view ?? ''] ?? toolName ?? 'Grieg';
}

const Status = ({ title, text }: { title: string; text: string }): ReactElement => (
  <section className="px-4 py-3">
    <h2 className="text-[15px] leading-5 font-semibold">{title}</h2>
    <p className="text-muted-foreground mt-0.5 text-xs">{text}</p>
  </section>
);

const CardApp = (): ReactElement => {
  const [args, setArgs] = useState<JsonObject>({});
  const [result, setResult] = useState<CallToolResult>();
  const [cancelled, setCancelled] = useState(false);
  // Counts what the host delivered, so a later input or result remounts the card on it.
  const [delivery, setDelivery] = useState(0);

  // Handlers go on before `connect()`, since the host may send the result right after it.
  const { app, error } = useApp({
    appInfo: APP_INFO,
    capabilities: {},
    onAppCreated: (created) => {
      created.ontoolinput = (params) => {
        setArgs(params.arguments ?? {});
        setDelivery((count) => count + 1);
      };
      created.ontoolresult = (params) => {
        setResult(params);
        setDelivery((count) => count + 1);
      };
      created.ontoolcancelled = () => setCancelled(true);
    },
  });
  const context = app?.getHostContext();
  useHostStyles(app, context);
  const host = useMemo(() => (app == null ? undefined : createHost(app)), [app]);

  const title = viewTitle(context?.toolInfo?.tool.name);

  if (error != null) return <Status title={title} text={`Could not connect: ${error.message}`} />;
  if (cancelled) return <Status title={title} text="The tool call was cancelled." />;
  if (host == null || result == null) return <Status title={title} text="Loading…" />;

  const read = readResult(result);
  if (!read.ok) return <Status title={title} text={read.message} />;
  const screen = toScreen(read.data, args);
  if (screen == null) return <Status title={title} text="This result has no card." />;
  return <Card key={delivery} host={host} locale={localeOf(context)} initial={screen} />;
};

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <CardApp />
  </StrictMode>,
);
