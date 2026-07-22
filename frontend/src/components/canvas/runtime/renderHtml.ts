import type { CanvasDocument, CanvasLayer } from '../types';
import { parseMm } from '../types';
import { applyGridToImageSlots } from '../ops/gridLayout';
import { clipPathForLayerType } from '../ops/shapePaths';
import { buildLayerTransform, cssVarsToStyleParts } from '../ops/layerStyle';
import { buildLineSvgContent } from '../ops/lineSvg';
import { ensureLinePath } from '../ops/pathGeometry';

export { cssVarsToStyleParts };

export interface FillContext {
  data: Record<string, string>;
  images: string[];
  logoLeft: string | null;
  logoRight: string | null;
  imageMeta?: Array<{ date?: string; coords?: string; name?: string }>;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cssVarsToInline(vars: CanvasLayer['cssVars']): string {
  return cssVarsToStyleParts(vars).join(';');
}

/** Drop placeholder fill/border for logo and field — keep editor chrome, clean PDF. */
function cssVarsForExport(layer: CanvasLayer): CanvasLayer['cssVars'] {
  if (layer.type === 'line') {
    const ensured = ensureLinePath(layer);
    return {
      ...ensured.cssVars,
      '--background-color': 'transparent',
      '--fill-visible': '0',
      '--border-width': '0px',
      '--stroke-visible': '0',
    };
  }
  if (layer.type !== 'logo' && layer.type !== 'field') return layer.cssVars;
  return {
    ...layer.cssVars,
    '--background-color': 'transparent',
    '--fill-visible': '0',
    '--stroke-visible': '0',
    '--border-width': '0px',
  };
}

function parseTableData(raw: string | undefined): { cells: string[][]; fieldKeys?: (string | null)[][] } {
  if (!raw) return { cells: [['', '']] };
  try {
    const parsed = JSON.parse(raw) as { cells?: string[][]; fieldKeys?: (string | null)[][] };
    if (Array.isArray(parsed.cells)) {
      return { cells: parsed.cells, fieldKeys: parsed.fieldKeys };
    }
  } catch {
    /* ignore */
  }
  return { cells: [['', '']] };
}

function resolveLayerContent(
  layer: CanvasLayer,
  ctx: FillContext,
): { kind: 'text' | 'image' | 'empty' | 'html'; html: string } {
  if (layer.type === 'frame' || layer.type === 'group' || layer.type === 'grid') {
    return { kind: 'empty', html: '' };
  }
  if (layer.visible === false) {
    return { kind: 'empty', html: '' };
  }
  if (layer.type === 'text') {
    return { kind: 'text', html: escapeHtml(layer.value || '') };
  }
  if (layer.type === 'field') {
    const key = layer.meta?.key || '';
    const fallback = layer.meta?.fallback ?? '-';
    const value = key && ctx.data[key] != null && ctx.data[key] !== '' ? ctx.data[key] : fallback;
    return { kind: 'text', html: escapeHtml(String(value)) };
  }
  if (layer.type === 'logo') {
    const src = layer.meta?.side === 'right' ? ctx.logoRight : ctx.logoLeft;
    if (!src) return { kind: 'empty', html: '' };
    return {
      kind: 'image',
      html: `<img src="${escapeHtml(src)}" alt="logo" style="width:100%;height:100%;object-fit:contain;" />`,
    };
  }
  if (layer.type === 'imageSlot') {
    const index = layer.meta?.index ?? 0;
    const src = ctx.images[index];
    const meta = ctx.imageMeta?.[index];
    if (!src) {
      return {
        kind: 'text',
        html: `<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#94a3b8;font-size:9pt;">Foto ${index + 1}</span>`,
      };
    }
    const fit = layer.cssVars['--object-fit'] || 'cover';
    const captions: string[] = [];
    if (layer.meta?.showDate && meta?.date) captions.push(escapeHtml(meta.date));
    if (layer.meta?.showCoords && meta?.coords) captions.push(escapeHtml(meta.coords));
    if (layer.meta?.showFilename && meta?.name) captions.push(escapeHtml(meta.name));
    const captionHtml = captions.length
      ? `<div style="position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,0.55);color:#fff;font-size:7pt;padding:1mm 1.5mm;line-height:1.2;">${captions.join(' · ')}</div>`
      : '';
    return {
      kind: 'html',
      html: `<div style="position:relative;width:100%;height:100%;"><img src="${escapeHtml(src)}" alt="foto-${index}" style="width:100%;height:100%;object-fit:${escapeHtml(fit)};" />${captionHtml}</div>`,
    };
  }
  if (layer.type === 'image') {
    if (!layer.value) return { kind: 'empty', html: '' };
    const fit = layer.cssVars['--object-fit'] || 'cover';
    return {
      kind: 'image',
      html: `<img src="${escapeHtml(layer.value)}" alt="" style="width:100%;height:100%;object-fit:${escapeHtml(fit)};" />`,
    };
  }
  if (
    layer.type === 'rect' ||
    layer.type === 'ellipse' ||
    layer.type === 'arrow' ||
    layer.type === 'polygon' ||
    layer.type === 'star'
  ) {
    return { kind: 'empty', html: '' };
  }
  if (layer.type === 'line') {
    return { kind: 'html', html: buildLineSvgContent(ensureLinePath(layer)) };
  }
  if (layer.type === 'checkbox') {
    const key = layer.meta?.key;
    let checked = Boolean(layer.meta?.checked);
    if (key && ctx.data[key] != null) {
      const raw = String(ctx.data[key]).toLowerCase();
      checked = raw === '1' || raw === 'true' || raw === 'si' || raw === 'sí' || raw === 'x' || raw === 'yes';
    }
    const mark = checked ? '✓' : '';
    return {
      kind: 'html',
      html: `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:10pt;font-weight:700;border:1px solid #000;box-sizing:border-box;">${mark}</div>`,
    };
  }
  if (layer.type === 'signature') {
    const key = layer.meta?.key;
    const name = key && ctx.data[key] ? ctx.data[key] : layer.value || '';
    return {
      kind: 'html',
      html: `<div style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:flex-end;padding:1mm;box-sizing:border-box;"><div style="border-top:1px solid #000;padding-top:1mm;font-size:8pt;text-align:center;">${escapeHtml(name || 'Firma')}</div></div>`,
    };
  }
  if (layer.type === 'table') {
    const { cells, fieldKeys } = parseTableData(layer.meta?.rowsData);
    const rowsHtml = cells
      .map((row, ri) => {
        const cellsHtml = row
          .map((cell, ci) => {
            const fieldKey = fieldKeys?.[ri]?.[ci];
            const text =
              fieldKey && ctx.data[fieldKey] != null && ctx.data[fieldKey] !== ''
                ? ctx.data[fieldKey]
                : cell;
            return `<td style="border:1px solid #cbd5e1;padding:1mm 1.5mm;font-size:8pt;">${escapeHtml(String(text))}</td>`;
          })
          .join('');
        return `<tr>${cellsHtml}</tr>`;
      })
      .join('');
    return {
      kind: 'html',
      html: `<table style="width:100%;height:100%;border-collapse:collapse;table-layout:fixed;">${rowsHtml}</table>`,
    };
  }
  return { kind: 'empty', html: '' };
}

function prepareLayers(document: CanvasDocument, ctx: FillContext): CanvasLayer[] {
  let layers = document.layers.filter((l) => l.visible !== false);
  const grid = layers.find((l) => l.type === 'grid');
  if (grid) {
    layers = applyGridToImageSlots(layers, grid.id, ctx.images.length || undefined);
  }
  return layers.filter((l) => l.type !== 'frame' && l.type !== 'group' && l.type !== 'grid');
}

/** Build a filled A4 HTML document from Canvas layers + runtime data. */
export function renderCanvasHtml(
  document: CanvasDocument,
  ctx: FillContext,
  options?: { forScreen?: boolean },
): string {
  const { widthMm, heightMm } = document.page;
  const forScreen = options?.forScreen ?? false;
  const MM_TO_PX = 96 / 25.4;
  const u = (mmVal: number) => (forScreen ? `${mmVal * MM_TO_PX}px` : `${mmVal}mm`);
  const pageW = forScreen ? `${widthMm * MM_TO_PX}px` : `${widthMm}mm`;
  const pageH = forScreen ? `${heightMm * MM_TO_PX}px` : `${heightMm}mm`;
  const contentLayers = prepareLayers(document, ctx);

  const nodes = contentLayers
    .map((layer) => {
      const ensured = layer.type === 'line' ? ensureLinePath(layer) : layer;
      const x = parseMm(ensured.cssVars['--translate-x']);
      const y = parseMm(ensured.cssVars['--translate-y']);
      const w = parseMm(ensured.cssVars['--width'], 10);
      const exportVars = cssVarsForExport(ensured);
      const h = parseMm(exportVars['--height'] ?? ensured.cssVars['--height'], 10);
      const resolved = resolveLayerContent(ensured, ctx);
      if (ensured.visible === false) return '';
      const extra = cssVarsToInline(exportVars);
      const clip = clipPathForLayerType(ensured.type);
      const clipStyle = clip ? `clip-path:${clip};` : '';
      const transform = buildLayerTransform(ensured.cssVars);
      const transformStyle = transform ? `transform:${transform};transform-origin:center center;` : '';
      const overflow = ensured.type === 'line' ? 'visible' : 'hidden';
      const box = `position:absolute;left:${u(x)};top:${u(y)};width:${u(w)};height:${u(h)};box-sizing:border-box;overflow:${overflow};${clipStyle}${transformStyle}${extra}`;
      if (resolved.kind === 'text') {
        return `<div data-layer="${escapeHtml(ensured.id)}" style="${box};display:flex;align-items:center;padding:4px;">${resolved.html}</div>`;
      }
      if (resolved.kind === 'image' || resolved.kind === 'html') {
        return `<div data-layer="${escapeHtml(ensured.id)}" style="${box}">${resolved.html}</div>`;
      }
      return `<div data-layer="${escapeHtml(ensured.id)}" style="${box}"></div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(document.name)}</title>
<style>
  @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${pageW};
    height: ${pageH};
    margin: 0;
    background: #fff;
    font-family: 'Segoe UI', Arial, sans-serif;
  }
  .page {
    position: relative;
    width: ${pageW};
    height: ${pageH};
    background: #fff;
    overflow: hidden;
    page-break-after: always;
  }
</style>
</head>
<body>
  <div class="page">${nodes}</div>
</body>
</html>`;
}

export function mergeCanvasHtmlDocuments(documents: string[]): string {
  if (documents.length <= 1) return documents[0] || '';
  const bodies = documents.map((html) => {
    const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    return match ? match[1] : html;
  });
  const first = documents[0];
  const headMatch = first.match(/([\s\S]*?<body[^>]*>)/i);
  const head = headMatch ? headMatch[1] : '<!DOCTYPE html><html><body>';
  return `${head}${bodies.join('\n')}</body></html>`;
}
