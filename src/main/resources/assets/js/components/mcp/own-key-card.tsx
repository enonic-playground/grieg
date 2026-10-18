import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { KeyInfo } from '../../lib/api/keys';
import type { ApiError } from '../../types/api';
import type { OwnKey } from './use-own-key';
import type { ReactElement } from 'react';

import { formatDate, formatDateTime, getExpiry } from '../../lib/expiry';
import { cn } from '../../lib/utils';
import { PageError, PageSkeleton } from '../page';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { KeyReveal } from './key-reveal';
import { StepCard } from './step-card';

type PendingConfirm = 'regenerate' | 'delete' | null;

function errorMessage(error: unknown): string | undefined {
  return (error as ApiError | null)?.message;
}

type KeyDetailsProps = {
  info: KeyInfo;
};

const KeyDetails = ({ info }: KeyDetailsProps): ReactElement => {
  const { t, i18n } = useTranslation();
  const { daysLeft, soon } = getExpiry(info.expires);

  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-xs">
      <dt className="text-muted-foreground">{t('mcp.key.field.key')}</dt>
      <dd className="font-mono">{info.display}</dd>
      <dt className="text-muted-foreground">{t('mcp.key.field.created')}</dt>
      <dd>{formatDate(info.created, i18n.language)}</dd>
      <dt className="text-muted-foreground">{t('mcp.key.field.expires')}</dt>
      <dd>
        {formatDate(info.expires, i18n.language)}{' '}
        <span
          data-soon={soon || undefined}
          className={cn(soon ? 'text-warning font-semibold' : 'text-muted-foreground')}
        >
          ({t('mcp.key.daysLeft', { count: daysLeft })})
        </span>
      </dd>
      <dt className="text-muted-foreground">{t('mcp.key.field.lastUsed')}</dt>
      <dd>
        {info.lastUsed != null ? formatDateTime(info.lastUsed, i18n.language) : t('mcp.key.never')}
      </dd>
    </dl>
  );
};

export type OwnKeyCardProps = {
  ownKey: OwnKey;
};

const OWN_KEY_CARD_NAME = 'OwnKeyCard';

export const OwnKeyCard = ({ ownKey }: OwnKeyCardProps): ReactElement => {
  const { t, i18n } = useTranslation();
  const { query, generate, remove, revealed } = ownKey;
  const { data, isPending, error } = query;
  const [confirm, setConfirm] = useState<PendingConfirm>(null);

  const closeConfirm = (): void => setConfirm(null);

  // One error line serves both actions, so starting one clears the other's.
  const runGenerate = (): void => {
    remove.reset();
    generate.mutate(undefined, { onSettled: closeConfirm });
  };

  const runDelete = (): void => {
    generate.reset();
    remove.mutate(undefined, { onSettled: closeConfirm });
  };

  const renderBody = (): ReactElement => {
    if (isPending) return <PageSkeleton />;
    if (error != null) return <PageError message={t('common.state.error')} />;

    if (revealed != null) return <KeyReveal apiKey={revealed} onDone={generate.reset} />;

    const generateButton = (
      <Button variant="primary" onClick={runGenerate} disabled={generate.isPending}>
        {t('mcp.action.generate')}
      </Button>
    );

    if (data == null) {
      return (
        <div className="flex flex-col items-start gap-3">
          <p className="text-muted-foreground text-sm">{t('mcp.key.none')}</p>
          {generateButton}
        </div>
      );
    }

    if (getExpiry(data.expires).expired) {
      return (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm">
            {t('mcp.key.expired', { date: formatDate(data.expires, i18n.language) })}
          </p>
          {generateButton}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        <KeyDetails info={data} />
        <div className="flex gap-2">
          <Button onClick={() => setConfirm('regenerate')}>{t('mcp.action.regenerate')}</Button>
          <Button variant="destructive" onClick={() => setConfirm('delete')}>
            {t('common.action.delete')}
          </Button>
        </div>
      </div>
    );
  };

  const mutationError = errorMessage(generate.error) ?? errorMessage(remove.error);

  const hasKey = data != null && !getExpiry(data.expires).expired;

  return (
    <StepCard
      name={OWN_KEY_CARD_NAME}
      step={1}
      title={t('mcp.key.title')}
      description={t('mcp.key.description')}
      done={hasKey}
    >
      {renderBody()}
      {mutationError != null && (
        <p role="alert" className="text-destructive text-xs">
          {mutationError}
        </p>
      )}

      {confirm != null && (
        <ConfirmDialog
          title={t(
            confirm === 'delete' ? 'mcp.confirm.delete.title' : 'mcp.confirm.regenerate.title',
          )}
          description={t('mcp.confirm.ownKey')}
          confirmLabel={t(confirm === 'delete' ? 'common.action.delete' : 'mcp.action.regenerate')}
          pending={generate.isPending || remove.isPending}
          onConfirm={confirm === 'delete' ? runDelete : runGenerate}
          onCancel={closeConfirm}
        />
      )}
    </StepCard>
  );
};

OwnKeyCard.displayName = OWN_KEY_CARD_NAME;
