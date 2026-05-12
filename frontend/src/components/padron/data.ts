/**
 * Tipos y datos para el Generador de Padrones
 */

export type Orientation = 'landscape' | 'portrait';
export type OutputFormat = 'service-interruption' | 'water-cut-notice';

export interface HeaderField {
  key: string;
  label: string;
  shortLabel?: string;
  required: boolean;
  wide?: boolean;
}

export interface HeaderData {
  [key: string]: string;
}

export interface WaterCutData {
  [key: string]: string;
  cuadranteAfectado: string;
  fechaCorte: string;
  horarioCorte: string;
  motivo: string;
}

export interface PadronItem {
  item: number | string;
  nombresApellidos: string;
  direccion: string;
  horaComunicacion: string;
  firmaSuministro: string;
}

export interface WaterCutItem {
  item: number | string;
  hora: string;
  fecha: string;
  nombresApellidos: string;
  direccion: string;
  dni: string;
  firma: string;
  observaciones: string;
}

export interface ExcelRecord {
  id: string;
  label: string;
  sheetName: string;
  rowIndex: number;
  data: HeaderData;
}

export interface ParseResult {
  workbookName: string;
  records: ExcelRecord[];
  importedItems: PadronItem[];
  importedWaterCutItems: WaterCutItem[];
}

export const OUTPUT_FORMAT_OPTIONS = [
  { value: 'service-interruption' as OutputFormat, label: 'Plantilla actual', rowsPerPage: 18 },
  { value: 'water-cut-notice' as OutputFormat, label: 'Aviso corte de agua', rowsPerPage: 36 },
];

export const ORIENTATION_OPTIONS = [
  { value: 'landscape' as Orientation, label: 'Horizontal', rowsPerPage: 18 },
  { value: 'portrait' as Orientation, label: 'Vertical', rowsPerPage: 37 },
];

export const HEADER_FIELDS: HeaderField[] = [
  { key: 'centro', label: 'Centro de servicio', required: true },
  { key: 'servicioAfectado', label: 'Servicio afectado', required: true },
  { key: 'motivoInterrupcion', label: 'Motivo de la interrupción', required: false },
  { key: 'fechaInicio', label: 'Fecha y hora del inicio de la interrupción del servicio', shortLabel: 'Fecha interrupción', required: true },
  { key: 'horaInicio', label: 'Hora inicio', required: true },
  { key: 'fechaPrevista', label: 'Fecha y hora prevista del restablecimiento del servicio', shortLabel: 'Fecha restablecimiento', required: true },
  { key: 'horaPrevista', label: 'Hora prevista', required: true },
  { key: 'distrito', label: 'Distrito(s)', required: true },
  { key: 'sector', label: 'Sector(es)', required: true },
  { key: 'subsectores', label: 'Subsector(es) o código(s) de abastecimiento', shortLabel: 'Código abastecimiento', required: true },
  { key: 'estructura', label: 'Estructura de almacenamiento', shortLabel: 'Estructura', required: true },
  { key: 'fechaTrabajo', label: 'Fecha de trabajo', required: true },
  { key: 'fechaComunicacion', label: 'Fecha de comunicación', required: true, wide: true },
  { key: 'localidades', label: 'Localidades afectadas', required: false, wide: true },
  { key: 'areaAfectada', label: 'Área afectada', required: false, wide: true },
  { key: 'codigoServicio', label: 'C.P.S.', required: false, wide: true },
  { key: 'descripcionServicio', label: 'Descripción del servicio', required: false, wide: true },
];

export const DATE_FIELDS = new Set(['fechaInicio', 'fechaPrevista', 'fechaTrabajo', 'fechaComunicacion']);
export const WATER_CUT_DATE_FIELDS = new Set(['fechaCorte', 'fecha']);

export const ITEM_COLUMNS = [
  { key: 'item', label: 'Item' },
  { key: 'nombresApellidos', label: 'Nombres y Apellidos' },
  { key: 'direccion', label: 'Dirección' },
  { key: 'horaComunicacion', label: 'Hora de comunicación' },
  { key: 'firmaSuministro', label: 'Firma del usuario / N° medidor / suministro' },
];

export const WATER_CUT_FIELDS: HeaderField[] = [
  { key: 'cuadranteAfectado', label: 'Cuadrante afectado', required: true },
  { key: 'fechaCorte', label: 'Fecha de corte', required: true },
  { key: 'horarioCorte', label: 'Horario de corte de servicio', required: true, wide: true },
  { key: 'motivo', label: 'Motivo', required: true, wide: true },
];

export const FIELD_ALIASES: Record<string, string[]> = {
  centro: ['centro de servicio', 'centro', 'centro servicio'],
  servicioAfectado: ['servicio afectado', 'servicio'],
  motivoInterrupcion: ['motivo de la interrupcion', 'motivo interrupcion', 'motivo'],
  fechaInicio: [
    'fecha y hora del inicio de la interrupcion del servicio',
    'fecha y hoja de inicio',
    'fecha y hora de inicio',
    'fecha inicio',
    'fecha de inicio',
  ],
  horaInicio: ['hora inicio', 'hora de inicio'],
  fechaPrevista: [
    'fecha y hora prevista del restablecimiento del servicio',
    'fecha y hora prevista',
    'fecha prevista',
    'fecha de restablecimiento',
  ],
  horaPrevista: ['hora prevista', 'hora de restablecimiento'],
  distrito: ['distrito', 'distrito s', 'distrito/os', 'distritos'],
  sector: ['sector', 'sector es', 'sector(s)', 'sectores'],
  subsectores: [
    'sub sector o subsectores de abastecimiento',
    'subsectores',
    'subsector es o codigo s de abastecimiento',
    'subsector(es) o codigo(s) de abastecimiento',
    'sub sector',
  ],
  estructura: ['estructura de almacenamiento', 'estructura'],
  fechaTrabajo: ['fecha de trabajo'],
  fechaComunicacion: ['fecha de comunicacion', 'fecha comunicacion', 'fecha comunicación'],
  localidades: ['localidades afectadas', 'localidades'],
  areaAfectada: ['area afectada', 'área afectada'],
  codigoServicio: ['c.p.s.', 'c p s', 'codigo servicio', 'nota inferior', 'cps'],
  descripcionServicio: ['descripcion servicio', 'descripcion del servicio', 'servicio de mantenimiento'],
  cantidadItems: ['cantidad de items', 'cantidad items', 'cant items', 'total items'],
};

export const WATER_CUT_FIELD_ALIASES: Record<string, string[]> = {
  cuadranteAfectado: ['cuadrante afectado', 'cuadrante', 'sector afectado'],
  fechaCorte: ['fecha de corte de', 'fecha de corte', 'fecha corte'],
  horarioCorte: [
    'horario de corte de servicio',
    'horario de corte de servicio:',
    'horario de corte',
    'horario corte',
  ],
  motivo: ['motivo'],
  cantidadItems: ['cantidad de items', 'cantidad items', 'cant items', 'total items'],
};

export const ITEM_FIELD_ALIASES: Record<string, string[]> = {
  item: ['item', 'nro', 'n°', 'numero', '#'],
  nombresApellidos: [
    'nombres y apellidos',
    'nombre y apellidos',
    'nombres',
    'apellidos',
    'nombre',
  ],
  direccion: ['direccion', 'dirección'],
  horaComunicacion: ['hora de comunicacion', 'hora comunicación', 'hora'],
  firmaSuministro: [
    'firma del usuario / n medidor / suministro',
    'firma del usuario / n° medidor / suministro',
    'firma',
    'suministro',
    'firma del usuario',
  ],
};

export const WATER_CUT_ITEM_FIELD_ALIASES: Record<string, string[]> = {
  hora: ['hora'],
  fecha: ['fecha'],
  nombresApellidos: [
    'nombre y apellidos',
    'nombre y apellido',
    'nombres y apellidos',
    'nombres',
    'nombre',
  ],
  direccion: ['direccion', 'dirección'],
  dni: ['dni', 'documento'],
  firma: ['firma'],
  observaciones: ['observaciones', 'observacion', 'observación'],
};

export function toDisplayDate(isoOrAny: string): string {
  if (!isoOrAny) return '';
  const s = String(isoOrAny).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const d = String(parsed.getDate()).padStart(2, '0');
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const y = parsed.getFullYear();
    return `${d}/${m}/${y}`;
  }
  return s;
}

export function toISODate(displayDate: string): string {
  if (!displayDate) return '';
  const s = String(displayDate).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const match = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return '';
}

export function createDefaultHeaderData(): HeaderData {
  return {
    centro: 'San Juan de Lurigancho',
    servicioAfectado: 'Agua Potable',
    motivoInterrupcion: 'Limpieza y desinfección de Reservorio',
    fechaInicio: '',
    horaInicio: '',
    fechaPrevista: '',
    horaPrevista: '',
    distrito: '',
    sector: '',
    subsectores: '',
    estructura: '',
    fechaTrabajo: '',
    fechaComunicacion: '',
    localidades: '',
    areaAfectada: '',
    codigoServicio: 'C.P.S. N° 140-2025- SEDAPAL-ITEM N° 03',
    descripcionServicio: '"Servicio de Mantenimiento de los Sistemas de Agua Potable y Alcantarillado en el Ambito de la Gerencia Servicios Centro"',
    cantidadItems: '',
  };
}

export function createDefaultWaterCutData(): WaterCutData {
  return {
    cuadranteAfectado: '',
    fechaCorte: '',
    horarioCorte: '',
    motivo: '',
  };
}

export function createEmptyItem(num: number): PadronItem {
  return {
    item: num,
    nombresApellidos: '',
    direccion: '',
    horaComunicacion: '',
    firmaSuministro: '',
  };
}

export function createInitialItems(total = 36): PadronItem[] {
  return Array.from({ length: total }, (_, i) => createEmptyItem(i + 1));
}

export function createEmptyWaterCutItem(num: number): WaterCutItem {
  return {
    item: num,
    hora: '',
    fecha: '',
    nombresApellidos: '',
    direccion: '',
    dni: '',
    firma: '',
    observaciones: '',
  };
}

export function createInitialWaterCutItems(total = 36): WaterCutItem[] {
  return Array.from({ length: total }, (_, i) => createEmptyWaterCutItem(i + 1));
}
