export const MAX_LOGO_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
export const ACCEPTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

export const MSG_LOGO_TOO_LARGE = 'El logo supera el tamaño máximo de 5 MB';
export const MSG_LOGO_INVALID = 'Archivo de logo inválido';
export const MSG_IMAGE_TOO_LARGE = (name: string) => `La imagen ${name} excede el tamaño máximo de 15 MB`;
export const MSG_ONLY_XLSX = 'Solo se admiten archivos .xlsx';
export const MSG_EXCEL_NO_ROWS = 'El Excel no contiene filas de datos';
export const MSG_EXCEL_UNREADABLE = (detail: string) => `No se pudo leer el archivo Excel: ${detail}`;
export const MSG_EXCEL_TOO_MANY_ROWS = 'El Excel excede el límite de 10.000 filas';
export const MSG_CUADRANTE_REQUIRED = 'El campo Cuadrante Afectado es obligatorio';
export const MSG_NO_PANELS = 'No hay paneles para exportar';
export const MSG_REGEX_INVALID = (detail: string) => `Expresión regular inválida: ${detail}`;

export const ARIA_LABELS = {
  cuadranteInput: 'Cuadrante Afectado',
  fechaInput: 'Fecha de Corte',
  motivoInput: 'Motivo',
  logoLeft: 'Logo izquierdo',
  logoRight: 'Logo derecho',
  imageUploader: 'Cargar imágenes',
  excelImporter: 'Importar Excel',
  matchKeyColumn: 'Columna clave',
  matchStrategy: 'Estrategia de emparejamiento',
  regexPattern: 'Patrón de expresión regular',
  addressColumn: 'Columna de dirección',
  exportMode: 'Modo de exportación',
  prevPanel: 'Panel anterior',
  nextPanel: 'Panel siguiente',
  exportButton: 'Exportar PDF',
};
