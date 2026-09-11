import { render } from '/lib/mustache';
import { extensionUrl, getToolUrl } from '/lib/xp/admin';
import { getUser } from '/lib/xp/auth';
import { getPhrases } from '/lib/xp/i18n';
import { apiUrl, assetUrl } from '/lib/xp/portal';

import type { Request, Response } from '@enonic-types/core';

const PHRASE_BUNDLE = 'i18n/app';
const DEFAULT_LOCALE = 'en';

type GriegConfig = {
  appId: string;
  assetsUri: string;
  toolUri: string;
  apiUris: {
    system: string;
    workflows: string;
    crons: string;
  };
  launcherUri: string;
  user: {
    key: string;
    displayName: string;
  } | null;
  locale: string;
  phrases: Record<string, string>;
};

function buildConfig(req: Request): GriegConfig {
  const currentUser = getUser();
  const locales = req.locales.length > 0 ? req.locales : [DEFAULT_LOCALE];
  const phrases = getPhrases(locales, [PHRASE_BUNDLE]);

  return {
    appId: app.name,
    assetsUri: assetUrl({ path: '' }),
    toolUri: getToolUrl(app.name, 'main'),
    apiUris: {
      system: apiUrl({ api: 'system', type: 'server' }),
      workflows: apiUrl({ api: 'workflows', type: 'server' }),
      crons: apiUrl({ api: 'crons', type: 'server' }),
    },
    launcherUri: extensionUrl({
      application: 'com.enonic.xp.app.main',
      extension: 'launcher',
    }),
    user: currentUser
      ? {
          key: currentUser.key,
          displayName: currentUser.displayName,
        }
      : null,
    locale: locales[0],
    phrases,
  };
}

export function get(req: Request): Response {
  const view = resolve('./main.html');
  const config = buildConfig(req);

  return {
    contentType: 'text/html',
    body: render(view, {
      assetsUri: config.assetsUri,
      config: JSON.stringify(config),
    }),
  };
}
