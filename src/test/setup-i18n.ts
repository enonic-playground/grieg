import i18next from 'i18next';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initReactI18next } from 'react-i18next';

const here = dirname(fileURLToPath(import.meta.url));
const appPropertiesPath = resolve(here, '../main/resources/i18n/app.properties');

function parseProperties(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

const phrases = parseProperties(readFileSync(appPropertiesPath, 'utf8'));

void i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { translation: phrases } },
  interpolation: { escapeValue: false },
  returnNull: false,
});
