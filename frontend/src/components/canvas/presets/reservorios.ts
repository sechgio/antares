import { DEFAULT_GRID_RULES } from '../ops/gridLayout';
import type { CanvasDocument, CanvasLayer } from '../types';
import {
  addFields,
  addPhotoGrid,
  baseFrame,
  docFrom,
  dualLogos,
  fieldLayer,
  headerRule,
  textLayer,
  uniqueKeys,
  type FieldSpec,
} from './helpers';

const PAD = 8;
const FORMAT_TITLE =
  'Informe Técnico de Limpieza y Desinfección de Reservorios y Cisternas';

const FORMAT_FIELDS: FieldSpec[] = [
  { key: 'COD INFRAESTRUCT', label: 'Código de Infraestructura', x: PAD, y: 36, w: 95 },
  { key: 'CENTRO', label: 'Centro', x: 107, y: 36, w: 95 },
  { key: 'UBICACION', label: 'Ubicación', x: PAD, y: 44, w: 95 },
  { key: 'NIS', label: 'Suministro', x: 107, y: 44, w: 95 },
];

function formatReservoriosHeader(layers: CanvasLayer[]): void {
  layers.push(...dualLogos(PAD, 50, 18));
  layers.push(headerRule(30, PAD));
  layers.push(
    textLayer({
      name: 'Título informe',
      value: FORMAT_TITLE,
      x: 58,
      y: 12,
      w: 94,
      h: 14,
      fontSize: '10pt',
      fontWeight: '700',
      align: 'center',
    }),
  );
}

function luriganchoHeader(layers: CanvasLayer[]): void {
  layers.push(...dualLogos(PAD, 55, 18));
  layers.push(
    textLayer({
      name: 'Título panel',
      value: 'PANEL FOTOGRÁFICO',
      x: 55,
      y: 12,
      w: 100,
      h: 8,
      fontSize: '14pt',
      fontWeight: '700',
      color: '#0066cc',
      align: 'center',
    }),
  );
}

function luriganchoInfoBar(layers: CanvasLayer[], fields: FieldSpec[]): void {
  const barY = 28;
  const items = [
    { label: 'Centro de Servicios:', key: 'CENTRO', x: PAD },
    { label: 'Fecha de Trabajo:', key: 'FECHA_TRABAJO', x: PAD + 64 },
    { label: 'Estado:', key: 'ESTADO', x: PAD + 128 },
  ];
  for (const item of items) {
    layers.push(
      textLayer({
        name: `Label ${item.key}`,
        value: item.label,
        x: item.x,
        y: barY,
        w: 28,
        h: 5,
        fontSize: '8pt',
        fontWeight: '700',
        bg: '#f0f0f0',
      }),
    );
    layers.push(
      fieldLayer({
        key: item.key,
        label: item.label,
        x: item.x + 28,
        y: barY,
        w: 34,
        h: 5,
        fontSize: '8pt',
      }),
    );
    fields.push({ key: item.key, label: item.label, x: item.x, y: barY, w: 62 });
  }
}

function luriganchoSections(
  layers: CanvasLayer[],
  fields: FieldSpec[],
  extraKey: { label: string; key: string },
): void {
  layers.push(
    textLayer({
      name: 'Sección localización',
      value: '1.0 Localización',
      x: PAD,
      y: 36,
      w: 80,
      h: 5,
      fontSize: '9pt',
      fontWeight: '700',
      color: '#0066cc',
    }),
  );
  layers.push(
    textLayer({
      name: 'Label COD INFRAESTRUCT',
      value: 'Código de Infraestructura:',
      x: PAD,
      y: 42,
      w: 48,
      fontSize: '9pt',
      fontWeight: '700',
    }),
  );
  layers.push(
    fieldLayer({
      key: 'COD INFRAESTRUCT',
      label: 'Código de Infraestructura',
      x: PAD + 50,
      y: 42,
      w: 60,
      h: 5,
      fontSize: '9pt',
    }),
  );
  fields.push({
    key: 'COD INFRAESTRUCT',
    label: 'Código de Infraestructura',
    x: PAD,
    y: 42,
    w: 110,
  });

  layers.push(
    textLayer({
      name: 'Label DISTRITO',
      value: 'Distrito:',
      x: PAD,
      y: 48,
      w: 18,
      fontSize: '9pt',
      fontWeight: '700',
    }),
  );
  layers.push(
    fieldLayer({
      key: 'DISTRITO',
      label: 'Distrito',
      x: PAD + 20,
      y: 48,
      w: 90,
      h: 5,
      fontSize: '9pt',
    }),
  );
  fields.push({ key: 'DISTRITO', label: 'Distrito', x: PAD, y: 48, w: 110 });

  layers.push(
    textLayer({
      name: 'Sección trabajo',
      value: '2.0 Detalles de Orden de Trabajo',
      x: PAD,
      y: 55,
      w: 120,
      h: 5,
      fontSize: '9pt',
      fontWeight: '700',
      color: '#0066cc',
    }),
  );

  layers.push(
    textLayer({
      name: 'Label ACTIVIDAD',
      value: 'Actividad:',
      x: PAD,
      y: 61,
      w: 20,
      fontSize: '9pt',
      fontWeight: '700',
    }),
  );
  layers.push(
    fieldLayer({
      key: 'ACTIVIDAD',
      label: 'Actividad',
      x: PAD + 22,
      y: 61,
      w: 70,
      h: 5,
      fontSize: '9pt',
    }),
  );
  fields.push({ key: 'ACTIVIDAD', label: 'Actividad', x: PAD, y: 61, w: 92 });

  layers.push(
    textLayer({
      name: `Label ${extraKey.key}`,
      value: `${extraKey.label}:`,
      x: PAD + 96,
      y: 61,
      w: 12,
      fontSize: '9pt',
      fontWeight: '700',
    }),
  );
  layers.push(
    fieldLayer({
      key: extraKey.key,
      label: extraKey.label,
      x: PAD + 109,
      y: 61,
      w: 28,
      h: 5,
      fontSize: '9pt',
    }),
  );
  fields.push({
    key: extraKey.key,
    label: extraKey.label,
    x: PAD + 96,
    y: 61,
    w: 41,
  });

  layers.push(
    textLayer({
      name: 'Label NIS',
      value: 'NIS:',
      x: PAD + 140,
      y: 61,
      w: 10,
      fontSize: '9pt',
      fontWeight: '700',
    }),
  );
  layers.push(
    fieldLayer({
      key: 'NIS',
      label: 'NIS',
      x: PAD + 151,
      y: 61,
      w: 35,
      h: 5,
      fontSize: '9pt',
    }),
  );
  fields.push({ key: 'NIS', label: 'NIS', x: PAD + 140, y: 61, w: 46 });

  layers.push(
    textLayer({
      name: 'Sección fotos',
      value: '3.0 Panel Fotográfico',
      x: PAD,
      y: 68,
      w: 80,
      h: 5,
      fontSize: '9pt',
      fontWeight: '700',
      color: '#0066cc',
    }),
  );
}

function createLuriganchoPreset(
  name: string,
  extraKey: { label: string; key: string },
  objectFit: 'cover' | 'fill',
): CanvasDocument {
  const layers: CanvasLayer[] = [baseFrame()];
  const fields: FieldSpec[] = [];
  luriganchoHeader(layers);
  luriganchoInfoBar(layers, fields);
  luriganchoSections(layers, fields, extraKey);
  addPhotoGrid(layers, {
    x: PAD,
    y: 74,
    w: 210 - PAD * 2,
    h: 211,
    cols: 3,
    rows: 3,
    gapMm: 2,
    objectFit,
    borderColor: '#0066cc',
  });
  const doc = docFrom(name, layers, uniqueKeys(fields));
  doc.settings = { ...doc.settings, gridRules: DEFAULT_GRID_RULES };
  return doc;
}

export function createFormatReservoriosPreset(name = 'Formato reservorios'): CanvasDocument {
  const layers: CanvasLayer[] = [baseFrame()];
  formatReservoriosHeader(layers);
  addFields(layers, FORMAT_FIELDS);
  addPhotoGrid(layers, {
    x: PAD,
    y: 56,
    w: 210 - PAD * 2,
    h: 228,
    cols: 3,
    rows: 3,
    gapMm: 2,
    objectFit: 'cover',
    borderColor: '#0066cc',
  });
  const doc = docFrom(name, layers, uniqueKeys(FORMAT_FIELDS));
  doc.settings = { ...doc.settings, gridRules: DEFAULT_GRID_RULES };
  return doc;
}

export function createPanelReservoriosPreset(name = 'Panel reservorios'): CanvasDocument {
  const layers: CanvasLayer[] = [baseFrame()];
  formatReservoriosHeader(layers);
  addFields(layers, FORMAT_FIELDS);
  addPhotoGrid(layers, {
    x: PAD,
    y: 56,
    w: 210 - PAD * 2,
    h: 228,
    cols: 3,
    rows: 3,
    gapMm: 2,
    objectFit: 'cover',
    borderColor: '#0066cc',
  });
  const doc = docFrom(name, layers, uniqueKeys(FORMAT_FIELDS));
  doc.settings = { ...doc.settings, gridRules: DEFAULT_GRID_RULES, imagesPerPage: 9 };
  return doc;
}

export function createReservoriosLuriganchoV2Preset(
  name = 'Reservorios Lurigancho v2',
): CanvasDocument {
  return createLuriganchoPreset(name, { label: 'SGIO', key: 'SGIO' }, 'cover');
}

export function createReservoriosLuriganchoSgioPreset(
  name = 'Reservorios Lurigancho SGIO',
): CanvasDocument {
  return createLuriganchoPreset(name, { label: 'SGIO', key: 'SGIO' }, 'fill');
}

export function createReservoriosVillaSunassPreset(
  name = 'Reservorios Villa Sunass',
): CanvasDocument {
  return createLuriganchoPreset(name, { label: 'COD', key: 'COD' }, 'fill');
}
