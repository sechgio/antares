export const TAB_DEFINITIONS = [
  { id: 'convert', label: 'Conversión', shortcut: 'Ctrl+1', shortcutKey: '1', fullBleed: false },
  { id: 'formatos', label: 'Formatos PDF', shortcut: 'Ctrl+3', shortcutKey: '3', fullBleed: true },
  { id: 'sellador', label: 'Sellador', shortcut: 'Ctrl+Shift+S', shortcutKey: 's', shortcutShift: true, fullBleed: true },
  { id: 'padron', label: 'Generar Padrones', shortcut: 'Ctrl+4', shortcutKey: '4', fullBleed: true },
  { id: 'volantes', label: 'Generar Volantes', shortcut: 'Ctrl+5', shortcutKey: '5', fullBleed: true },
  { id: 'reportesCampo', label: 'Reportes de Campo', shortcut: 'Ctrl+8', shortcutKey: '8', fullBleed: true },
  { id: 'technicalReports', label: 'Informes técnicos', shortcut: 'Ctrl+Shift+I', shortcutKey: 'i', shortcutShift: true, fullBleed: true },
  { id: 'imageOptimizer', label: 'Optimizador', commandLabel: 'Optimizador de Imágenes', shortcut: 'Ctrl+9', shortcutKey: '9', fullBleed: true },
  { id: 'previewPanel', label: 'Generador Reportes', commandLabel: 'Generador de Reportes', shortcut: 'Ctrl+0', shortcutKey: '0', fullBleed: true },
  { id: 'panelAvisoCorte', label: 'Aviso de Corte', shortcut: 'Ctrl+2', shortcutKey: '2', fullBleed: true },
  { id: 'history', label: 'Historial', shortcut: 'Ctrl+6', shortcutKey: '6', fullBleed: false },
  { id: 'appearance', label: 'Apariencia', shortcut: 'Ctrl+7', shortcutKey: '7', fullBleed: false },
] as const;

export type TabId = (typeof TAB_DEFINITIONS)[number]['id'];

export const FULL_BLEED_TABS = new Set<TabId>(
  TAB_DEFINITIONS.filter((tab) => tab.fullBleed).map((tab) => tab.id),
);
