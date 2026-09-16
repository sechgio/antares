import type { CanvasDocument, CanvasLayer, LayerCssVars } from '../types';
import { mm, newId } from '../types';
import { baseFrame, docFrom, textLayer } from './helpers';

const X0 = 6;
const RIGHT = 204;
const BLUE = '#0066a1';
const LABEL_BG = '#e9ecef';
const SUB_BG = '#f8f9fa';
const TOTAL_BG = '#d4d8dd';
const BORDER = '#999999';
const INK = '#333333';
const CRIT = '#c00000';
const HEAD_FS = '6.5pt';
const CELL_FS = '6.8pt';
const INFO_FS = '7pt';
const CHECK_FS = '9pt';

interface CellStyle {
  bg?: string;
  color?: string;
  fontSize?: string;
  fontWeight?: string;
  align?: 'left' | 'center' | 'right';
  border?: string;
}

type Cell =
  | { t: 'text'; v: string; span?: number; rs?: number; s?: CellStyle; name?: string }
  | { t: 'field'; k: string; fb?: string; span?: number; s?: CellStyle; name?: string }
  | { t: 'check'; k: string; s?: CellStyle; name?: string }
  | null;

const HEAD: CellStyle = { bg: BLUE, color: '#ffffff', fontWeight: '700', fontSize: HEAD_FS };
const LABEL: CellStyle = { bg: LABEL_BG, fontWeight: '700' };
const LABEL_C: CellStyle = { bg: LABEL_BG, fontWeight: '700', align: 'center' };
const SUB: CellStyle = { bg: SUB_BG, fontWeight: '600' };
const TOTAL_L: CellStyle = { bg: TOTAL_BG, fontWeight: '700' };
const TOTAL_C: CellStyle = { bg: TOTAL_BG, fontWeight: '700', align: 'center' };
const CENTER: CellStyle = { align: 'center' };
const CHK_N: CellStyle = { color: '#000000', fontSize: CHECK_FS };
const CHK_C: CellStyle = { color: CRIT, fontSize: CHECK_FS };
const FIELD_C: CellStyle = { align: 'center' };
const INFO_LABEL: CellStyle = { bg: LABEL_BG, fontWeight: '700', fontSize: INFO_FS, border: '#cccccc' };
const INFO_VAL: CellStyle = { fontSize: INFO_FS, border: '#cccccc' };
const INFO_VAL_C: CellStyle = { fontSize: INFO_FS, align: 'center', border: '#cccccc' };
const META_LABEL: CellStyle = { bg: BLUE, color: '#ffffff', fontWeight: '700', fontSize: HEAD_FS, border: '#cccccc' };
const META_VAL: CellStyle = { fontSize: INFO_FS, align: 'center', border: '#cccccc' };

function cellCss(x: number, y: number, w: number, h: number, s?: CellStyle): LayerCssVars {
  return {
    '--width': mm(w),
    '--height': mm(h),
    '--translate-x': mm(x),
    '--translate-y': mm(y),
    '--background-color': s?.bg ?? '#ffffff',
    '--color': s?.color ?? INK,
    '--font-size': s?.fontSize ?? CELL_FS,
    '--font-weight': s?.fontWeight ?? '400',
    '--text-align': s?.align ?? 'left',
    '--border-width': '1px',
    '--border-color': s?.border ?? BORDER,
    '--stroke-align': 'center',
  };
}

function emitRows(
  layers: CanvasLayer[],
  keys: Set<string>,
  x0: number,
  y0: number,
  colW: number[],
  rows: Array<{ h: number; cols?: number[]; cells: Cell[] }>,
): number {
  let y = y0;
  for (let ri = 0; ri < rows.length; ri += 1) {
    const row = rows[ri];
    const widths = row.cols ?? colW;
    const colX: number[] = [];
    let acc = x0;
    for (const w of widths) {
      colX.push(acc);
      acc += w;
    }
    for (let ci = 0; ci < row.cells.length; ci += 1) {
      const cell = row.cells[ci];
      if (!cell) continue;
      const span = 'span' in cell ? cell.span ?? 1 : 1;
      const rs = 'rs' in cell ? cell.rs ?? 1 : 1;
      let w = 0;
      for (let i = ci; i < ci + span; i += 1) w += widths[i] ?? 0;
      let h = 0;
      for (let i = ri; i < ri + rs; i += 1) h += rows[i]?.h ?? row.h;
      const css = cellCss(colX[ci], y, w, h, cell.s);
      const id = newId();
      if (cell.t === 'text') {
        layers.push({
          id,
          type: 'text',
          name: cell.name ?? (cell.v || 'Celda'),
          value: cell.v,
          pageIndex: 0,
          cssVars: css,
        });
      } else if (cell.t === 'field') {
        keys.add(cell.k);
        layers.push({
          id,
          type: 'field',
          name: cell.name ?? cell.k,
          value: '',
          pageIndex: 0,
          cssVars: css,
          meta: { key: cell.k, fallback: cell.fb ?? ' ' },
        });
      } else {
        keys.add(cell.k);
        layers.push({
          id,
          type: 'checkbox',
          name: cell.name ?? cell.k,
          value: '',
          pageIndex: 0,
          cssVars: css,
          meta: { key: cell.k, checked: false },
        });
      }
    }
    y += row.h;
  }
  return y;
}

function headCell(v: string, extra?: Partial<Extract<Cell, { t: 'text' }>>): Cell {
  return { t: 'text', v, s: HEAD, name: `Encabezado · ${v}`, ...extra };
}

const INSPECTION_SIMPLE: Array<[string, string]> = [
  ['CAJA DE REGISTRO', 'CAJA_REGISTRO'],
  ['MARCO Y TAPA SANITARIA', 'MARCO_TAPA'],
  ['LOZA DE FONDO', 'LOZA_FONDO'],
  ['DUCTO DE VENTILACIÓN', 'DUCTO'],
  ['CERCO PERIMÉTRICO', 'CERCO'],
  ['DESCARGA', 'DESCARGA'],
];

const INSPECTION_GROUPS: Array<[string, string, string]> = [
  ['ESCALERA', 'ESCALERA_INT', 'ESCALERA_EXT'],
  ['CUBA', 'CUBA_INT', 'CUBA_EXT'],
  ['LOZA DE TECHO', 'LOZA_TECHO_INT', 'LOZA_TECHO_EXT'],
];

const INSPECTION_ORDER: Array<{ simple?: [string, string]; group?: [string, string, string] }> = [
  { simple: INSPECTION_SIMPLE[0] },
  { simple: INSPECTION_SIMPLE[1] },
  { group: INSPECTION_GROUPS[0] },
  { group: INSPECTION_GROUPS[1] },
  { simple: INSPECTION_SIMPLE[2] },
  { group: INSPECTION_GROUPS[2] },
  { simple: INSPECTION_SIMPLE[3] },
  { simple: INSPECTION_SIMPLE[4] },
  { simple: INSPECTION_SIMPLE[5] },
];

function inspCells(first: Cell, second: Cell, key: string, label: string): Cell[] {
  return [
    first,
    second,
    { t: 'check', k: `INSP_${key}_N`, s: CHK_N, name: `Normal · ${label}` },
    { t: 'check', k: `INSP_${key}_C`, s: CHK_C, name: `Crítico · ${label}` },
    { t: 'field', k: `OBS_${key}`, s: FIELD_C, name: `Obs · ${label}` },
    { t: 'field', k: `SUG_${key}`, s: FIELD_C, name: `Sug · ${label}` },
  ];
}

function diameterRows(
  prefix: string,
  rows: Array<[string, string]>,
  dias: string[],
): Array<{ h: number; cells: Cell[] }> {
  const out: Array<{ h: number; cells: Cell[] }> = [];
  for (const [label, key] of rows) {
    const cells: Cell[] = [{ t: 'text', v: label, s: LABEL, name: `${prefix} · ${label}` }];
    for (const d of dias) {
      cells.push({ t: 'field', k: `${prefix}_${key}_${d}`, s: FIELD_C, name: `${prefix} ${label} ${d}"` });
    }
    cells.push(
      { t: 'field', k: `${prefix}_${key}_OPER`, s: FIELD_C, name: `${prefix} ${label} oper` },
      { t: 'field', k: `${prefix}_${key}_NOOP`, s: FIELD_C, name: `${prefix} ${label} no op` },
      { t: 'field', k: `OBS_${prefix}_${key}`, name: `Obs · ${prefix} ${label}` },
      { t: 'field', k: `SUG_${prefix}_${key}`, name: `Sug · ${prefix} ${label}` },
    );
    out.push({ h: 4.2, cells });
  }
  const totalCells: Cell[] = [{ t: 'text', v: 'TOTAL', s: LABEL, name: `${prefix} · TOTAL` }];
  for (const d of dias) {
    totalCells.push({ t: 'field', k: `${prefix}_TOT_${d}`, s: TOTAL_C, name: `${prefix} total ${d}"` });
  }
  totalCells.push(
    { t: 'field', k: `${prefix}_TOT_OPER`, s: TOTAL_C, name: `${prefix} total oper` },
    { t: 'field', k: `${prefix}_TOT_NOOP`, s: TOTAL_C, fb: '0', name: `${prefix} total no op` },
    { t: 'field', k: `OBS_${prefix}_TOT`, s: TOTAL_L, name: `Obs · ${prefix} total` },
    { t: 'field', k: `SUG_${prefix}_TOT`, s: TOTAL_L, name: `Sug · ${prefix} total` },
  );
  out.push({ h: 4.2, cells: totalCells });
  return out;
}

function diameterTable(title: string, diaTitle: string, dias: string[], prefix: string, rows: Array<[string, string]>): Array<{ h: number; cells: Cell[] }> {
  const headerTop: Cell[] = [
    headCell(title, { rs: 2 }),
    headCell(diaTitle, { span: dias.length }),
    ...Array<Cell>(dias.length - 1).fill(null),
    headCell('OPER.', { rs: 2 }),
    headCell('NO OP.', { rs: 2 }),
    headCell('OBSERVACIONES', { rs: 2 }),
    headCell('SUGERENCIAS', { rs: 2 }),
  ];
  const headerBottom: Cell[] = [
    null,
    ...dias.map((d): Cell => headCell(`${d}"`)),
    null,
    null,
    null,
    null,
  ];
  return [
    { h: 4.7, cells: headerTop },
    { h: 4.7, cells: headerBottom },
    ...diameterRows(prefix, rows, dias),
  ];
}

const ACTIVIDADES = [
  'SEÑALIZACION DE LA ZONA DE TRABAJO',
  'LLENADO DE FORMATOS: ATS, ALTURA.',
  'DESCARGA DE HERRAMIENTAS, EQUIPOS E INSUMOS DEL VEHICULO',
  'VENTILACION DE LA ESTRUCTURA DE ALMACENAMIENTO DE AGUA',
  'INSTALACION DEL SISTEMA DE ILUMINACION',
  'TRASLADO E INGRESO DE HERRAMIENTAS NECESARIOS PARA INICIAR LA LIMPIEZA',
  'RASQUETEO DE LAS PAREDES, PISO Y TECHO CON AYUDA DE HERRAMIENTAS Y EL AGUA',
  'ENJUAGUE Y DESCARGA DEL AGUA DE LIMPIEZA',
  'PREPARACION DE LA SOLUCION DE HIPOCLORITO DE CALCIO',
  'DESINFECCION CON AYUDA DE LA BOMBA DE ALTA PRESION',
  'SE PROCEDE A CARGAR LAS HERRAMIENTAS, EQUIPOS Y SEÑALIZACION AL VEHICULO.',
];

export function createInformeTecnicoPreset(
  name = 'Informe limpieza reservorios',
): CanvasDocument {
  const layers: CanvasLayer[] = [baseFrame()];
  const keys = new Set<string>();
  let y = 6;

  layers.push({
    id: newId(),
    type: 'rect',
    name: 'Marco de título',
    value: '',
    pageIndex: 0,
    cssVars: {
      '--width': mm(198),
      '--height': mm(16.3),
      '--translate-x': mm(X0),
      '--translate-y': mm(y),
      '--background-color': '#f8f9fa',
      '--fill-type': 'linear',
      '--fill-color-2': '#e9ecef',
      '--fill-angle': '135',
      '--border-width': '2px',
      '--border-color': BLUE,
      '--border-radius': '6px',
    },
  });
  layers.push(
    textLayer({
      name: 'Título informe',
      value: 'LIMPIEZA Y DESINFECCIÓN DE RESERVORIOS Y CISTERNAS\nCENTRO DE SERVICIO VILLA EL SALVADOR',
      x: 38.8,
      y: y + 2.2,
      w: 124,
      h: 13.8,
      fontSize: '9.5pt',
      fontWeight: '700',
      color: BLUE,
      align: 'center',
    }),
  );
  y += 16.3 + 3.9;

  const metaW = [15, 12, 9, 9, 10, 12, 9, 11];
  const metaX = RIGHT - metaW.reduce((a, b) => a + b, 0);
  emitRows(layers, keys, metaX, y, metaW, [
    {
      h: 4.4,
      cells: [
        headCell('INFORME', { s: META_LABEL }),
        { t: 'field', k: 'INFORME', s: META_VAL, fb: '0' },
        headCell('DÍA', { s: META_LABEL }),
        { t: 'field', k: 'DIA', s: META_VAL, fb: '0' },
        headCell('MES', { s: META_LABEL }),
        { t: 'field', k: 'MES', s: META_VAL, fb: '0' },
        headCell('AÑO', { s: META_LABEL }),
        { t: 'field', k: 'ANIO', s: META_VAL, fb: '0' },
      ],
    },
  ]);
  y += 4.4 + 2.4;

  const infoCols = [26.5, 123.6, 21.2, 26.7];
  const infoY = y;
  y = emitRows(layers, keys, X0, y, infoCols, [
    {
      h: 5.7,
      cells: [
        { t: 'text', v: 'C.S :', s: INFO_LABEL, name: 'Info · C.S' },
        { t: 'field', k: 'CS', s: INFO_VAL, span: 3, name: 'Info · valor C.S' },
        null,
        null,
      ],
    },
    {
      h: 5.7,
      cells: [
        { t: 'text', v: 'CONTRATISTA :', s: INFO_LABEL, name: 'Info · Contratista' },
        { t: 'field', k: 'CONTRATISTA', s: INFO_VAL, name: 'Info · valor contratista' },
        { t: 'text', v: 'SGIO :', s: INFO_LABEL, name: 'Info · SGIO' },
        { t: 'field', k: 'SGIO', s: INFO_VAL_C, name: 'Info · valor SGIO' },
      ],
    },
    {
      h: 5.7,
      cols: [47.6, 150.4],
      cells: [
        { t: 'text', v: 'CÓDIGO DE INFRAESTRUCTURA :', s: INFO_LABEL, name: 'Info · Código' },
        {
          t: 'field',
          k: 'COD_INFRAESTRUCTURA',
          s: { fontSize: '12pt', fontWeight: '700', color: BLUE, align: 'center' },
          name: 'Info · valor código',
        },
      ],
    },
    {
      h: 5.7,
      cells: [
        { t: 'text', v: 'UBICACIÓN :', s: INFO_LABEL, name: 'Info · Ubicación' },
        { t: 'field', k: 'UBICACION', s: INFO_VAL, name: 'Info · valor ubicación' },
        { t: 'text', v: 'TIPO :', s: INFO_LABEL, name: 'Info · Tipo' },
        { t: 'field', k: 'TIPO', s: INFO_VAL_C, fb: 'ELEVADO', name: 'Info · valor tipo' },
      ],
    },
    {
      h: 5.7,
      cells: [
        { t: 'text', v: 'SUMINISTRO :', s: INFO_LABEL, name: 'Info · Suministro' },
        { t: 'field', k: 'SUMINISTRO', s: INFO_VAL, name: 'Info · valor suministro' },
        { t: 'text', v: 'VOLUMEN :', s: INFO_LABEL, name: 'Info · Volumen' },
        { t: 'field', k: 'VOLUMEN', s: INFO_VAL_C, fb: '0', name: 'Info · valor volumen' },
      ],
    },
  ]);
  layers.push({
    id: newId(),
    type: 'rect',
    name: 'Marco sección datos',
    value: '',
    pageIndex: 0,
    cssVars: {
      '--width': mm(198),
      '--height': mm(y - infoY),
      '--translate-x': mm(X0),
      '--translate-y': mm(infoY),
      '--background-color': 'transparent',
      '--fill-visible': '0',
      '--border-width': '1px',
      '--border-color': BORDER,
      '--border-radius': '4px',
    },
  });
  y += 2.6;

  const inspCols = [31.19, 31.19, 33.17, 33.17, 33.66, 35.62];
  const inspRows: Array<{ h: number; cells: Cell[] }> = [
    {
      h: 4.7,
      cells: [
        headCell('DESCRIPCIÓN', { span: 2, rs: 2 }),
        null,
        headCell('ESTADO', { span: 2 }),
        null,
        headCell('OBSERVACIONES', { rs: 2 }),
        headCell('SUGERENCIAS', { rs: 2 }),
      ],
    },
    {
      h: 4.7,
      cells: [null, null, headCell('NORMAL'), headCell('CRÍTICO'), null, null],
    },
  ];
  for (const item of INSPECTION_ORDER) {
    if (item.simple) {
      const [label, key] = item.simple;
      inspRows.push({
        h: 4.2,
        cells: inspCells(
          { t: 'text', v: label, span: 2, s: LABEL, name: `Insp · ${label}` },
          null,
          key,
          label,
        ),
      });
    } else if (item.group) {
      const [group, keyInt, keyExt] = item.group;
      inspRows.push({
        h: 4.2,
        cells: inspCells(
          { t: 'text', v: group, rs: 2, s: LABEL_C, name: `Insp · ${group}` },
          { t: 'text', v: 'INTERIOR', s: SUB, name: `Insp · ${group} interior` },
          keyInt,
          `${group} interior`,
        ),
      });
      inspRows.push({
        h: 4.2,
        cells: inspCells(
          null,
          { t: 'text', v: 'EXTERIOR', s: SUB, name: `Insp · ${group} exterior` },
          keyExt,
          `${group} exterior`,
        ),
      });
    }
  }
  y = emitRows(layers, keys, X0, y, inspCols, inspRows) + 2.6;

  const diaCols = [21.78, 12.45, 12.45, 12.45, 12.45, 12.45, 12.45, 12.45, 9.9, 9.9, 33.66, 35.61];
  y = emitRows(
    layers,
    keys,
    X0,
    y,
    diaCols,
    diameterTable('VÁLVULAS', 'DIÁMETRO DE VÁLVULAS', ['2', '3', '4', '6', '8', '10', '12'], 'VAL', [
      ['CONDUCCIÓN', 'COND'],
      ['IMPULSIÓN', 'IMP'],
      ['ADUCCIÓN', 'ADU'],
      ['BY PASS', 'BYP'],
      ['DESAGÜE', 'DES'],
    ]),
  ) + 2.6;

  y = emitRows(
    layers,
    keys,
    X0,
    y,
    diaCols,
    diameterTable('CANASTILLA', 'DIÁMETRO DE CANASTILLA', ['2', '3', '4', '6', '8', '10', '14'], 'CAN', [
      ['ADUCCION', 'ADU'],
      ['SUCCION', 'SUC'],
      ['DESAGUE', 'DES'],
    ]),
  ) + 2.6;

  const medCols = [128.7, 33.66, 35.64];
  const medRows: Array<{ h: number; cells: Cell[] }> = [
    { h: 4.7, cells: [headCell('MEDIDAS'), headCell('U/M'), headCell('CANTIDAD')] },
    ...[
      ['DIAMETRO', 'MED_DIAMETRO'],
      ['DIAMETRO INTERNO', 'MED_DIAMETRO_INT'],
      ['ALTURA UTIL', 'MED_ALTURA_UTIL'],
      ['ALTURA TOTAL', 'MED_ALTURA_TOTAL'],
    ].map(([label, key]): { h: number; cells: Cell[] } => ({
      h: 4.2,
      cells: [
        { t: 'text', v: label, s: LABEL, name: `Med · ${label}` },
        { t: 'text', v: 'M', s: CENTER, name: `Med · UM ${label}` },
        { t: 'field', k: key, s: FIELD_C, name: `Med · valor ${label}` },
      ],
    })),
  ];
  y = emitRows(layers, keys, X0, y, medCols, medRows) + 2.6;

  const actCols = [21.78, 176.22];
  const actRows: Array<{ h: number; cells: Cell[] }> = [
    { h: 4.7, cells: [headCell('ACTIVIDADES EJECUTADAS', { span: 2 }), null] },
    ...ACTIVIDADES.map((act, i): { h: number; cells: Cell[] } => ({
      h: 4.2,
      cells: [
        { t: 'text', v: String(i + 1), s: LABEL, name: `Act · nº ${i + 1}` },
        { t: 'text', v: act, name: `Act · ${act}` },
      ],
    })),
  ];
  emitRows(layers, keys, X0, y, actCols, actRows);

  return docFrom(name, layers, [...keys]);
}
