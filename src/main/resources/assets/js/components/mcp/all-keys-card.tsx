import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApiError } from '../../types/api';
import type { ReactElement } from 'react';

import { allKeysQueryOptions, KEYS_QUERY_KEY, revokeKey } from '../../lib/api/keys';
import { getExpiry } from '../../lib/expiry';
import { date, dateTime } from '../../lib/format';
import { PageError, PageSkeleton } from '../page';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

const ALL_KEYS_CARD_NAME = 'AllKeysCard';

export const AllKeysCard = (): ReactElement => {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery(allKeysQueryOptions());
  const [owner, setOwner] = useState<string | null>(null);

  const revoke = useMutation({
    mutationFn: revokeKey,
    // Settles by refetching, so a key already revoked elsewhere (404) leaves the list too.
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEYS_QUERY_KEY }),
  });

  const closeConfirm = (): void => setOwner(null);

  const renderBody = (): ReactElement => {
    if (isPending) return <PageSkeleton />;
    if (error != null) return <PageError message={t('common.state.error')} />;
    if (data.length === 0) {
      return <p className="text-muted-foreground px-5 pb-5 text-sm">{t('mcp.all.empty')}</p>;
    }

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('mcp.all.column.owner')}</TableHead>
            <TableHead>{t('mcp.key.field.key')}</TableHead>
            <TableHead>{t('mcp.key.field.created')}</TableHead>
            <TableHead>{t('mcp.key.field.expires')}</TableHead>
            <TableHead>{t('mcp.key.field.lastUsed')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('mcp.all.column.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((key) => (
            <TableRow key={key.owner}>
              <TableCell>{key.owner}</TableCell>
              <TableCell className="font-mono">{key.display}</TableCell>
              <TableCell>{date(key.created, i18n.language)}</TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1.5">
                  {date(key.expires, i18n.language)}
                  {getExpiry(key.expires).expired && (
                    <Badge variant="outline">{t('mcp.all.expired')}</Badge>
                  )}
                </span>
              </TableCell>
              <TableCell>
                {key.lastUsed != null ? dateTime(key.lastUsed, i18n.language) : '-'}
              </TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant="ghost" onClick={() => setOwner(key.owner)}>
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
    <Card data-component={ALL_KEYS_CARD_NAME}>
      <CardHeader className="p-5">
        <CardTitle className="text-sm">{t('mcp.all.title')}</CardTitle>
        <CardDescription className="text-xs">{t('mcp.all.description')}</CardDescription>
      </CardHeader>
      {renderBody()}
      {revokeError != null && (
        <p role="alert" className="text-destructive px-5 pb-5 text-xs">
          {revokeError}
        </p>
      )}

      {owner != null && (
        <ConfirmDialog
          title={t('mcp.confirm.revoke.title')}
          description={t('mcp.confirm.revoke.description', { owner })}
          confirmLabel={t('mcp.action.revoke')}
          pending={revoke.isPending}
          onConfirm={() => revoke.mutate(owner, { onSettled: closeConfirm })}
          onCancel={closeConfirm}
        />
      )}
    </Card>
  );
};

AllKeysCard.displayName = ALL_KEYS_CARD_NAME;
