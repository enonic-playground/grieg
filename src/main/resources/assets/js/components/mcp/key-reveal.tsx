import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReactElement } from 'react';

import { Button } from '../ui/button';
import { CopyButton } from '../ui/copy-button';

const README_MCP_URL = 'https://github.com/enonic-playground/grieg#mcp';
const TOKEN_ENV = 'GRIEG_MCP_TOKEN';

// The origin comes from the request's Host, so anything beyond a plain host and port stays out
// of a command meant to be pasted into a shell.
const SHELL_SAFE_URL =
  /^https?:\/\/(?:[a-z\d-]+(?:\.[a-z\d-]+)*|\[[a-f\d:.]+\])(?::\d+)?\/api\/[\w.-]+:mcp$/i;
const URL_PLACEHOLDER = '<endpoint URL>';

export function buildClaudeCommand(mcpUri: string, key: string): string {
  const url = SHELL_SAFE_URL.test(mcpUri) ? mcpUri : URL_PLACEHOLDER;
  return `claude mcp add --transport http grieg "${url}" --header "Authorization: Bearer ${key}"`;
}

export function buildMcpJson(mcpUri: string): string {
  const config = {
    mcpServers: {
      grieg: {
        type: 'http',
        url: mcpUri,
        headers: { Authorization: `Bearer \${${TOKEN_ENV}}` },
      },
    },
  };
  return JSON.stringify(config, null, 2);
}

type SnippetProps = {
  label: string;
  text: string;
};

const Snippet = ({ label, text }: SnippetProps): ReactElement => {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">{label}</span>
        <CopyButton text={text} />
      </div>
      <pre className="bg-muted overflow-x-auto rounded-md border p-3 font-mono text-xs select-all">
        {text}
      </pre>
    </div>
  );
};

export type KeyRevealProps = {
  apiKey: string;
  mcpUri: string;
  onDone: () => void;
};

const KEY_REVEAL_NAME = 'KeyReveal';

export const KeyReveal = ({ apiKey, mcpUri, onDone }: KeyRevealProps): ReactElement => {
  const { t } = useTranslation();

  return (
    <div data-component={KEY_REVEAL_NAME} className="flex flex-col gap-4">
      <div
        role="alert"
        className="border-warning/40 bg-warning/10 text-foreground flex items-start gap-2 rounded-md border p-3 text-sm"
      >
        <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" />
        <span>{t('mcp.reveal.warning')}</span>
      </div>

      <Snippet label={t('mcp.reveal.key')} text={apiKey} />
      <Snippet label={t('mcp.reveal.claude')} text={buildClaudeCommand(mcpUri, apiKey)} />
      <Snippet label={t('mcp.reveal.mcpJson', { env: TOKEN_ENV })} text={buildMcpJson(mcpUri)} />

      <p className="text-muted-foreground text-xs">
        {t('mcp.reveal.otherClients')}{' '}
        <a
          href={README_MCP_URL}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline-offset-4 hover:underline"
        >
          {t('mcp.reveal.readme')}
        </a>
      </p>

      <div>
        <Button variant="primary" onClick={onDone}>
          {t('mcp.reveal.done')}
        </Button>
      </div>
    </div>
  );
};

KeyReveal.displayName = KEY_REVEAL_NAME;
