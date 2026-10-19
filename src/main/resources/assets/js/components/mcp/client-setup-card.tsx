import {
  AppWindow,
  ChevronRight,
  Download,
  Info,
  MessagesSquare,
  Plug,
  ShieldCheck,
  SquareTerminal,
  TriangleAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { GriegConfig } from '../../lib/config';
import type { ReactElement, ReactNode } from 'react';

import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { CopyField, CopyFields, Snippet } from './snippet';
import {
  buildClaudeCommand,
  buildCurlCheck,
  buildDesktopConfig,
  buildHttpConfig,
  buildMcpJson,
  buildReadToken,
  buildStdioConfig,
  buildVsCodeConfig,
  KEY_PLACEHOLDER,
  TOKEN_ENV,
} from './snippets';
import { StepCard } from './step-card';

const README_URL = 'https://github.com/enonic-playground/grieg';
const DESKTOP_CONFIG_PATHS = [
  ['macOS', '~/Library/Application Support/Claude/claude_desktop_config.json'],
  ['Windows', '%APPDATA%\\Claude\\claude_desktop_config.json'],
  ['Linux', '~/.config/Claude/claude_desktop_config.json'],
] as const;

type ReadmeLinkProps = {
  anchor: string;
  // Tells apart links that read the same in a screen reader's list of links.
  label?: string;
  children: ReactNode;
};

const ReadmeLink = ({ anchor, label, children }: ReadmeLinkProps): ReactElement => (
  <a
    href={`${README_URL}#${anchor}`}
    aria-label={label}
    target="_blank"
    rel="noreferrer"
    className="text-primary underline-offset-4 hover:underline"
  >
    {children}
  </a>
);

type InstructionsProps = {
  children: ReactNode;
};

const Instructions = ({ children }: InstructionsProps): ReactElement => (
  <ol className="flex list-none flex-col gap-4 [counter-reset:instruction]">{children}</ol>
);

type InstructionProps = {
  title: ReactNode;
  children?: ReactNode;
};

const Instruction = ({ title, children }: InstructionProps): ReactElement => (
  <li className="before:text-muted-foreground relative flex flex-col gap-2.5 pl-7 [counter-increment:instruction] before:absolute before:top-0 before:left-0 before:flex before:size-5 before:items-center before:justify-center before:rounded-full before:border before:font-mono before:text-[10px] before:font-semibold before:content-[counter(instruction)]">
    <p className="text-sm leading-5">{title}</p>
    {children}
  </li>
);

type PlaintextWarningProps = {
  children: ReactNode;
};

const PlaintextWarning = ({ children }: PlaintextWarningProps): ReactElement => (
  <p className="border-warning/40 bg-warning/10 flex items-start gap-2 rounded-md border p-2.5 text-xs">
    <TriangleAlert className="text-warning mt-px size-3.5 shrink-0" />
    <span>{children}</span>
  </p>
);

type SetupProps = {
  mcp: GriegConfig['mcp'];
  // The plaintext while step 1 still shows it.
  apiKey?: string;
};

const KeyField = ({ apiKey }: Pick<SetupProps, 'apiKey'>): ReactElement => {
  const { t } = useTranslation();
  return (
    <CopyField
      label={t('mcp.connect.field.key')}
      value={apiKey}
      placeholder={t('mcp.connect.savedKey')}
    />
  );
};

const DESKTOP_SETUP_NAME = 'DesktopSetup';

const DesktopSetup = ({ mcp, apiKey }: SetupProps): ReactElement => {
  const { t } = useTranslation();

  return (
    <div data-component={DESKTOP_SETUP_NAME} className="flex flex-col gap-5">
      <Instructions>
        <Instruction title={t('mcp.connect.desktop.download')}>
          <div>
            <Button variant="primary" asChild>
              <a href={mcp.bundleUri} download="grieg.mcpb">
                <Download />
                {t('mcp.connect.desktop.downloadAction')}
              </a>
            </Button>
          </div>
        </Instruction>
        <Instruction title={t('mcp.connect.desktop.install')} />
        <Instruction title={t('mcp.connect.desktop.configure')}>
          <CopyFields>
            <CopyField label={t('mcp.connect.field.endpoint')} value={mcp.uri} />
            <KeyField apiKey={apiKey} />
          </CopyFields>
        </Instruction>
        <Instruction title={t('mcp.connect.desktop.chat')} />
      </Instructions>

      <p className="text-muted-foreground text-xs">
        {t('mcp.connect.desktop.cards')}{' '}
        <ReadmeLink anchor="cards-in-claude-desktop">{t('mcp.connect.readme')}</ReadmeLink>
      </p>

      <details className="group rounded-md border">
        <summary className="hover:bg-row-hover flex cursor-pointer list-none items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
          {t('mcp.connect.desktop.fallback')}
        </summary>
        <div className="flex flex-col gap-3 border-t p-3">
          <p className="text-muted-foreground text-xs">{t('mcp.connect.desktop.fallbackWhen')}</p>
          <PlaintextWarning>{t('mcp.connect.desktop.fallbackWarning')}</PlaintextWarning>
          <Snippet
            label={t('mcp.connect.desktop.fallbackConfig')}
            text={buildDesktopConfig(mcp.uri, apiKey ?? KEY_PLACEHOLDER)}
          />
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
            {DESKTOP_CONFIG_PATHS.map(([os, path]) => (
              <div key={os} className="contents">
                <dt className="text-muted-foreground">{os}</dt>
                <dd className="truncate font-mono" title={path}>
                  {path}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground text-xs">
            {t('mcp.connect.desktop.fallbackRestart')}
          </p>
        </div>
      </details>
    </div>
  );
};

DesktopSetup.displayName = DESKTOP_SETUP_NAME;

const CODE_SETUP_NAME = 'CodeSetup';

const CodeSetup = ({ mcp, apiKey }: SetupProps): ReactElement => {
  const { t } = useTranslation();

  return (
    <div data-component={CODE_SETUP_NAME} className="flex flex-col gap-5">
      <Instructions>
        <Instruction title={t('mcp.connect.code.token', { env: TOKEN_ENV })}>
          <Snippet label={t('mcp.connect.shell')} text={buildReadToken()} />
          <CopyFields>
            <KeyField apiKey={apiKey} />
          </CopyFields>
        </Instruction>
        <Instruction title={t('mcp.connect.code.add')}>
          <Snippet label={t('mcp.connect.shell')} text={buildClaudeCommand(mcp.uri)} />
        </Instruction>
      </Instructions>

      <Snippet
        label={t('mcp.connect.code.mcpJson', { env: TOKEN_ENV })}
        text={buildMcpJson(mcp.uri)}
      />
      <p className="text-muted-foreground text-xs">{t('mcp.connect.code.cards')}</p>
    </div>
  );
};

CodeSetup.displayName = CODE_SETUP_NAME;

// `off`: no sign-in at all. `blocked`: sign-in is on, but `oauth.redirectUris` refuses ChatGPT.
type ChatGptOauth = 'ready' | 'blocked' | 'off';

function chatGptOauth({ enabled, chatgpt }: GriegConfig['mcp']['oauth']): ChatGptOauth {
  if (!enabled) return 'off';
  return chatgpt ? 'ready' : 'blocked';
}

const SIGN_IN_STATUS = {
  ready: {
    Icon: ShieldCheck,
    tone: 'border-success/40 bg-success/10',
    iconTone: 'text-success',
    title: 'mcp.connect.chatgpt.oauthOn',
    detail: 'mcp.connect.chatgpt.oauthOnDetail',
  },
  blocked: {
    Icon: TriangleAlert,
    tone: 'border-warning/40 bg-warning/10',
    iconTone: 'text-warning',
    title: 'mcp.connect.chatgpt.oauthBlocked',
    detail: 'mcp.connect.chatgpt.oauthBlockedDetail',
  },
  off: {
    Icon: Info,
    tone: 'bg-muted/40',
    iconTone: 'text-muted-foreground',
    title: 'mcp.connect.chatgpt.oauthOff',
    detail: 'mcp.connect.chatgpt.oauthOffDetail',
  },
} as const;

const CHATGPT_SIGN_IN_NAME = 'ChatGptSignIn';

type ChatGptSignInProps = {
  status: ChatGptOauth;
  redirectUris: string[];
};

const ChatGptSignIn = ({ status, redirectUris }: ChatGptSignInProps): ReactElement => {
  const { t } = useTranslation();
  const { Icon, tone, iconTone, title, detail } = SIGN_IN_STATUS[status];

  return (
    <div
      data-component={CHATGPT_SIGN_IN_NAME}
      data-status={status}
      className={cn('flex items-start gap-2.5 rounded-md border p-3', tone)}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', iconTone)} />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{t(title)}</p>
        <p className="text-muted-foreground text-xs">
          {t(detail)}
          {status === 'off' && (
            <>
              {' '}
              <ReadmeLink anchor="oauth-sign-in" label={t('mcp.connect.readmeOauth')}>
                {t('mcp.connect.readme')}
              </ReadmeLink>
            </>
          )}
        </p>
        {status !== 'off' && (
          <div className="flex flex-col gap-1 pt-1">
            <p className="text-muted-foreground text-xs">{t('mcp.connect.chatgpt.redirectUris')}</p>
            <ul className="flex flex-col gap-0.5">
              {redirectUris.map((uri) => (
                <li key={uri} className="font-mono text-xs break-all">
                  {uri}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

ChatGptSignIn.displayName = CHATGPT_SIGN_IN_NAME;

const CHATGPT_SETUP_NAME = 'ChatGptSetup';

const ChatGptSetup = ({ mcp }: Pick<SetupProps, 'mcp'>): ReactElement => {
  const { t } = useTranslation();
  const status = chatGptOauth(mcp.oauth);
  const ready = status === 'ready';

  return (
    <div data-component={CHATGPT_SETUP_NAME} className="flex flex-col gap-5">
      <ChatGptSignIn status={status} redirectUris={mcp.oauth.redirectUris} />

      <Instructions>
        <Instruction title={t('mcp.connect.chatgpt.open')} />
        {ready ? (
          <>
            <Instruction title={t('mcp.connect.chatgpt.connection')}>
              <CopyFields>
                <CopyField label={t('mcp.connect.field.endpoint')} value={mcp.uri} />
              </CopyFields>
            </Instruction>
            <Instruction title={t('mcp.connect.chatgpt.auth')} />
            <Instruction title={t('mcp.connect.chatgpt.create')} />
            <Instruction title={t('mcp.connect.chatgpt.signIn')} />
          </>
        ) : (
          <>
            <Instruction title={t('mcp.connect.chatgpt.connectionTunnel')} />
            <Instruction title={t('mcp.connect.chatgpt.authTunnel')} />
            <Instruction title={t('mcp.connect.chatgpt.create')} />
          </>
        )}
        <Instruction title={t('mcp.connect.chatgpt.chat')} />
      </Instructions>

      {!ready && (
        <p className="text-muted-foreground text-xs">
          {t('mcp.connect.chatgpt.tunnel')}{' '}
          <ReadmeLink anchor="chatgpt" label={t('mcp.connect.readmeTunnel')}>
            {t('mcp.connect.readme')}
          </ReadmeLink>
        </p>
      )}
      <p className="text-muted-foreground text-xs">{t('mcp.connect.chatgpt.plans')}</p>
    </div>
  );
};

ChatGptSetup.displayName = CHATGPT_SETUP_NAME;

const OTHER_SETUP_NAME = 'OtherSetup';

const OtherSetup = ({ mcp, apiKey }: SetupProps): ReactElement => {
  const { t } = useTranslation();
  const key = apiKey ?? KEY_PLACEHOLDER;

  return (
    <div data-component={OTHER_SETUP_NAME} className="flex flex-col gap-5">
      <PlaintextWarning>{t('mcp.connect.other.warning')}</PlaintextWarning>
      <Snippet label={t('mcp.connect.other.http')} text={buildHttpConfig(mcp.uri, key)} />
      <Snippet label={t('mcp.connect.other.vscode')} text={buildVsCodeConfig(mcp.uri, key)} />
      <Snippet label={t('mcp.connect.other.stdio')} text={buildStdioConfig(mcp.uri, key)} />
      <Snippet
        label={t('mcp.connect.other.curl', { env: TOKEN_ENV })}
        text={buildCurlCheck(mcp.uri)}
      />
      <p className="text-muted-foreground text-xs">
        {t('mcp.connect.other.more')}{' '}
        <ReadmeLink anchor="mcp">{t('mcp.connect.readme')}</ReadmeLink>
      </p>
    </div>
  );
};

OtherSetup.displayName = OTHER_SETUP_NAME;

export type ClientSetupCardProps = SetupProps & {
  done: boolean;
};

const CLIENT_SETUP_CARD_NAME = 'ClientSetupCard';

export const ClientSetupCard = ({ mcp, apiKey, done }: ClientSetupCardProps): ReactElement => {
  const { t } = useTranslation();

  return (
    <StepCard
      name={CLIENT_SETUP_CARD_NAME}
      step={2}
      title={t('mcp.connect.title')}
      description={t(apiKey == null ? 'mcp.connect.description' : 'mcp.connect.descriptionKey')}
      done={done}
    >
      <Tabs defaultValue="desktop" className="flex flex-col gap-5">
        <TabsList className="self-start">
          <TabsTrigger value="desktop">
            <AppWindow />
            {t('mcp.connect.tab.desktop')}
          </TabsTrigger>
          <TabsTrigger value="code">
            <SquareTerminal />
            {t('mcp.connect.tab.code')}
          </TabsTrigger>
          <TabsTrigger value="chatgpt">
            <MessagesSquare />
            {t('mcp.connect.tab.chatgpt')}
          </TabsTrigger>
          <TabsTrigger value="other">
            <Plug />
            {t('mcp.connect.tab.other')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="desktop">
          <DesktopSetup mcp={mcp} apiKey={apiKey} />
        </TabsContent>
        <TabsContent value="code">
          <CodeSetup mcp={mcp} apiKey={apiKey} />
        </TabsContent>
        <TabsContent value="chatgpt">
          <ChatGptSetup mcp={mcp} />
        </TabsContent>
        <TabsContent value="other">
          <OtherSetup mcp={mcp} apiKey={apiKey} />
        </TabsContent>
      </Tabs>
    </StepCard>
  );
};

ClientSetupCard.displayName = CLIENT_SETUP_CARD_NAME;
