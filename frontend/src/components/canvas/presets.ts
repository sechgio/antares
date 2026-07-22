import { createLayer } from './constants';
import { applyGridToImageSlots, DEFAULT_GRID_RULES } from './ops/gridLayout';
import type { CanvasDocument, CanvasLayer } from './types';
import { DOCUMENT_VERSION, mm, newId } from './types';

function baseFrame(): CanvasLayer {
  return {
    id: newId(),
    type: 'frame',
    name: 'Página A4',
    value: '',
    locked: true,
    pageIndex: 0,
    cssVars: {
      '--width': mm(210),
      '--height': mm(297),
      '--translate-x': mm(0),
      '--translate-y': mm(0),
      '--background-color': '#ffffff',
    },
  };
}

function logoPair(): CanvasLayer[] {
  return [
    {
      id: newId(),
      type: 'logo',
      name: 'Logo izquierdo',
      value: '',
      pageIndex: 0,
      cssVars: {
        '--width': mm(45),
        '--height': mm(16),
        '--translate-x': mm(8),
        '--translate-y': mm(8),
        '--background-color': '#f8fafc',
        '--border-width': '1px',
        '--border-color': '#cbd5e1',
        '--object-fit': 'contain',
      },
      meta: { side: 'left' },
    },
    {
      id: newId(),
      type: 'logo',
      name: 'Logo derecho',
      value: '',
      pageIndex: 0,
      cssVars: {
        '--width': mm(40),
        '--height': mm(16),
        '--translate-x': mm(162),
        '--translate-y': mm(8),
        '--background-color': '#f8fafc',
        '--border-width': '1px',
        '--border-color': '#cbd5e1',
        '--object-fit': 'contain',
      },
      meta: { side: 'right' },
    },
  ];
}

function addFields(
  layers: CanvasLayer[],
  fields: Array<{ key: string; label: string; x: number; y: number; w: number }>,
): void {
  for (const f of fields) {
    layers.push({
      id: newId(),
      type: 'field',
      name: f.label,
      value: '',
      pageIndex: 0,
      cssVars: {
        '--width': mm(f.w),
        '--height': mm(8),
        '--translate-x': mm(f.x),
        '--translate-y': mm(f.y),
        '--color': '#222222',
        '--font-size': '8pt',
        '--background-color': '#f8fafc',
        '--border-width': '1px',
        '--border-color': '#e2e8f0',
        '--text-align': 'left',
      },
      meta: { key: f.key, fallback: '-' },
    });
  }
}

function addPhotoGrid(
  layers: CanvasLayer[],
  opts: { x: number; y: number; w: number; h: number; cols: number; rows: number; gapMm?: number },
): void {
  const gridId = newId();
  layers.push({
    id: gridId,
    type: 'grid',
    name: 'Cuadrícula fotos',
    value: '',
    pageIndex: 0,
    cssVars: {
      '--width': mm(opts.w),
      '--height': mm(opts.h),
      '--translate-x': mm(opts.x),
      '--translate-y': mm(opts.y),
      '--background-color': 'transparent',
      '--border': '1px dashed #94a3b8',
    },
    meta: {
      cols: opts.cols,
      rows: opts.rows,
      gapMm: opts.gapMm ?? 2,
      rules: DEFAULT_GRID_RULES,
    },
  });
  const count = opts.cols * opts.rows;
  for (let i = 0; i < count; i += 1) {
    layers.push({
      id: newId(),
      type: 'imageSlot',
      name: `Foto ${i + 1}`,
      value: '',
      pageIndex: 0,
      parentId: gridId,
      cssVars: {
        '--width': mm(40),
        '--height': mm(40),
        '--translate-x': mm(opts.x),
        '--translate-y': mm(opts.y),
        '--background-color': '#f1f5f9',
        '--border-width': '1px',
        '--border-color': '#cbd5e1',
        '--object-fit': 'cover',
      },
      meta: { index: i },
    });
  }
  const laid = applyGridToImageSlots(layers, gridId);
  layers.length = 0;
  layers.push(...laid);
}

function docFrom(name: string, layers: CanvasLayer[], fieldKeys: string[]): CanvasDocument {
  return {
    version: DOCUMENT_VERSION,
    id: newId(),
    name,
    page: { widthMm: 210, heightMm: 297 },
    pages: [{ id: newId(), name: 'Página 1' }],
    settings: {},
    layers,
    fields: fieldKeys.map((key) => ({ id: newId(), key, label: key })),
  };
}

/** Starter layout inspired by backend/templates/report.html (panel fotográfico). */
export function createPanelFotograficoPreset(name = 'Panel fotográfico'): CanvasDocument {
  const layers: CanvasLayer[] = [baseFrame(), ...logoPair()];
  layers.push({
    id: newId(),
    type: 'text',
    name: 'Título',
    value: 'PANEL FOTOGRÁFICO',
    pageIndex: 0,
    cssVars: {
      '--width': mm(90),
      '--height': mm(10),
      '--translate-x': mm(60),
      '--translate-y': mm(11),
      '--color': '#111111',
      '--font-size': '13pt',
      '--font-weight': '700',
      '--text-align': 'center',
      '--background-color': 'transparent',
    },
  });

  const fields = [
    { key: 'CENTRO', label: 'Centro', x: 8, y: 28, w: 64 },
    { key: 'NIS', label: 'NIS', x: 74, y: 28, w: 40 },
    { key: 'OT', label: 'OT', x: 116, y: 28, w: 40 },
    { key: 'DIRECCION', label: 'Dirección', x: 8, y: 42, w: 100 },
    { key: 'LOCALIDAD', label: 'Localidad', x: 110, y: 42, w: 45 },
    { key: 'DISTRITO', label: 'Distrito', x: 157, y: 42, w: 45 },
    { key: 'ACTIVIDAD', label: 'Actividad', x: 8, y: 56, w: 95 },
    { key: 'CONTRATA', label: 'Contrata', x: 105, y: 56, w: 97 },
  ];
  addFields(layers, fields);
  layers.push({
    id: newId(),
    type: 'text',
    name: 'Sección fotos',
    value: '3.0 PANEL FOTOGRÁFICO',
    pageIndex: 0,
    cssVars: {
      '--width': mm(194),
      '--height': mm(7),
      '--translate-x': mm(8),
      '--translate-y': mm(70),
      '--color': '#111',
      '--font-size': '9pt',
      '--font-weight': '700',
      '--background-color': 'transparent',
    },
  });
  addPhotoGrid(layers, { x: 8, y: 80, w: 194, h: 200, cols: 2, rows: 3 });
  return docFrom(name, layers, fields.map((f) => f.key));
}

/** Emergencias — 2×2 photo grid (backend/templates/emergencias.html). */
export function createEmergenciasPreset(name = 'Emergencias'): CanvasDocument {
  const layers: CanvasLayer[] = [baseFrame(), ...logoPair()];
  layers.push({
    id: newId(),
    type: 'text',
    name: 'Título',
    value: 'PANEL EMERGENCIAS',
    pageIndex: 0,
    cssVars: {
      '--width': mm(100),
      '--height': mm(10),
      '--translate-x': mm(55),
      '--translate-y': mm(11),
      '--color': '#111',
      '--font-size': '12pt',
      '--font-weight': '700',
      '--text-align': 'center',
      '--background-color': 'transparent',
    },
  });
  const fields = [
    { key: 'CENTRO', label: 'Centro', x: 8, y: 30, w: 95 },
    { key: 'DIRECCION', label: 'Dirección', x: 107, y: 30, w: 95 },
    { key: 'DISTRITO', label: 'Distrito', x: 8, y: 42, w: 95 },
    { key: 'FECHA', label: 'Fecha', x: 107, y: 42, w: 95 },
  ];
  addFields(layers, fields);
  addPhotoGrid(layers, { x: 8, y: 60, w: 194, h: 220, cols: 2, rows: 2, gapMm: 3 });
  return docFrom(name, layers, fields.map((f) => f.key));
}

/** Reservorios — 3×3 grid with conditional rules. */
export function createReservoriosPreset(name = 'Reservorios'): CanvasDocument {
  const layers: CanvasLayer[] = [baseFrame(), ...logoPair()];
  layers.push({
    id: newId(),
    type: 'text',
    name: 'Título',
    value: 'PANEL RESERVORIOS',
    pageIndex: 0,
    cssVars: {
      '--width': mm(100),
      '--height': mm(10),
      '--translate-x': mm(55),
      '--translate-y': mm(11),
      '--color': '#111',
      '--font-size': '12pt',
      '--font-weight': '700',
      '--text-align': 'center',
      '--background-color': 'transparent',
    },
  });
  const fields = [
    { key: 'COD_INFRAESTRUCT', label: 'Código', x: 8, y: 30, w: 60 },
    { key: 'CENTRO', label: 'Centro', x: 72, y: 30, w: 64 },
    { key: 'UBICACION', label: 'Ubicación', x: 140, y: 30, w: 62 },
    { key: 'NIS', label: 'NIS', x: 8, y: 42, w: 60 },
  ];
  addFields(layers, fields);
  addPhotoGrid(layers, { x: 8, y: 56, w: 194, h: 228, cols: 3, rows: 3, gapMm: 2 });
  const doc = docFrom(name, layers, fields.map((f) => f.key));
  doc.settings = { gridRules: DEFAULT_GRID_RULES };
  return doc;
}

/** Etapas ANTE / DURANTE / DESPUÉS — 4 labeled photo sections. */
export function createEtapasPreset(name = 'Etapas de trabajo'): CanvasDocument {
  const layers: CanvasLayer[] = [baseFrame(), ...logoPair()];
  layers.push({
    id: newId(),
    type: 'text',
    name: 'Título',
    value: 'FORMATO ETAPAS',
    pageIndex: 0,
    cssVars: {
      '--width': mm(100),
      '--height': mm(10),
      '--translate-x': mm(55),
      '--translate-y': mm(11),
      '--color': '#111',
      '--font-size': '13pt',
      '--font-weight': '700',
      '--text-align': 'center',
      '--background-color': 'transparent',
    },
  });
  const fields = [
    { key: 'CODIGO_BUZON', label: 'Código buzón', x: 8, y: 28, w: 95 },
    { key: 'DIRECCION', label: 'Dirección', x: 107, y: 28, w: 95 },
  ];
  addFields(layers, fields);
  const labels = ['ANTES', 'DURANTE', 'DESPUÉS 1', 'DESPUÉS 2'];
  const positions = [
    [8, 48],
    [108, 48],
    [8, 165],
    [108, 165],
  ];
  positions.forEach(([x, y], index) => {
    layers.push({
      id: newId(),
      type: 'text',
      name: `Label ${labels[index]}`,
      value: labels[index],
      pageIndex: 0,
      cssVars: {
        '--width': mm(94),
        '--height': mm(6),
        '--translate-x': mm(x),
        '--translate-y': mm(y),
        '--font-size': '8pt',
        '--font-weight': '700',
        '--color': '#111',
        '--background-color': 'transparent',
      },
    });
    layers.push({
      id: newId(),
      type: 'imageSlot',
      name: `Foto ${labels[index]}`,
      value: '',
      pageIndex: 0,
      cssVars: {
        '--width': mm(94),
        '--height': mm(100),
        '--translate-x': mm(x),
        '--translate-y': mm(y + 8),
        '--background-color': '#f1f5f9',
        '--border-width': '1px',
        '--border-color': '#cbd5e1',
        '--object-fit': 'cover',
      },
      meta: { index },
    });
  });
  return docFrom(name, layers, fields.map((f) => f.key));
}

/** Certificado sanitario base (checkboxes + firmas). */
export function createCertificadoPreset(name = 'Certificado sanitización'): CanvasDocument {
  const layers: CanvasLayer[] = [baseFrame()];
  layers.push({
    id: newId(),
    type: 'logo',
    name: 'Logo',
    value: '',
    pageIndex: 0,
    cssVars: {
      '--width': mm(50),
      '--height': mm(18),
      '--translate-x': mm(80),
      '--translate-y': mm(12),
      '--background-color': '#f8fafc',
      '--border-width': '1px',
      '--border-color': '#cbd5e1',
      '--object-fit': 'contain',
    },
    meta: { side: 'left' },
  });
  layers.push({
    id: newId(),
    type: 'text',
    name: 'Título',
    value: 'CERTIFICADO DE SANITIZACIÓN',
    pageIndex: 0,
    cssVars: {
      '--width': mm(180),
      '--height': mm(10),
      '--translate-x': mm(15),
      '--translate-y': mm(36),
      '--font-size': '14pt',
      '--font-weight': '700',
      '--text-align': 'center',
      '--color': '#111',
      '--background-color': 'transparent',
    },
  });
  const fields = [
    { key: 'NRO_CERTIFICADO', label: 'N° Certificado', x: 15, y: 52, w: 80 },
    { key: 'CLIENTE', label: 'Cliente', x: 15, y: 66, w: 180 },
    { key: 'DIRECCION', label: 'Dirección', x: 15, y: 80, w: 180 },
    { key: 'DISTRITO', label: 'Distrito', x: 15, y: 94, w: 90 },
    { key: 'FECHA', label: 'Fecha', x: 110, y: 94, w: 85 },
  ];
  addFields(layers, fields);

  const services = [
    { key: 'SERVICIO_A', label: 'A) Desinfección', y: 120 },
    { key: 'SERVICIO_B', label: 'B) Desratización', y: 134 },
    { key: 'SERVICIO_C', label: 'C) Desinsectación', y: 148 },
    { key: 'SERVICIO_D', label: 'D) Otros', y: 162 },
  ];
  for (const s of services) {
    layers.push({
      ...createLayer('checkbox', {
        name: s.label,
        pageIndex: 0,
        cssVars: {
          '--width': mm(6),
          '--height': mm(6),
          '--translate-x': mm(20),
          '--translate-y': mm(s.y),
          '--background-color': '#ffffff',
          '--border-width': '1px',
          '--border-color': '#000000',
        },
        meta: { key: s.key, checked: false },
      }),
    });
    layers.push({
      id: newId(),
      type: 'text',
      name: `Label ${s.key}`,
      value: s.label,
      pageIndex: 0,
      cssVars: {
        '--width': mm(100),
        '--height': mm(6),
        '--translate-x': mm(30),
        '--translate-y': mm(s.y),
        '--font-size': '9pt',
        '--color': '#222',
        '--background-color': 'transparent',
      },
    });
  }

  layers.push({
    ...createLayer('signature', {
      name: 'Firma técnico',
      pageIndex: 0,
      cssVars: {
        '--width': mm(70),
        '--height': mm(28),
        '--translate-x': mm(20),
        '--translate-y': mm(220),
        '--background-color': 'transparent',
      },
      meta: { key: 'FIRMA_TECNICO' },
    }),
  });
  layers.push({
    ...createLayer('signature', {
      name: 'Firma cliente',
      pageIndex: 0,
      cssVars: {
        '--width': mm(70),
        '--height': mm(28),
        '--translate-x': mm(120),
        '--translate-y': mm(220),
        '--background-color': 'transparent',
      },
      meta: { key: 'FIRMA_CLIENTE' },
    }),
  });

  return docFrom(name, layers, [
    ...fields.map((f) => f.key),
    ...services.map((s) => s.key),
    'FIRMA_TECNICO',
    'FIRMA_CLIENTE',
  ]);
}

/** Esqueleto ficha técnica con tabla + firmas. */
export function createFichaTecnicaPreset(name = 'Ficha técnica'): CanvasDocument {
  const layers: CanvasLayer[] = [baseFrame()];
  layers.push({
    id: newId(),
    type: 'text',
    name: 'Título',
    value: 'FICHA TÉCNICA',
    pageIndex: 0,
    cssVars: {
      '--width': mm(180),
      '--height': mm(10),
      '--translate-x': mm(15),
      '--translate-y': mm(12),
      '--font-size': '14pt',
      '--font-weight': '700',
      '--text-align': 'center',
      '--color': '#111',
      '--background-color': 'transparent',
    },
  });
  const fields = [
    { key: 'CLIENTE', label: 'Cliente', x: 15, y: 30, w: 180 },
    { key: 'DIRECCION', label: 'Dirección', x: 15, y: 44, w: 180 },
    { key: 'FECHA', label: 'Fecha', x: 15, y: 58, w: 90 },
  ];
  addFields(layers, fields);
  layers.push({
    ...createLayer('table', {
      name: 'Productos',
      pageIndex: 0,
      cssVars: {
        '--width': mm(180),
        '--height': mm(50),
        '--translate-x': mm(15),
        '--translate-y': mm(80),
        '--background-color': '#ffffff',
        '--border-width': '1px',
        '--border-color': '#cbd5e1',
      },
      meta: {
        rowsData: JSON.stringify({
          cells: [
            ['Producto', 'Dosis', 'Área'],
            ['', '', ''],
            ['', '', ''],
            ['', '', ''],
          ],
        }),
      },
    }),
  });
  layers.push({
    ...createLayer('line', {
      name: 'Separador',
      pageIndex: 0,
      cssVars: {
        '--width': mm(180),
        '--height': mm(0.5),
        '--translate-x': mm(15),
        '--translate-y': mm(145),
        '--background-color': '#000000',
      },
    }),
  });
  layers.push({
    ...createLayer('signature', {
      name: 'Firma',
      pageIndex: 0,
      cssVars: {
        '--width': mm(80),
        '--height': mm(30),
        '--translate-x': mm(65),
        '--translate-y': mm(220),
        '--background-color': 'transparent',
      },
      meta: { key: 'FIRMA' },
    }),
  });
  return docFrom(name, layers, [...fields.map((f) => f.key), 'FIRMA']);
}

export const CANVAS_PRESETS = [
  { id: 'panel', label: 'Panel fotográfico', create: createPanelFotograficoPreset },
  { id: 'emergencias', label: 'Emergencias 2×2', create: createEmergenciasPreset },
  { id: 'reservorios', label: 'Reservorios 3×3', create: createReservoriosPreset },
  { id: 'etapas', label: 'Etapas de trabajo', create: createEtapasPreset },
  { id: 'certificado', label: 'Certificado', create: createCertificadoPreset },
  { id: 'ficha', label: 'Ficha técnica', create: createFichaTecnicaPreset },
] as const;
