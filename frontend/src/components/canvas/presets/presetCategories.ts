export type PresetCategory =
  | 'reservorios'
  | 'volanteo'
  | 'certificados'
  | 'operaciones'
  | 'general';

export const PRESET_DISTRICTS = ['SJL', 'Lurigancho', 'Chorrillos', 'Villa / SUNASS'] as const;

export type PresetDistrict = (typeof PRESET_DISTRICTS)[number];

export interface PresetMeta {
  category: PresetCategory;
  district?: PresetDistrict;
  layout: string;
  description: string;
}

export const PRESET_CATEGORY_ORDER: ReadonlyArray<PresetCategory> = [
  'reservorios',
  'volanteo',
  'certificados',
  'operaciones',
  'general',
];

export const PRESET_CATEGORY_LABELS: Record<PresetCategory, string> = {
  reservorios: 'Reservorios',
  volanteo: 'Volanteo y cortes',
  certificados: 'Certificados',
  operaciones: 'Operaciones y campo',
  general: 'General',
};

const PRESET_META: Record<string, PresetMeta> = {
  report: {
    category: 'operaciones',
    layout: 'Panel de fotos',
    description: 'Cuadrícula fotográfica con pie de imagen y datos del reporte.',
  },
  emergencias: {
    category: 'operaciones',
    layout: 'Panel de fotos',
    description: 'Registro de emergencias con evidencia fotográfica.',
  },
  'format-reservorios': {
    category: 'reservorios',
    layout: 'Tabla + fotos',
    description: 'Formato de inspección de reservorios con tabla y fotos.',
  },
  'panel-reservorios': {
    category: 'reservorios',
    layout: 'Panel + tabla',
    description: 'Panel fotográfico con datos de reservorios.',
  },
  'format-etapas': {
    category: 'general',
    layout: 'Línea de tiempo',
    description: 'Etapas de trabajo con fotos de avance.',
  },
  'cert-lugo': {
    category: 'certificados',
    layout: 'Documento',
    description: 'Certificado de saneamiento con membretado y firmas.',
  },
  'cert-sjl-blanco': {
    category: 'certificados',
    district: 'SJL',
    layout: 'Documento',
    description: 'Certificado SJL — versión en blanco.',
  },
  'cert-sjl-guardamino': {
    category: 'certificados',
    district: 'SJL',
    layout: 'Documento',
    description: 'Certificado SJL — variante Guardamino.',
  },
  'panel-aviso-corte': {
    category: 'volanteo',
    layout: 'Aviso',
    description: 'Panel de aviso de corte con zonas y fecha.',
  },
  'panel-volanteo': {
    category: 'volanteo',
    layout: 'Panel de fotos',
    description: 'Panel de evidencia fotográfica de volanteo.',
  },
  'evidencia-volanteo': {
    category: 'volanteo',
    layout: 'Fotos + datos',
    description: 'Evidencia de volanteo con fotos y observaciones.',
  },
  'maquina-balde': {
    category: 'volanteo',
    layout: 'Tabla',
    description: 'Registro de máquina balde con tabla de datos.',
  },
  'volan-maq-balde-sjl': {
    category: 'volanteo',
    district: 'SJL',
    layout: 'Panel de fotos',
    description: 'Volanteo de máquina balde — SJL.',
  },
  'aniegos-chorrillos': {
    category: 'operaciones',
    district: 'Chorrillos',
    layout: 'Panel de fotos',
    description: 'Registro de aniegos — Chorrillos.',
  },
  'reservorios-lurigancho-v2': {
    category: 'reservorios',
    district: 'Lurigancho',
    layout: 'Panel + tabla',
    description: 'Reservorios Lurigancho — versión 2.',
  },
  'reservorios-lurigancho-sgio': {
    category: 'reservorios',
    district: 'Lurigancho',
    layout: 'Panel + tabla',
    description: 'Reservorios Lurigancho — SGIO.',
  },
  'reservorios-villa-sunass': {
    category: 'reservorios',
    district: 'Villa / SUNASS',
    layout: 'Panel + tabla',
    description: 'Reservorios Villa / SUNASS.',
  },
};

export const DEFAULT_PRESET_META: PresetMeta = {
  category: 'general',
  layout: 'A4',
  description: 'Plantilla A4 lista para editar.',
};

export function presetMeta(id: string): PresetMeta {
  return PRESET_META[id] ?? DEFAULT_PRESET_META;
}
