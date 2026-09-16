export const TAB_DEFINITIONS = [
  { id: 'espacios', label: 'Espacios', fullBleed: true },
  { id: 'convert', label: 'Conversión', fullBleed: false },
  { id: 'formatos', label: 'Formatos PDF', fullBleed: true },
  { id: 'sellador', label: 'Sellador', fullBleed: true },
  { id: 'padron', label: 'Generar Padrones', fullBleed: true },
  { id: 'volantes', label: 'Generar Volantes', fullBleed: true },
  { id: 'reportesCampo', label: 'Reportes de Campo', fullBleed: true },
  { id: 'technicalReports', label: 'Informes técnicos', fullBleed: true },
  { id: 'informesV2', label: 'Informes v2', fullBleed: true },
  { id: 'imageOptimizer', label: 'Optimizador', fullBleed: true },
  { id: 'previewPanel', label: 'Generador Reportes', fullBleed: true },
  { id: 'canvas', label: 'Canvas', fullBleed: true },
  { id: 'panelAvisoCorte', label: 'Aviso de Corte', fullBleed: true },
  { id: 'ubicaciones', label: 'Ubicaciones', fullBleed: true },
  { id: 'evidenciaVolanteo', label: 'Evidencia Volanteo', fullBleed: true },
  { id: 'autoimg', label: 'AutoIMG', fullBleed: true },
  { id: 'fichasTecnicas', label: 'Fichas Técnicas', fullBleed: true },
] as const;

export type TabId = (typeof TAB_DEFINITIONS)[number]['id'];

export const DEFAULT_TAB: TabId = 'previewPanel';

export const FULL_BLEED_TABS = new Set<TabId>(
  TAB_DEFINITIONS.filter((tab) => tab.fullBleed).map((tab) => tab.id),
);

export type ConfigSectionId = 'appearance' | 'history' | 'panel' | 'petdex';

export interface ConfigSectionDefinition {
  id: ConfigSectionId;
  label: string;
}

export const CONFIG_SECTION_DEFINITIONS: readonly ConfigSectionDefinition[] = [
  { id: 'appearance', label: 'Apariencia' },
  { id: 'history', label: 'Historial' },
  { id: 'panel', label: 'Panel' },
  { id: 'petdex', label: 'Petdex' },
] as const;
