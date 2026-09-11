import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import type { SystemInfo } from '../lib/api/system';
import type { ReactElement } from 'react';

import { Page, PageError, PageSkeleton } from '../components/page';
import { Card, CardContent } from '../components/ui/card';
import { systemInfoQueryOptions } from '../lib/api/system';

type FieldKey = keyof SystemInfo;

const FIELDS: { key: FieldKey; labelKey: string }[] = [
  { key: 'xpVersion', labelKey: 'system.field.xpVersion' },
  { key: 'appName', labelKey: 'system.field.appName' },
  { key: 'appVersion', labelKey: 'system.field.appVersion' },
  { key: 'mcpEnabled', labelKey: 'system.field.mcpEnabled' },
  { key: 'mcpProject', labelKey: 'system.field.mcpProject' },
  { key: 'mcpBranch', labelKey: 'system.field.mcpBranch' },
];

const SYSTEM_PAGE_NAME = 'SystemPage';

const SystemPage = (): ReactElement => {
  const { t } = useTranslation();
  const { data, isPending, error } = useQuery(systemInfoQueryOptions());

  if (isPending) return <PageSkeleton />;
  if (error != null) return <PageError message={t('common.state.error')} />;

  return (
    <Page data-component={SYSTEM_PAGE_NAME}>
      <Card>
        <CardContent className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 p-5">
          {FIELDS.map(({ key, labelKey }) => {
            const value = data[key];
            return (
              <Fragment key={key}>
                <span className="text-muted-foreground text-xs">{t(labelKey)}</span>
                <span className="font-mono text-xs">
                  {typeof value === 'boolean'
                    ? t(value ? 'common.state.enabled' : 'common.state.disabled')
                    : value}
                </span>
              </Fragment>
            );
          })}
        </CardContent>
      </Card>
    </Page>
  );
};

SystemPage.displayName = SYSTEM_PAGE_NAME;

export const Route = createFileRoute('/system')({
  component: SystemPage,
});
