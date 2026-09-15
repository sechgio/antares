import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '../i18n';

describe('i18n lazy English bundle', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
  });

  it('keeps Spanish as the default shell language', () => {
    expect(i18n.language).toMatch(/^es/);
    expect(i18n.t('history.title')).toBe('Historial');
  });

  it('loads en.json on first changeLanguage("en")', async () => {
    if (i18n.hasResourceBundle('en', 'translation')) {
      i18n.removeResourceBundle('en', 'translation');
    }
    expect(i18n.hasResourceBundle('en', 'translation')).toBe(false);

    await i18n.changeLanguage('en');

    expect(i18n.hasResourceBundle('en', 'translation')).toBe(true);
    expect(i18n.language).toMatch(/^en/);
    expect(i18n.t('history.title')).toBe('History');
    expect(i18n.t('auth.signIn')).toBe('Sign in');
  });

  it('does not leave raw keys after switching to English', async () => {
    await i18n.changeLanguage('en');
    const title = i18n.t('history.title');
    expect(title).not.toBe('history.title');
    expect(title.length).toBeGreaterThan(0);
  });
});
