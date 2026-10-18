import { CircleAlert, CircleCheck, Clock, KeyRound, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { GriegConfig } from '../../lib/config';
import type { Connection } from './use-own-key';
import type { ReactElement, ReactNode } from 'react';

import { formatDateTime } from '../../lib/expiry';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { CopyButton } from '../ui/copy-button';
import { StepCard } from './step-card';
import { isConnected } from './use-own-key';

type StatusProps = {
  icon: ReactNode;
  title: string;
  detail?: string;
  tone?: 'muted' | 'success';
  action?: ReactNode;
};

const Status = ({ icon, title, detail, tone = 'muted', action }: StatusProps): ReactElement => (
  <div
    role="status"
    className={cn(
      'flex items-center gap-3 rounded-md border p-3',
      tone === 'success' && 'border-success/40 bg-success/10',
    )}
  >
    {icon}
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="text-sm font-medium">{title}</span>
      {detail != null && <span className="text-muted-foreground text-xs">{detail}</span>}
    </div>
    {action}
  </div>
);

type ConnectionStatusProps = {
  connection: Connection | undefined;
  checking: boolean;
  onCheck: () => void;
};

const ConnectionStatus = ({
  connection,
  checking,
  onCheck,
}: ConnectionStatusProps): ReactElement => {
  const { t, i18n } = useTranslation();
  const mutedIcon = 'text-muted-foreground size-5 shrink-0';

  switch (connection?.state) {
    case undefined:
      return (
        <Status
          icon={<LoaderCircle className={cn(mutedIcon, 'animate-spin')} />}
          title={t('common.state.loading')}
        />
      );
    case 'error':
      return (
        <Status
          icon={<CircleAlert className="text-destructive size-5 shrink-0" />}
          title={t('common.state.error')}
          action={
            <Button size="sm" onClick={onCheck} disabled={checking}>
              {t('common.action.retry')}
            </Button>
          }
        />
      );
    case 'noKey':
      return (
        <Status
          icon={<KeyRound className={mutedIcon} />}
          title={t('mcp.check.noKey')}
          detail={t('mcp.check.noKeyDetail')}
        />
      );
    case 'waiting':
      return (
        <Status
          icon={<LoaderCircle className="text-primary size-5 shrink-0 animate-spin" />}
          title={t('mcp.check.waiting')}
          detail={t('mcp.check.waitingDetail')}
        />
      );
    case 'unused':
      return (
        <Status
          icon={<Clock className={mutedIcon} />}
          title={t('mcp.check.unused')}
          detail={t('mcp.check.unusedDetail')}
          action={
            <Button size="sm" onClick={onCheck} disabled={checking}>
              {t('mcp.check.again')}
            </Button>
          }
        />
      );
    case 'connected':
      return (
        <Status
          tone="success"
          icon={<CircleCheck className="text-success size-5 shrink-0" />}
          title={t('mcp.check.connected', { time: formatDateTime(connection.at, i18n.language) })}
          detail={t('mcp.check.connectedDetail')}
        />
      );
    case 'lastUsed':
      return (
        <Status
          icon={<Clock className={mutedIcon} />}
          title={t('mcp.check.lastUsed', { time: formatDateTime(connection.at, i18n.language) })}
          detail={t('mcp.check.lastUsedDetail')}
        />
      );
  }
};

type ServerFactsProps = {
  mcp: GriegConfig['mcp'];
};

const ServerFacts = ({ mcp }: ServerFactsProps): ReactElement => {
  const { t } = useTranslation();
  const workflows = mcp.toolsets.includes('workflows');

  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-6 gap-y-2 border-t pt-4 text-xs">
      <dt className="text-muted-foreground">{t('mcp.connect.field.endpoint')}</dt>
      <dd className="flex min-w-0 items-center gap-2">
        <code className="truncate font-mono" title={mcp.uri}>
          {mcp.uri}
        </code>
        <CopyButton text={mcp.uri} />
      </dd>
      <dt className="text-muted-foreground">{t('mcp.facts.toolsets')}</dt>
      <dd className="flex flex-wrap gap-1">
        {mcp.toolsets.length === 0
          ? t('mcp.facts.none')
          : mcp.toolsets.map((name) => (
              <Badge key={name} variant="outline">
                {name}
              </Badge>
            ))}
      </dd>
      <dt className="text-muted-foreground">{t('mcp.facts.mode')}</dt>
      <dd>{t(mcp.readOnly ? 'mcp.facts.readOnly' : 'mcp.facts.readWrite')}</dd>
      <dt className="text-muted-foreground">{t('mcp.facts.workflowTools')}</dt>
      <dd>
        {t(
          !workflows
            ? 'mcp.facts.workflowsOff'
            : mcp.workflowTools
              ? 'mcp.facts.workflowsYours'
              : 'mcp.facts.workflowsAdmins',
        )}
      </dd>
    </dl>
  );
};

export type ConnectionCardProps = ConnectionStatusProps & ServerFactsProps;

const CONNECTION_CARD_NAME = 'ConnectionCard';

export const ConnectionCard = ({ mcp, ...status }: ConnectionCardProps): ReactElement => {
  const { t } = useTranslation();

  return (
    <StepCard
      name={CONNECTION_CARD_NAME}
      step={3}
      title={t('mcp.check.title')}
      description={t('mcp.check.description')}
      done={isConnected(status.connection)}
    >
      <ConnectionStatus {...status} />
      <ServerFacts mcp={mcp} />
    </StepCard>
  );
};

ConnectionCard.displayName = CONNECTION_CARD_NAME;
