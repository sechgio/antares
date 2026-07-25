import type { CanvasDocument } from '../types';
import type { FillContext } from './renderHtml';
import { renderMultiPageHtml, templateImagesPerPage } from '../ops/pages';

/** Realistic sample values for common field keys (case-insensitive). */
const SAMPLE_BY_KEY: Record<string, string> = {
  CENTRO: 'CS Norte',
  NIS: '45871203',
  OT: 'OT-2026-0841',
  DIRECCION: 'Av. Los Olivos 1245',
  LOCALIDAD: 'San Martín de Porres',
  DISTRITO: 'Lima',
  ACTIVIDAD: 'Inspección de red',
  CONTRATA: 'Servicios Andinos SAC',
  FECHA: '22/07/2026',
  TECNICO: 'María Quispe',
  OBSERVACIONES: 'Trabajo completado sin novedades.',
  NOMBRE: 'Juan Pérez',
  FIRMA: 'Juan Pérez',
};

const SAMPLE_POOL = [
  'Ejemplo 001',
  'Zona industrial',
  'Calle Las Flores 88',
  'Operación rutinaria',
  'Equipo A-12',
  'Registro demo',
];

const IMAGE_COLORS = ['#64748b', '#475569', '#334155', '#0e8fd6', '#0284c7', '#0369a1', '#0f766e', '#115e59'];

function parseTableFieldKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { fieldKeys?: (string | null)[][] };
    if (!Array.isArray(parsed.fieldKeys)) return [];
    return parsed.fieldKeys.flat().filter((k): k is string => typeof k === 'string' && k.length > 0);
  } catch {
    // Malformed rowsData JSON — treat as no field bindings rather than crash demo preview.
    return [];
  }
}

export function sampleValueForKey(key: string): string {
  const upper = key.trim().toUpperCase();
  if (SAMPLE_BY_KEY[upper]) return SAMPLE_BY_KEY[upper];
  let hash = 0;
  for (let i = 0; i < upper.length; i++) hash = (hash * 31 + upper.charCodeAt(i)) >>> 0;
  return SAMPLE_POOL[hash % SAMPLE_POOL.length];
}

/** Offline SVG placeholder — works in Electron and Vitest without canvas/network. */
export function placeholderImageDataUrl(index: number, label?: string): string {
  const bg = IMAGE_COLORS[index % IMAGE_COLORS.length];
  const text = label ?? `Foto ${index + 1}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <rect width="800" height="600" fill="${bg}"/>
  <text x="400" y="300" fill="#ffffff" font-size="42" font-family="Segoe UI, Arial, sans-serif" text-anchor="middle" dominant-baseline="middle">${text}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function collectDemoFieldKeys(doc: CanvasDocument): string[] {
  const keys = new Set<string>();
  for (const layer of doc.layers) {
    if (layer.type === 'field' || layer.type === 'checkbox' || layer.type === 'signature') {
      const key = layer.meta?.key;
      if (key) keys.add(key);
    }
    if (layer.type === 'table') {
      for (const key of parseTableFieldKeys(layer.meta?.rowsData)) keys.add(key);
    }
  }
  return [...keys];
}

/** Build FillContext with random-looking sample data and placeholder images/logos. */
export function buildDemoFillContext(doc: CanvasDocument): FillContext {
  const data: Record<string, string> = {};
  for (const key of collectDemoFieldKeys(doc)) {
    data[key] = sampleValueForKey(key);
    data[key.toUpperCase()] = data[key];
  }

  for (const layer of doc.layers) {
    if (layer.type === 'checkbox' && layer.meta?.key) {
      data[layer.meta.key] = '1';
      data[layer.meta.key.toUpperCase()] = '1';
    }
  }

  const slotCount = Math.max(
    doc.layers.filter((l) => l.type === 'imageSlot').length,
    templateImagesPerPage(doc),
    1,
  );
  const images = Array.from({ length: slotCount }, (_, i) => placeholderImageDataUrl(i));
  const imageMeta = images.map((_, i) => ({
    date: '22/07/2026 14:32',
    coords: `-12.04${i}, -77.04${i}`,
    name: `foto-${i + 1}.jpg`,
  }));

  const hasLeftLogo = doc.layers.some((l) => l.type === 'logo' && l.meta?.side !== 'right');
  const hasRightLogo = doc.layers.some((l) => l.type === 'logo' && l.meta?.side === 'right');

  return {
    data,
    images,
    logoLeft: hasLeftLogo ? placeholderImageDataUrl(0, 'Logo L') : null,
    logoRight: hasRightLogo ? placeholderImageDataUrl(1, 'Logo R') : null,
    imageMeta,
  };
}

/** Render filled HTML preview for design-mode demo (always page-aware + screen px). */
export function renderDemoPreviewHtml(doc: CanvasDocument): string {
  const ctx = buildDemoFillContext(doc);
  return renderMultiPageHtml(doc, ctx, { forScreen: true });
}
