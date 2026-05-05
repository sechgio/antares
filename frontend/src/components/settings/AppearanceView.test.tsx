import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../i18n';
import AppearanceView from './AppearanceView';
import { ToastProvider } from '../../hooks/useToast';

const baseTheme = {
  name: 'Precision Linear',
  bg: '#0A0D12',
  bg_secondary: '#111522',
  fg: '#FFFFFF',
  fg_muted: '#7C8494',
  fg_secondary: '#555555',
  fg_tertiary: '#565656',
  accent: '#5E6AD2',
  accent_light: '#8B93FF',
  accent_hover: '#4D57BE',
  accent_dark: '#343B8F',
  border: '#27304E',
  blue_hover: '#22C7A9',
  error: '#EB001B',
  warning: '#F79E1B',
  success: '#76b900',
  orange: '#8B93FF',
};

const lightTheme = {
  ...baseTheme,
  name: 'Professional Light',
  bg: '#F6F7FB',
  bg_secondary: '#FFFFFF',
  fg: '#111827',
  fg_muted: '#6B7280',
  accent: '#2563EB',
  accent_light: '#60A5FA',
  accent_hover: '#1D4ED8',
};

function renderAppearance() {
  return render(
    <ToastProvider>
      <AppearanceView />
    </ToastProvider>,
  );
}

describe('AppearanceView', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
    delete document.documentElement.dataset.pointerCursors;
    delete document.documentElement.dataset.sidebarTranslucent;
  });

  it('shows a minimal Codex-like appearance panel and applies a selected style', async () => {
    window.electronAPI = {
      invoke: async (method: string, params?: Record<string, unknown>) => {
        if (method === 'theme_get') return baseTheme;
        if (method === 'theme_presets') return { presets: ['Precision Linear', 'Professional Light'] };
        if (method === 'theme_preset' && params?.name === 'Professional Light') return lightTheme;
        return {};
      },
      onNotify: () => () => {},
      onUpdateAvailable: () => () => {},
      onUpdateDownloaded: () => () => {},
    };

    renderAppearance();

    expect(await screen.findByRole('heading', { name: 'Aspecto' })).toBeInTheDocument();
    expect(screen.getByText('Usa claro, oscuro o el tema del sistema')).toBeInTheDocument();
    expect(screen.getAllByText('themePreview').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Codex/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Codex/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Professional Light/i }));

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--bg-base')).toBe('#F6F7FB');
      expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('#2563EB');
    });
  });

  it('keeps the active cached theme when opening appearance settings', async () => {
    const activeTheme = {
      ...baseTheme,
      name: 'Imported Focus',
      bg: '#101826',
      bg_secondary: '#172033',
      fg: '#F8FAFC',
      fg_muted: '#CBD5E1',
      accent: '#14B8A6',
      accent_light: '#5EEAD4',
      accent_hover: '#0F766E',
      accent_dark: '#115E59',
    };

    localStorage.setItem('hc_theme_active_cache', JSON.stringify(activeTheme));
    localStorage.setItem('hc_theme_css_cache', JSON.stringify({
      '--bg-base': activeTheme.bg,
      '--accent-primary': activeTheme.accent,
    }));
    document.documentElement.style.setProperty('--bg-base', activeTheme.bg);
    document.documentElement.style.setProperty('--accent-primary', activeTheme.accent);

    window.electronAPI = {
      invoke: async (method: string) => {
        if (method === 'theme_get') return baseTheme;
        if (method === 'theme_presets') return { presets: ['Precision Linear'] };
        return {};
      },
      onNotify: () => () => {},
      onUpdateAvailable: () => () => {},
      onUpdateDownloaded: () => () => {},
    };

    renderAppearance();

    expect(await screen.findByRole('heading', { name: 'Aspecto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Imported Focus/i })).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue('--bg-base')).toBe('#101826');
    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('#14B8A6');
  });

  it('centers the settings workspace without constraining appearance to a narrow column', async () => {
    window.electronAPI = {
      invoke: async (method: string) => {
        if (method === 'theme_get') return baseTheme;
        if (method === 'theme_presets') return { presets: ['Precision Linear', 'Professional Light'] };
        return {};
      },
      onNotify: () => () => {},
      onUpdateAvailable: () => () => {},
      onUpdateDownloaded: () => () => {},
    };

    renderAppearance();

    const root = await screen.findByTestId('appearance-view');
    const workspace = screen.getByTestId('appearance-workspace');

    expect(root).toHaveClass('h-full');
    expect(root).toHaveClass('overflow-auto');
    expect(workspace).toHaveClass('min-h-0');
    expect(workspace).toHaveClass('mx-auto');
    expect(workspace).toHaveClass('w-full');
    expect(workspace).toHaveClass('max-w-[760px]');
  });

  it('imports a theme JSON and applies it to the live interface', async () => {
    window.electronAPI = {
      invoke: async (method: string) => {
        if (method === 'theme_get') return baseTheme;
        if (method === 'theme_presets') return { presets: ['Precision Linear'] };
        return {};
      },
      onNotify: () => () => {},
      onUpdateAvailable: () => () => {},
      onUpdateDownloaded: () => () => {},
    };

    renderAppearance();

    const importedTheme = {
      ...baseTheme,
      name: 'Imported Focus',
      bg: '#101826',
      bg_secondary: '#172033',
      fg: '#F8FAFC',
      fg_muted: '#CBD5E1',
      accent: '#14B8A6',
      accent_light: '#5EEAD4',
      accent_hover: '#0F766E',
      accent_dark: '#115E59',
      pointer_cursors: 'true',
      sidebar_translucent: 'true',
      contrast: '72',
      interface_font_size: '14',
      code_font_size: '13',
    };
    const file = new File([JSON.stringify(importedTheme)], 'theme.json', { type: 'application/json' });

    const input = await screen.findByLabelText('Importar tema');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--bg-base')).toBe('#101826');
      expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('#14B8A6');
      expect(document.documentElement.dataset.pointerCursors).toBe('true');
      expect(screen.getByLabelText('Contraste')).toHaveValue('72');
      expect(screen.getByLabelText('Tamano de fuente de la interfaz')).toHaveValue(14);
      expect(screen.getByLabelText('Tamano de fuente del codigo')).toHaveValue(13);
    });
  });

  it('applies complete interface variables when selecting an expressive preset', async () => {
    const neonTheme = {
      ...baseTheme,
      name: 'Neon Grid',
      bg: '#070713',
      bg_secondary: '#111126',
      fg: '#F8FAFC',
      fg_muted: '#A5B4FC',
      fg_secondary: '#C4B5FD',
      fg_tertiary: '#818CF8',
      accent: '#22D3EE',
      accent_light: '#67E8F9',
      accent_hover: '#A855F7',
      accent_dark: '#0891B2',
      border: '#312E81',
      blue_hover: '#F472B6',
      error: '#FF4D8D',
      warning: '#FACC15',
      success: '#34D399',
      orange: '#A855F7',
    };

    window.electronAPI = {
      invoke: async (method: string, params?: Record<string, unknown>) => {
        if (method === 'theme_get') return baseTheme;
        if (method === 'theme_presets') return { presets: ['Precision Linear', 'Neon Grid'] };
        if (method === 'theme_preset' && params?.name === 'Neon Grid') return neonTheme;
        return {};
      },
      onNotify: () => () => {},
      onUpdateAvailable: () => () => {},
      onUpdateDownloaded: () => () => {},
    };

    renderAppearance();

    fireEvent.click(await screen.findByRole('button', { name: /Codex/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Neon Grid/i }));

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--bg-base')).toBe('#070713');
      expect(document.documentElement.style.getPropertyValue('--bg-surface')).toBe('#111126');
      expect(document.documentElement.style.getPropertyValue('--bg-elevated')).toBeTruthy();
      expect(document.documentElement.style.getPropertyValue('--bg-input')).toBeTruthy();
      expect(document.documentElement.style.getPropertyValue('--text-tertiary')).toBe('#818CF8');
      expect(document.documentElement.style.getPropertyValue('--border-medium')).toBeTruthy();
      expect(document.documentElement.style.getPropertyValue('--scrollbar-thumb')).toBeTruthy();
      expect(document.documentElement.style.getPropertyValue('--selection-bg')).toBeTruthy();
      expect(document.documentElement.style.getPropertyValue('--mc-canvas')).toBe('#070713');
      expect(document.documentElement.style.getPropertyValue('--mc-lifted')).toBeTruthy();
      expect(document.documentElement.style.getPropertyValue('--accent-red')).toBe('#FF4D8D');
      expect(document.documentElement.style.getPropertyValue('--accent-yellow')).toBe('#FACC15');
      expect(document.documentElement.style.getPropertyValue('--accent-green')).toBe('#34D399');
    });
  });

  it('advanced color edits update the live theme before saving', async () => {
    window.electronAPI = {
      invoke: async (method: string) => {
        if (method === 'theme_get') return baseTheme;
        if (method === 'theme_presets') return { presets: ['Precision Linear'] };
        return {};
      },
      onNotify: () => () => {},
      onUpdateAvailable: () => () => {},
      onUpdateDownloaded: () => () => {},
    };

    renderAppearance();

    const backgroundInput = await screen.findByLabelText('Fondo');
    fireEvent.change(backgroundInput, { target: { value: '#123456' } });

    expect(document.documentElement.style.getPropertyValue('--bg-base')).toBe('#123456');
  });

  it('repairs unreadable primary text when a theme has poor contrast', async () => {
    const unreadableTheme = {
      ...baseTheme,
      bg: '#FFFFFF',
      bg_secondary: '#FFFFFF',
      fg: '#FFFFFF',
      fg_muted: '#F7F7F7',
    };

    window.electronAPI = {
      invoke: async (method: string) => {
        if (method === 'theme_get') return unreadableTheme;
        if (method === 'theme_presets') return { presets: ['Unreadable Custom'] };
        return {};
      },
      onNotify: () => () => {},
      onUpdateAvailable: () => () => {},
      onUpdateDownloaded: () => () => {},
    };

    renderAppearance();

    await screen.findByRole('heading', { name: 'Aspecto' });

    expect(document.documentElement.style.getPropertyValue('--text-primary')).toBe('#111827');
    expect(document.documentElement.style.getPropertyValue('--text-secondary')).toBe('#475467');
  });

  it('uses dark text on light accent colors', async () => {
    window.electronAPI = {
      invoke: async (method: string) => {
        if (method === 'theme_get') return baseTheme;
        if (method === 'theme_presets') return { presets: ['Precision Linear'] };
        return {};
      },
      onNotify: () => () => {},
      onUpdateAvailable: () => () => {},
      onUpdateDownloaded: () => () => {},
    };

    renderAppearance();

    fireEvent.change(await screen.findByLabelText('Acento'), { target: { value: '#F59E0B' } });

    expect(document.documentElement.style.getPropertyValue('--text-on-accent')).toBe('#111827');
  });

  it('preserves the selected preset accent after a manual accent shortcut was used', async () => {
    const neonTheme = {
      ...baseTheme,
      name: 'Neon Grid',
      bg: '#070713',
      bg_secondary: '#111126',
      fg: '#F8FAFC',
      fg_muted: '#A5B4FC',
      fg_secondary: '#C4B5FD',
      fg_tertiary: '#818CF8',
      accent: '#22D3EE',
      accent_light: '#67E8F9',
      accent_hover: '#A855F7',
      accent_dark: '#0891B2',
      border: '#312E81',
      blue_hover: '#F472B6',
      error: '#FF4D8D',
      warning: '#FACC15',
      success: '#34D399',
      orange: '#A855F7',
    };

    window.electronAPI = {
      invoke: async (method: string, params?: Record<string, unknown>) => {
        if (method === 'theme_get') return baseTheme;
        if (method === 'theme_presets') return { presets: ['Precision Linear', 'Neon Grid'] };
        if (method === 'theme_preset' && params?.name === 'Neon Grid') return neonTheme;
        return {};
      },
      onNotify: () => () => {},
      onUpdateAvailable: () => () => {},
      onUpdateDownloaded: () => () => {},
    };

    renderAppearance();

    fireEvent.change(await screen.findByLabelText('Acento'), { target: { value: '#F59E0B' } });
    fireEvent.click(await screen.findByRole('button', { name: /Codex/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Neon Grid/i }));

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('#22D3EE');
      expect(document.documentElement.style.getPropertyValue('--accent-primary-hover')).toBe('#67E8F9');
    });
  });
});
