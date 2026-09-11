type UserConfig = {
  key: string;
  displayName: string;
};

export type GriegConfig = {
  appId: string;
  assetsUri: string;
  toolUri: string;
  apiUris: {
    system: string;
    workflows: string;
    crons: string;
  };
  launcherUri: string;
  user: UserConfig | null;
  locale: string;
  phrases: Record<string, string>;
};

const CONFIG_ELEMENT_ID = 'grieg-config';

function readConfig(): GriegConfig {
  const element = document.getElementById(CONFIG_ELEMENT_ID);
  if (!element) {
    throw new Error(`Config element #${CONFIG_ELEMENT_ID} not found`);
  }

  const text = element.textContent;
  if (!text) {
    throw new Error(`Config element #${CONFIG_ELEMENT_ID} is empty`);
  }

  return JSON.parse(text) as GriegConfig;
}

let cached: GriegConfig | undefined;

export function getConfig(): GriegConfig {
  if (cached == null) {
    cached = readConfig();
  }
  return cached;
}
