import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GrantInfo, GrantScope } from '../../lib/api/grants';
import type { ApiError } from '../../types/api';
import type { ReactElement } from 'react';

import { GRANTS_QUERY_KEY, grantsQueryOptions, revokeGrant } from '../../lib/api/grants';
import { getExpiry } from '../../lib/expiry';
import { date } from '../../lib/format';
import { PageError, PageSkeleton } from '../page';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { RelativeTime } from '../ui/relative-time';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

const COPY = {
  own: {
    title: 'mcp.grants.title',
    description: 'mcp.grants.description',
    empty: 'mcp.grants.empty',
    confirm: 'mcp.confirm.revokeGrant.own',
  },
  all: {
    title: 'mcp.grants.all.title',
    description: 'mcp.grants.all.description',
    empty: 'mcp.grants.all.empty',
    confirm: 'mcp.confirm.revokeGrant.all',
  },
} as const;

export type GrantsCardProps = {
  scope: GrantScope;
  // While OAuth sign-in is off, an empty list says nothing worth a card.
  hideWhenEmpty?: boolean;
};

const GRANTS_CARD_NAME = 'GrantsCard';

export const GrantsCard = ({
  scope,
  hideWhenEmpty = false,
}: GrantsCardProps): ReactElement | null => {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery(grantsQueryOptions(scope));
  const [target, setTarget] = useState<GrantInfo | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Set once a revoke settles with its row gone, so the dialog cannot hand focus back to it.
  const rowGone = useRef(false);
  const copy = COPY[scope];

  const revoke = useMutation({
    mutationFn: revokeGrant,
    onSuccess: (_data, grant) => setAnnouncement(t('mcp.grants.revoked', grant)),
    // Settles by refetching both lists, so a grant already revoked elsewhere (404) leaves too.
    onSettled: async (_data, _error, grant) => {
      await queryClient.invalidateQueries({ queryKey: GRANTS_QUERY_KEY });
      const list = queryClient.getQueryData(grantsQueryOptions(scope).queryKey);
      rowGone.current = !list?.some((item) => item.id === grant.id);
    },
  });

  // A revoke keeps the card, so its heading can take focus and its status be read.
  const hidden =
    hideWhenEmpty && error == null && revoke.isIdle && (isPending || data.length === 0);
  if (hidden) return null;

  const openConfirm = (grant: GrantInfo): void => {
    revoke.reset();
    setTarget(grant);
  };

  const closeConfirm = (): void => setTarget(null);

  const focusAfterClose = (event: Event): void => {
    if (!rowGone.current) return;
    rowGone.current = false;
    event.preventDefault();
    titleRef.current?.focus();
  };

  const renderBody = (): ReactElement => {
    if (isPending) return <PageSkeleton />;
    if (error != null) return <PageError message={t('common.state.error')} />;
    if (data.length === 0) {
      return <p className="text-muted-foreground px-5 pb-5 text-sm">{t(copy.empty)}</p>;
    }

    return (
      <Table aria-labelledby={titleId}>
        <TableHeader>
          <TableRow>
            {scope === 'all' && <TableHead>{t('mcp.all.column.owner')}</TableHead>}
            <TableHead>{t('mcp.grants.column.app')}</TableHead>
            <TableHead>{t('mcp.grants.column.approved')}</TableHead>
            <TableHead>{t('mcp.key.field.lastUsed')}</TableHead>
            <TableHead>{t('mcp.key.field.expires')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('mcp.all.column.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((grant) => (
            <TableRow key={grant.id}>
              {scope === 'all' && <TableCell>{grant.owner}</TableCell>}
              <TableCell>
                <span className="flex flex-col">
                  <span className="font-medium">{grant.client}</span>
                  <span
                    className="text-muted-foreground max-w-56 truncate font-mono text-xs"
                    title={grant.clientId}
                  >
                    {grant.clientId}
                  </span>
                </span>
              </TableCell>
              <TableCell>
                <RelativeTime iso={grant.created} />
              </TableCell>
              <TableCell>
                {grant.lastUsed != null ? (
                  <RelativeTime iso={grant.lastUsed} />
                ) : (
                  t('mcp.key.never')
                )}
              </TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  {date(grant.expires, i18n.language)}
                  {getExpiry(grant.expires).expired && (
                    <Badge variant="outline">{t('mcp.all.expired')}</Badge>
                  )}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t(
                    grant.owner == null ? 'mcp.grants.revokeLabel' : 'mcp.grants.revokeLabelOwner',
                    grant,
                  )}
                  onClick={() => openConfirm(grant)}
                >
                  {t('mcp.action.revoke')}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };

  const revokeError = (revoke.error as ApiError | null)?.message;

  return (
    <Card data-component={GRANTS_CARD_NAME} data-scope={scope}>
      <CardHeader className="p-5">
        <CardTitle ref={titleRef} id={titleId} tabIndex={-1} className="text-sm outline-none">
          {t(copy.title)}
        </CardTitle>
        <CardDescription className="text-xs">{t(copy.description)}</CardDescription>
      </CardHeader>
      {renderBody()}
      {revokeError != null && (
        <p role="alert" className="text-destructive px-5 pb-5 text-xs">
          {revokeError}
        </p>
      )}

      <p role="status" className="sr-only">
        {announcement}
      </p>

      {target != null && (
        <ConfirmDialog
          title={t('mcp.confirm.revokeGrant.title', { client: target.client })}
          description={t(copy.confirm, target)}
          confirmLabel={t('mcp.action.revoke')}
          pending={revoke.isPending}
          onConfirm={() => revoke.mutate(target, { onSettled: closeConfirm })}
          onCancel={closeConfirm}
          onCloseAutoFocus={focusAfterClose}
        />
      )}
    </Card>
  );
};

GrantsCard.displayName = GRANTS_CARD_NAME;
