import type { CanvasDocument, CanvasLayer } from '../types';
import { mm, newId } from '../types';
import {
  addFields,
  addPhotoGrid,
  baseFrame,
  docFrom,
  dualLogos,
  fieldLayer,
  headerRule,
  logoSlot,
  textLayer,
  uniqueKeys,
  type FieldSpec,
} from './helpers';

const PAD = 8;
const BLUE = '#0056b3';

function centeredTitle(
  text: string,
  y: number,
  opts: { fontSize?: string; color?: string; w?: number; h?: number } = {},
): CanvasLayer {
  const w = opts.w ?? 100;
  return textLayer({
    name: 'Título',
    value: text,
    x: (210 - w) / 2,
    y,
    w,
    h: opts.h ?? 10,
    fontSize: opts.fontSize ?? '12pt',
    fontWeight: '700',
    color: opts.color ?? '#000000',
    align: 'center',
  });
}

function sectionTitle(value: string, y: number, color = BLUE): CanvasLayer {
  return textLayer({
    name: value,
    value,
    x: PAD,
    y,
    w: 210 - PAD * 2,
    h: 6,
    fontSize: '7.5pt',
    fontWeight: '700',
    color,
  });
}

function tealField(f: FieldSpec): CanvasLayer {
  const layer = fieldLayer(f);
  return { ...layer, cssVars: { ...layer.cssVars, '--color': '#3BA9AF' } };
}

export function createReportPreset(name = 'Panel fotográfico'): CanvasDocument {
  const layers: CanvasLayer[] = [
    baseFrame(),
    ...dualLogos(PAD, 55, 18),
    centeredTitle('PANEL FOTOGRÁFICO', 11, { fontSize: '13pt', color: BLUE, w: 90 }),
    headerRule(26, PAD, '#dddddd', 1.5),
  ];
  const fields: FieldSpec[] = [
    { key: 'CENTRO', label: 'Centro de servicios', x: PAD, y: 30, w: 88, dotted: true },
    { key: 'NIS', label: 'NIS', x: 98, y: 30, w: 48, dotted: true },
    { key: 'OT', label: 'OT', x: 148, y: 30, w: 54, dotted: true },
    { key: 'DIRECCION', label: 'Dirección', x: PAD, y: 46, w: 62, dotted: true },
    { key: 'LOCALIDAD', label: 'Localidad', x: 72, y: 46, w: 42, dotted: true },
    { key: 'DISTRITO', label: 'Distrito', x: 116, y: 46, w: 42, dotted: true },
    { key: 'ESTADO', label: 'Estado', x: 160, y: 46, w: 42, dotted: true },
    { key: 'TIPO RED', label: 'Tipo red', x: PAD, y: 54, w: 62, dotted: true },
    { key: 'SECTOR', label: 'Sector', x: 72, y: 54, w: 130, dotted: true },
    { key: 'ACTIVIDAD', label: 'Actividad', x: PAD, y: 70, w: 94, dotted: true },
    { key: 'CONTRATA', label: 'Contrata', x: 106, y: 70, w: 96, dotted: true },
    { key: 'SUBACTIVIDAD', label: 'Subactividad', x: PAD, y: 78, w: 94, dotted: true },
    { key: 'CUADRILLA', label: 'Cuadrilla', x: 106, y: 78, w: 96, dotted: true },
    { key: 'OBSERVACION SEDAPAL', label: 'Obs. SEDAPAL', x: PAD, y: 86, w: 194, dotted: true },
    { key: 'OBSERVACION CONTRATA', label: 'Obs. contrata', x: PAD, y: 94, w: 194, dotted: true },
  ];
  addFields(layers, fields.slice(0, 3));
  layers.push(sectionTitle('1.0 LOCALIZACIÓN', 38));
  addFields(layers, fields.slice(3, 9));
  layers.push(sectionTitle('2.0 DETALLES', 62));
  addFields(layers, fields.slice(9, 15));
  layers.push(sectionTitle('3.0 PANEL FOTOGRÁFICO', 88));
  addPhotoGrid(layers, {
    x: PAD, y: 95, w: 194, h: 185, cols: 3, rows: 2,
    objectFit: 'fill', borderColor: '#333333', gapMm: 2,
  });
  return docFrom(name, layers, uniqueKeys(fields));
}

export function createEmergenciasPreset(name = 'Emergencias'): CanvasDocument {
  const layers: CanvasLayer[] = [
    baseFrame(),
    ...dualLogos(),
    centeredTitle('INFORME TÉCNICO DE ACTIVIDADES', 11, { fontSize: '12pt', w: 110 }),
    headerRule(28, PAD, '#333333', 2),
  ];
  const fields: FieldSpec[] = [
    { key: 'CENTRO', label: 'Centro de servicio', x: PAD, y: 30, w: 62 },
    { key: 'CONTRATISTA', label: 'Contratista', x: 72, y: 30, w: 62 },
    { key: 'NIS', label: 'NIS', x: 136, y: 30, w: 66 },
    { key: 'DIRECCION', label: 'Dirección', x: PAD, y: 38, w: 194 },
    { key: 'LOCALIDAD', label: 'Localidad', x: PAD, y: 44, w: 94 },
    { key: 'DISTRITO', label: 'Distrito', x: 108, y: 44, w: 94 },
    { key: 'ACTIVIDAD', label: 'Actividad', x: PAD, y: 52, w: 94 },
    { key: 'SUBACTIVIDAD', label: 'Subactividad', x: 108, y: 52, w: 94 },
  ];
  addFields(layers, fields);
  addPhotoGrid(layers, {
    x: PAD, y: 60, w: 194, h: 220, cols: 2, rows: 2,
    objectFit: 'contain', borderColor: '#0066cc', gapMm: 2,
  });
  return docFrom(name, layers, uniqueKeys(fields));
}

export function createPanelAvisoCortePreset(name = 'Aviso de corte'): CanvasDocument {
  const M = 12.7;
  const W = 210 - M * 2;
  const layers: CanvasLayer[] = [
    baseFrame(),
    logoSlot({ side: 'right', x: 210 - M - 58, y: M, w: 58, h: 15, name: 'Logo' }),
    textLayer({
      name: 'Título',
      value: 'AVISO DE CORTE DEL SERVICIO DE AGUA POTABLE, POR TRABAJOS DE MEJORAMIENTO EN EL SISTEMA',
      x: M, y: M, w: 118, h: 18, fontSize: '12pt', fontWeight: '700', align: 'center',
    }),
  ];
  const fields: FieldSpec[] = [
    { key: 'CUADRANTE', label: 'Cuadrante afectado', x: M, y: 36, w: W, h: 8 },
    { key: 'FECHA_CORTE', label: 'Fecha de corte', x: M, y: 46, w: W, h: 8 },
    { key: 'MOTIVO', label: 'Motivo', x: M, y: 56, w: W, h: 10 },
  ];
  for (const f of fields) layers.push(tealField(f));
  layers.push(textLayer({
    name: 'Sección fotos', value: 'PANEL FOTOGRAFICO', x: M, y: 68, w: W, h: 7,
    fontSize: '12pt', fontWeight: '700', align: 'center',
  }));
  const photoW = (W - 2) / 2;
  const photoH = 88;
  const captions = [
    'IMAGEN N°1: (Indicar direccion segun lista de usuarios)',
    'IMAGEN N°2: (Indicar direccion segun lista de usuarios)',
    'IMAGEN N°3: (Indicar direccion segun lista de usuarios)',
    'IMAGEN N°4: (Indicar direccion segun lista de usuarios)',
  ];
  const photoYs = [76, 180];
  const captionYs = [166, 270];
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 2; col += 1) {
      const idx = row * 2 + col;
      layers.push({
        id: newId(),
        type: 'imageSlot',
        name: `Foto ${idx + 1}`,
        value: '',
        pageIndex: 0,
        cssVars: {
          '--width': mm(photoW),
          '--height': mm(photoH),
          '--translate-x': mm(M + col * (photoW + 2)),
          '--translate-y': mm(photoYs[row]),
          '--background-color': '#fafafa',
          '--border-width': '1px',
          '--border-color': '#000000',
          '--object-fit': 'cover',
        },
        meta: { index: idx },
      });
      layers.push(textLayer({
        name: `Leyenda ${idx + 1}`, value: captions[idx],
        x: M + col * (photoW + 2), y: captionYs[row], w: photoW, h: 10,
        fontSize: '9pt',
      }));
    }
  }
  return docFrom(name, layers, fields.map((f) => f.key));
}

export function createPanelVolanteoPreset(name = 'Panel volanteo'): CanvasDocument {
  const layers: CanvasLayer[] = [
    baseFrame(),
    ...dualLogos(),
    centeredTitle('Panel Fotográfico Volanteo', 11, { fontSize: '14pt', w: 110 }),
    headerRule(28, PAD, '#333333', 2),
  ];
  const fields: FieldSpec[] = [
    { key: 'CENTRO', label: 'Centro de servicios', x: PAD, y: 32, w: 46 },
    { key: 'NIS', label: 'NIS', x: 56, y: 32, w: 46 },
    { key: 'SECTOR', label: 'Sector', x: 104, y: 32, w: 46 },
    { key: 'FECHA CORTE', label: 'Fecha de corte', x: 152, y: 32, w: 50 },
    { key: 'DIRECCIONES AFECTADAS', label: 'Direcciones afectadas', x: PAD, y: 48, w: 194 },
    { key: 'DISTRITO', label: 'Distrito', x: PAD, y: 58, w: 62 },
    { key: 'CODIGO COMPONENTE', label: 'Código componente', x: 74, y: 58, w: 62 },
    { key: 'ESTADO', label: 'Estado', x: 140, y: 58, w: 62 },
  ];
  layers.push(sectionTitle('1.0 LOCALIZACIÓN', 42, '#0066cc'));
  addFields(layers, fields);
  layers.push(sectionTitle('2.0 PANEL FOTOGRÁFICO', 68, '#0066cc'));
  addPhotoGrid(layers, {
    x: PAD, y: 76, w: 194, h: 205, cols: 2, rows: 2,
    objectFit: 'contain', borderColor: '#0066cc', gapMm: 2,
  });
  return docFrom(name, layers, uniqueKeys(fields));
}

export function createEvidenciaVolanteoPreset(name = 'Evidencia volanteo'): CanvasDocument {
  const layers: CanvasLayer[] = [
    baseFrame(),
    ...dualLogos(PAD, 38, 22),
    textLayer({
      name: 'Título', value: 'EVIDENCIA DE VOLANTEO', x: 50, y: 32, w: 110, h: 8,
      fontSize: '11pt', fontWeight: '700', align: 'center',
    }),
  ];
  const fields: FieldSpec[] = [
    { key: 'CUADRANTE', label: 'Cuadrante', x: PAD, y: 42, w: 194, h: 7, fontSize: '9pt' },
  ];
  addFields(layers, fields);
  addPhotoGrid(layers, {
    x: PAD, y: 45, w: 194, h: 230, cols: 3, rows: 2,
    objectFit: 'fill', borderColor: '#000000', gapMm: 1,
  });
  return docFrom(name, layers, uniqueKeys(fields));
}

export function createMaquinaBaldePreset(name = 'Máquina de balde'): CanvasDocument {
  const layers: CanvasLayer[] = [
    baseFrame(),
    ...dualLogos(),
    centeredTitle('MAQUINA DE BALDE', 11, { fontSize: '14pt', w: 100 }),
    headerRule(28, PAD, '#333333', 2),
  ];
  const fields: FieldSpec[] = [
    { key: 'FECHA_TRABAJO', label: 'Fecha de trabajo', x: PAD, y: 32, w: 62 },
    { key: 'NIS', label: 'NIS', x: 72, y: 32, w: 62 },
    { key: 'SGIO', label: 'SGIO', x: 136, y: 32, w: 66 },
    { key: 'DIRECCION', label: 'Dirección', x: PAD, y: 48, w: 194 },
    { key: 'LOCALIDAD', label: 'Localidad', x: PAD, y: 56, w: 94 },
    { key: 'DISTRITO', label: 'Distrito', x: 108, y: 56, w: 94 },
    { key: 'ACTIVIDAD', label: 'Actividad', x: PAD, y: 72, w: 194 },
  ];
  layers.push(sectionTitle('1.0 LOCALIZACIÓN', 42, '#0066cc'));
  addFields(layers, fields.slice(3, 6));
  layers.push(sectionTitle('2.0 DETALLES', 64, '#0066cc'));
  addFields(layers, fields.slice(0, 3));
  addFields(layers, fields.slice(6));
  layers.push(sectionTitle('3.0 PANEL FOTOGRÁFICO', 84, '#0066cc'));
  addPhotoGrid(layers, {
    x: PAD, y: 92, w: 194, h: 190, cols: 2, rows: 2,
    objectFit: 'contain', borderColor: '#0066cc', gapMm: 2,
  });
  return docFrom(name, layers, uniqueKeys(fields));
}

export function createVolanMaqBaldeSjlPreset(name = 'Volanteo máq. balde SJL'): CanvasDocument {
  const layers: CanvasLayer[] = [
    baseFrame(),
    ...dualLogos(),
    centeredTitle('PANEL FOTOGRAFICO', 11, { fontSize: '14pt', w: 100 }),
    headerRule(28, PAD, '#333333', 2),
  ];
  const fields: FieldSpec[] = [
    { key: 'CENTRO', label: 'Centro de servicios', x: PAD, y: 32, w: 62 },
    { key: 'FECHA CORTE', label: 'Fecha corte', x: 72, y: 32, w: 62 },
    { key: 'ESTADO', label: 'Estado', x: 136, y: 32, w: 66 },
    { key: 'DIRECCIONES AFECTADAS', label: 'Direcciones afectadas', x: PAD, y: 48, w: 194 },
    { key: 'DISTRITO', label: 'Distrito', x: PAD, y: 58, w: 194 },
    { key: 'ACTIVIDAD', label: 'Actividad', x: PAD, y: 72, w: 94 },
    { key: 'CUADRILLA', label: 'Cuadrilla', x: 108, y: 72, w: 94 },
  ];
  layers.push(sectionTitle('1.0 LOCALIZACIÓN', 42, '#0066cc'));
  addFields(layers, fields.slice(0, 3));
  addFields(layers, fields.slice(3, 5));
  layers.push(sectionTitle('2.0 DETALLES', 64, '#0066cc'));
  addFields(layers, fields.slice(5));
  layers.push(sectionTitle('3.0 PANEL FOTOGRÁFICO', 84, '#0066cc'));
  addPhotoGrid(layers, {
    x: PAD, y: 92, w: 194, h: 190, cols: 2, rows: 2,
    objectFit: 'contain', borderColor: '#0066cc', gapMm: 2,
  });
  return docFrom(name, layers, uniqueKeys(fields));
}

export function createAniegosChorrillosPreset(name = 'Aniegos Chorrillos'): CanvasDocument {
  const layers: CanvasLayer[] = [
    baseFrame(),
    ...dualLogos(PAD, 55, 18),
    centeredTitle('PANEL FOTOGRÁFICO ANIEGOS', 11, { fontSize: '13pt', color: '#333333', w: 100 }),
    headerRule(26, PAD, '#dddddd', 1.5),
  ];
  const fields: FieldSpec[] = [
    { key: 'CENTRO', label: 'Centro de servicios', x: PAD, y: 30, w: 88, dotted: true },
    { key: 'NIS', label: 'NIS', x: 98, y: 30, w: 48, dotted: true },
    { key: 'Nro OT', label: 'Nro OT', x: 148, y: 30, w: 54, dotted: true },
    { key: 'DIRECCION', label: 'Dirección', x: PAD, y: 46, w: 62, dotted: true },
    { key: 'LOCALIDAD', label: 'Localidad', x: 72, y: 46, w: 42, dotted: true },
    { key: 'DISTRITO', label: 'Distrito', x: 116, y: 46, w: 42, dotted: true },
    { key: 'ESTADO', label: 'Estado', x: 160, y: 46, w: 42, dotted: true },
    { key: 'TIPO', label: 'Tipo', x: PAD, y: 54, w: 62, dotted: true },
    { key: 'FECHA', label: 'Fecha', x: 72, y: 54, w: 130, dotted: true },
    { key: 'ACTIVIDAD', label: 'Actividad', x: PAD, y: 70, w: 94, dotted: true },
    { key: 'CONTRATA', label: 'Contrata', x: 106, y: 70, w: 96, dotted: true },
    { key: 'SUBACTIVIDAD', label: 'Subactividad', x: PAD, y: 78, w: 94, dotted: true },
    { key: 'CUADRILLA', label: 'Cuadrilla', x: 106, y: 78, w: 96, dotted: true },
  ];
  layers.push(sectionTitle('1.0 LOCALIZACIÓN', 38));
  addFields(layers, fields.slice(0, 3));
  addFields(layers, fields.slice(3, 9));
  layers.push(sectionTitle('2.0 DETALLES', 62));
  addFields(layers, fields.slice(9));
  layers.push(sectionTitle('3.0 PANEL FOTOGRÁFICO', 88));
  addPhotoGrid(layers, {
    x: PAD, y: 95, w: 194, h: 185, cols: 2, rows: 3,
    objectFit: 'contain', borderColor: '#333333', gapMm: 2,
  });
  return docFrom(name, layers, uniqueKeys(fields));
}
