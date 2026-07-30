import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import es from './locales/es.json';
import en from './locales/en.json';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      es: { translation: es },
      en: { translation: en },
    },
    // Explicit locale lock: no browser LanguageDetector; only es/en.
    lng: 'es',
    fallbackLng: 'es',
    supportedLngs: ['es', 'en'],
    load: 'languageOnly',
    nonExplicitSupportedLngs: false,
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
