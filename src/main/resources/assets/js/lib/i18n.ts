import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { getConfig } from './config';

const FALLBACK_LOCALE = 'en';

const config = getConfig();

void i18n.use(initReactI18next).init({
  lng: config.locale,
  fallbackLng: FALLBACK_LOCALE,
  resources: {
    [config.locale]: { translation: config.phrases },
  },
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
