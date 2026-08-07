import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '../i18n';

describe('i18n lazy English bundle', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
  });

  it('keeps Spanish as the default shell language', () => {
    expect(i18n.language).toMatch(/^es/);
    expect(i18n.t('app.subtitle')).toContain('Conversor');
  });

  it('loads en.json on first changeLanguage("en")', async () => {
    // Bundle may already exist if a prior test loaded English — remove to force lazy path.
    if (i18n.hasResourceBundle('en', 'translation')) {
      i18n.removeResourceBundle('en', 'translation');
    }
    expect(i18n.hasResourceBundle('en', 'translation')).toBe(false);

    await i18n.changeLanguage('en');

    expect(i18n.hasResourceBundle('en', 'translation')).toBe(true);
    expect(i18n.language).toMatch(/^en/);
    expect(i18n.t('app.subtitle')).toBe('Professional image converter and renamer');
    expect(i18n.t('tab.convert')).toBe('Conversion');
  });

  it('does not leave raw keys after switching to English', async () => {
    await i18n.changeLanguage('en');
    const subtitle = i18n.t('app.subtitle');
    expect(subtitle).not.toBe('app.subtitle');
    expect(subtitle.length).toBeGreaterThan(0);
  });
});
