import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import type { CardContextValue } from './card-context';
import type { CardHost } from './host';
import type { CardTool, JsonObject, Screen, ToolResults } from './shapes';
import type { ReactElement } from 'react';

import { Button } from '../js/components/ui/button';
import { cn } from '../js/lib/utils';
import { CardContext } from './card-context';
import { inferTool, toScreen } from './shapes';
import { ContentSearchView, ContentTypeView, ContentView } from './views/content';
import { ContentFormView } from './views/content-form';
import { CronsView } from './views/crons';
import { NodeQueryView, NodeView, ReposView } from './views/nodes';
import { RunDetailView, RunListView } from './views/runs';
import { WorkflowsView } from './views/workflows';

type Heading = { title: string; subtitle?: string; adminUrl?: string };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function headingOf(screen: Screen): Heading {
  switch (screen.tool) {
    case 'workflow_list':
      return {
        title: 'Workflows',
        subtitle: plural(screen.data.workflows.length, 'workflow', 'workflows'),
      };
    case 'run_list':
      return {
        title: screen.title ?? 'Runs',
        subtitle: `${plural(screen.data.runs.length, 'run', 'runs')}, newest first`,
        adminUrl: screen.data.adminUrl,
      };
    case 'run_get':
      return {
        title: screen.title ?? 'Run',
        subtitle: screen.data.id,
        adminUrl: screen.data.adminUrl,
      };
    case 'cron_list':
      return { title: 'Scheduled jobs', subtitle: plural(screen.data.jobs.length, 'job', 'jobs') };
    case 'node_query': {
      const where = [screen.args.repo, screen.args.branch].filter(
        (part) => typeof part === 'string',
      );
      return {
        title: screen.title ?? 'Nodes',
        subtitle: [plural(screen.data.total, 'node', 'nodes'), ...where].join(' · '),
      };
    }
    case 'node_get':
      return { title: screen.title ?? (screen.data._name || '/'), subtitle: screen.data._path };
    case 'node_repos':
      return {
        title: 'Repositories',
        subtitle: plural(screen.data.repos.length, 'repository', 'repositories'),
      };
    case 'content_search': {
      const { text, path, contentType } = screen.args;
      const where = [typeof text === 'string' ? `"${text}"` : undefined, path, contentType].filter(
        (part) => typeof part === 'string',
      );
      return {
        title: screen.title || 'Content',
        subtitle: [plural(screen.data.total, 'item', 'items'), ...where].join(' · '),
      };
    }
    case 'content_get':
      return {
        title: screen.title || screen.data.displayName || screen.data.name,
        subtitle: screen.data.path,
      };
    case 'content_type_get':
      return screen.data.draft == null
        ? { title: screen.data.displayName, subtitle: screen.data.name }
        : { title: `New ${screen.data.displayName}`, subtitle: screen.data.name };
  }
}

function isForm(screen: Screen): boolean {
  return screen.tool === 'content_type_get' && screen.data.draft != null;
}

const ScreenBody = ({ screen }: { screen: Screen }): ReactElement => {
  switch (screen.tool) {
    case 'workflow_list':
      return <WorkflowsView data={screen.data} />;
    case 'run_list':
      return <RunListView data={screen.data} />;
    case 'run_get':
      return <RunDetailView data={screen.data} />;
    case 'cron_list':
      return <CronsView data={screen.data} />;
    case 'node_query':
      return <NodeQueryView data={screen.data} args={screen.args} />;
    case 'node_get':
      return <NodeView data={screen.data} args={screen.args} />;
    case 'node_repos':
      return <ReposView data={screen.data} />;
    case 'content_search':
      return <ContentSearchView data={screen.data} args={screen.args} />;
    case 'content_get':
      return <ContentView data={screen.data} />;
    case 'content_type_get':
      return screen.data.draft == null ? (
        <ContentTypeView data={screen.data} />
      ) : (
        <ContentFormView type={screen.data} draft={screen.data.draft} />
      );
  }
};

type Notice = { tone: 'info' | 'error'; text: string };

type CardProps = { host: CardHost; locale: string; initial: Screen };

const CARD_NAME = 'Card';

export const Card = ({ host, locale, initial }: CardProps): ReactElement => {
  const [stack, setStack] = useState<Screen[]>([initial]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [refreshes, setRefreshes] = useState(0);
  const screen = stack[stack.length - 1];
  // Bumped by every navigation and refresh, so a slow call cannot land on a screen the user
  // has left or replaced.
  const generation = useRef(0);
  const asking = useRef(false);

  const refetch = useCallback(
    async <T extends CardTool>(
      tool: T,
      args: JsonObject,
      merge: (current: ToolResults[T], next: ToolResults[T]) => ToolResults[T],
    ) => {
      const started = generation.current;
      const result = await host.callTool(tool, args);
      if (started !== generation.current) return;
      if (!result.ok) {
        setNotice({ tone: 'error', text: result.message });
        return;
      }
      if (inferTool(result.data) !== tool) return;
      setNotice((current) => (current?.tone === 'error' ? null : current));
      setStack((current) => {
        const top = current[current.length - 1];
        if (top.tool !== tool) return current;
        const data = merge(top.data as ToolResults[T], result.data as ToolResults[T]);
        return [...current.slice(0, -1), { ...top, data } as Screen];
      });
    },
    [host],
  );

  const load = useCallback(
    async (tool: CardTool, args: JsonObject, title: string | undefined, replace: boolean) => {
      const started = ++generation.current;
      setBusy(true);
      setNotice(null);
      const result = await host.callTool(tool, args);
      if (started !== generation.current) return;
      setBusy(false);
      if (!result.ok) {
        setNotice({ tone: 'error', text: result.message });
        return;
      }
      const next = toScreen(result.data, args, title);
      if (next?.tool !== tool) {
        setNotice({ tone: 'error', text: `${tool} returned a result this card cannot show.` });
        return;
      }
      setStack((current) => (replace ? [...current.slice(0, -1), next] : [...current, next]));
      if (replace) setRefreshes((count) => count + 1);
    },
    [host],
  );

  // One request at a time, so a double click does not ask Claude twice.
  const ask = useCallback(
    async (request: string, hint: string) => {
      if (asking.current) return false;
      asking.current = true;
      setNotice(null);
      const sent = await host.ask(request);
      asking.current = false;
      setNotice({
        tone: 'info',
        text: sent ? 'Asked Claude. Approve the tool call to go ahead.' : `Ask Claude to ${hint}.`,
      });
      return sent;
    },
    [host],
  );

  const context = useMemo<CardContextValue>(
    () => ({
      host,
      locale,
      open: (tool, args, title) => void load(tool, args, title, false),
      refetch,
      refreshes,
      ask,
    }),
    [host, locale, load, refetch, refreshes, ask],
  );

  const { title, subtitle, adminUrl } = headingOf(screen);
  const back = () => {
    generation.current += 1;
    setBusy(false);
    setNotice(null);
    setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
  };

  return (
    <CardContext value={context}>
      <section data-component={CARD_NAME} className="@container pb-1" aria-busy={busy}>
        <header className="flex items-center gap-1.5 px-4 pt-3 pb-2">
          {stack.length > 1 && (
            <Button
              size="icon"
              variant="ghost"
              className="-ml-2 size-7"
              aria-label="Back"
              onClick={back}
            >
              <ArrowLeft />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] leading-5 font-semibold">{title}</h2>
            {subtitle != null && (
              <p className="text-muted-foreground truncate text-xs">{subtitle}</p>
            )}
          </div>
          {adminUrl != null && (
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label="Open in the admin tool"
              title="Open in admin"
              onClick={() => host.openLink(adminUrl)}
            >
              <ExternalLink />
            </Button>
          )}
          {/* Reloading a form would throw away the user's edits. */}
          {!isForm(screen) && (
            <Button
              size="icon"
              variant="ghost"
              className="-mr-2 size-7"
              aria-label="Refresh"
              title="Refresh"
              disabled={busy}
              onClick={() => void load(screen.tool, screen.args, screen.title, true)}
            >
              <RefreshCw className={cn(busy && 'animate-spin')} />
            </Button>
          )}
        </header>
        {notice != null && (
          <p
            role={notice.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'mx-4 mb-2 rounded-md px-3 py-1.5 text-xs',
              notice.tone === 'error' ? 'bg-danger-subtle text-danger' : 'bg-info-subtle text-info',
            )}
          >
            {notice.text}
          </p>
        )}
        <div className={cn('border-t transition-opacity', busy && 'opacity-60')}>
          <ScreenBody key={stack.length} screen={screen} />
        </div>
      </section>
    </CardContext>
  );
};

Card.displayName = CARD_NAME;
