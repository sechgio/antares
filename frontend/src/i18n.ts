import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import es from './locales/es.json';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      es: { translation: es },
    },
    lng: 'es',
    fallbackLng: 'es',
    supportedLngs: ['es', 'en'],
    load: 'languageOnly',
    nonExplicitSupportedLngs: false,
    interpolation: {
      escapeValue: false,
    },
  });

async function ensureLocaleBundle(lng: string | undefined): Promise<void> {
  const code = (lng || 'es').split('-')[0];
  if (code !== 'en' || i18n.hasResourceBundle('en', 'translation')) return;
  const mod = await import('./locales/en.json');
  i18n.addResourceBundle('en', 'translation', mod.default);
}

const changeLanguage = i18n.changeLanguage.bind(i18n);
i18n.changeLanguage = async (lng, callback) => {
  await ensureLocaleBundle(typeof lng === 'string' ? lng : undefined);
  return changeLanguage(lng, callback);
};

export default i18n;
