export const MAX_LOGO_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
export const ACCEPTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

export const MSG_LOGO_TOO_LARGE = 'El logo supera el tamaño máximo de 5 MB';
export const MSG_LOGO_INVALID = 'Archivo de logo inválido';
export const MSG_IMAGE_TOO_LARGE = (name: string) => `La imagen ${name} excede el tamaño máximo de 15 MB`;
export const MSG_ONLY_XLSX = 'Solo se admiten archivos .xlsx';
export const MSG_CUADRANTE_REQUIRED = 'El campo Cuadrante Afectado es obligatorio';
export const MSG_NO_PANELS = 'No hay paneles para exportar';

export type PanelTemplateId = 'aviso-corte-ad';

export interface PanelTemplateOption {
  id: PanelTemplateId;
  label: string;
  htmlTemplate: string;
}

export const PANEL_TEMPLATE_OPTIONS: PanelTemplateOption[] = [
  { id: 'aviso-corte-ad', label: 'aviso corte ad', htmlTemplate: 'panel-aviso-corte.html' },
];

export const DEFAULT_PANEL_TEMPLATE: PanelTemplateId = 'aviso-corte-ad';

export function getPanelTemplate(id: PanelTemplateId): PanelTemplateOption {
  return PANEL_TEMPLATE_OPTIONS.find((t) => t.id === id) ?? PANEL_TEMPLATE_OPTIONS[0];
}

export const ARIA_LABELS = {
  cuadranteInput: 'Cuadrante Afectado',
  fechaInput: 'Fecha de Corte',
  motivoInput: 'Motivo',
  logoRight: 'Logo derecho',
  imageUploader: 'Cargar imágenes',
  matchKeyColumn: 'Columna clave',
  matchStrategy: 'Estrategia de emparejamiento',
  regexPattern: 'Patrón de expresión regular',
  addressColumn: 'Columna de dirección',
};
