import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { KeyInfo } from '../../lib/api/keys';
import type { ApiError } from '../../types/api';
import type { ReactElement } from 'react';

import {
  ALL_KEYS_QUERY_KEY,
  deleteOwnKey,
  KEYS_QUERY_KEY,
  generateKey,
  OWN_KEY_QUERY_KEY,
  ownKeyQueryOptions,
} from '../../lib/api/keys';
import { formatDate, formatDateTime, getExpiry } from '../../lib/expiry';
import { cn } from '../../lib/utils';
import { PageError, PageSkeleton } from '../page';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { KeyReveal } from './key-reveal';

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
  mcpUri: string;
};

const OWN_KEY_CARD_NAME = 'OwnKeyCard';

export const OwnKeyCard = ({ mcpUri }: OwnKeyCardProps): ReactElement => {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery(ownKeyQueryOptions());
  const [confirm, setConfirm] = useState<PendingConfirm>(null);

  // A fetch still in flight would overwrite what a mutation writes into the cache.
  const cancelOwnKeyFetch = (): Promise<void> =>
    queryClient.cancelQueries({ queryKey: OWN_KEY_QUERY_KEY });

  // gcTime 0 drops the plaintext from the mutation cache as soon as this card unmounts.
  const generate = useMutation({
    mutationFn: generateKey,
    gcTime: 0,
    onMutate: cancelOwnKeyFetch,
    onSuccess: ({ key: _key, ...info }) => {
      queryClient.setQueryData(OWN_KEY_QUERY_KEY, info);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ALL_KEYS_QUERY_KEY }),
  });

  // Settles by refetching, so a key already gone elsewhere (404) leaves the view too.
  const remove = useMutation({
    mutationFn: deleteOwnKey,
    onMutate: cancelOwnKeyFetch,
    onSuccess: () => {
      queryClient.setQueryData(OWN_KEY_QUERY_KEY, null);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEYS_QUERY_KEY }),
  });

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

    // The plaintext shows only while it still matches the stored key, so a key regenerated or
    // revoked elsewhere hides it.
    const generated = generate.data;
    if (
      generated != null &&
      data?.created === generated.created &&
      data.display === generated.display
    ) {
      return <KeyReveal apiKey={generated.key} mcpUri={mcpUri} onDone={generate.reset} />;
    }

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

  return (
    <Card data-component={OWN_KEY_CARD_NAME}>
      <CardHeader className="p-5">
        <CardTitle className="text-sm">{t('mcp.key.title')}</CardTitle>
        <CardDescription className="text-xs">{t('mcp.key.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-5 pt-0">
        {renderBody()}
        {mutationError != null && (
          <p role="alert" className="text-destructive text-xs">
            {mutationError}
          </p>
        )}
      </CardContent>

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
    </Card>
  );
};

OwnKeyCard.displayName = OWN_KEY_CARD_NAME;
