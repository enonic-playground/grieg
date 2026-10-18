import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import type { GriegConfig } from '../lib/config';
import type { ReactElement } from 'react';

import { AllKeysCard } from '../components/mcp/all-keys-card';
import { ClientSetupCard } from '../components/mcp/client-setup-card';
import { ConnectionCard } from '../components/mcp/connection-card';
import { OwnKeyCard } from '../components/mcp/own-key-card';
import { isConnected, useOwnKey } from '../components/mcp/use-own-key';
import { Page } from '../components/page';
import { Card, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

type ConnectGuideProps = {
  mcp: GriegConfig['mcp'];
};

const ConnectGuide = ({ mcp }: ConnectGuideProps): ReactElement => {
  const ownKey = useOwnKey();
  const { connection, query, revealed } = ownKey;

  return (
    <>
      <OwnKeyCard ownKey={ownKey} />
      <ClientSetupCard mcp={mcp} apiKey={revealed} done={isConnected(connection)} />
      <ConnectionCard
        mcp={mcp}
        connection={connection}
        checking={query.isFetching}
        onCheck={() => void query.refetch()}
      />
    </>
  );
};

const MCP_PAGE_NAME = 'McpPage';

const McpPage = (): ReactElement => {
  const { t } = useTranslation();
  const { config } = Route.useRouteContext();

  return (
    <Page data-component={MCP_PAGE_NAME} className="flex max-w-5xl flex-col gap-5">
      {config.access.mcp ? (
        <ConnectGuide mcp={config.mcp} />
      ) : (
        <Card>
          <CardHeader className="p-5">
            <CardTitle className="text-sm">{t('mcp.key.title')}</CardTitle>
            <CardDescription className="text-xs">{t('mcp.key.noRole')}</CardDescription>
          </CardHeader>
        </Card>
      )}
      {config.access.admin && <AllKeysCard />}
    </Page>
  );
};

McpPage.displayName = MCP_PAGE_NAME;

export const Route = createFileRoute('/mcp')({
  component: McpPage,
});
