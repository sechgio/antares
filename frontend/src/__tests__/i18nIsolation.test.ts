import { describe, expect, it } from 'vitest';
import i18n from '../i18n';

describe('i18n test isolation', () => {
  it('allows a test to change the active language', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.language).toMatch(/^en/);
  });

  it('starts the next test in the default shell language', () => {
    expect(i18n.language).toMatch(/^es/);
  });
});
