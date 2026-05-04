import '@testing-library/jest-dom';

// Mock electronAPI for tests
Object.defineProperty(window, 'electronAPI', {
  value: {
    invoke: async (_method: string, _params?: Record<string, unknown>) => {
      if (_method === 'version') return { version: '0.2.2' };
      if (_method === 'formats') return { formats: ['JPEG', 'PNG', 'WEBP'] };
      if (_method === 'db_records') return { records: [], fields: ['codigo'] };
      if (_method === 'db_fields') return { fields: [{ name: 'codigo', type: 'string', required: true, unique: false }] };
      if (_method === 'theme_get') return {
        name: 'Precision Linear', bg: '#0A0D12', bg_secondary: '#111522',
        fg: '#FFFFFF', fg_muted: '#7C8494', accent: '#5E6AD2',
        accent_light: '#8B93FF', accent_hover: '#4D57BE',
        accent_dark: '#343B8F', border: '#27304E', blue_hover: '#22C7A9',
        error: '#EB001B', warning: '#F79E1B', success: '#76b900', orange: '#8B93FF'
      };
      if (_method === 'theme_presets') return { presets: ['Precision Linear'] };
      return {};
    },
    onNotify: () => () => {},
    onUpdateAvailable: () => () => {},
    onUpdateDownloaded: () => () => {},
    minimizeWindow: async () => ({}),
    maximizeWindow: async () => ({}),
    closeWindow: async () => ({}),
    showAppMenu: async () => ({}),
  },
  writable: true,
});
