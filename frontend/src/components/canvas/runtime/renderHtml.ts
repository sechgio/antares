import type { CanvasDocument, CanvasLayer } from '../types';
import { parseMm } from '../types';
import { applyGridToImageSlots } from '../ops/gridLayout';
import { justifyContentForTextAlign } from '../ops/inlineEdit';
import { clipPathForLayerType } from '../ops/shapePaths';
import {
  buildLayerTransform,
  cssVarsToStyleParts,
  imageContentInlineStyle,
} from '../ops/layerStyle';
import {
  DEFAULT_LAYER_COLOR,
  DEFAULT_LAYER_FONT,
  DEFAULT_LINE_HEIGHT,
} from '../ops/layerPaint';
import { buildLineSvgContent } from '../ops/lineSvg';
import { ensureLinePath } from '../ops/pathGeometry';
import { parseTableData } from '../ops/tableData';

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

/** Drop editor placeholder chrome (dashed fills/borders) for clean filled export. */
function stripPlaceholderChrome(vars: CanvasLayer['cssVars']): CanvasLayer['cssVars'] {
  return {
    ...vars,
    '--background-color': 'transparent',
    '--fill-visible': '0',
    '--stroke-visible': '0',
    '--border-width': '0px',
    '--border': '',
  };
}

/** Drop placeholder fill/border for logo/field/filled slots — keep editor chrome, clean PDF. */
function cssVarsForExport(layer: CanvasLayer, ctx?: FillContext): CanvasLayer['cssVars'] {
  if (layer.type === 'line') {
    const ensured = ensureLinePath(layer);
    return {
      ...ensured.cssVars,
      '--background-color': 'transparent',
      '--fill-visible': '0',
      '--border-width': '0px',
      '--stroke-visible': '0',
      '--border': '',
    };
  }
  if (layer.type === 'field' || layer.type === 'logo') {
    return stripPlaceholderChrome(layer.cssVars);
  }
  if (layer.type === 'imageSlot') {
    const index = layer.meta?.index ?? 0;
    if (ctx?.images[index]) return stripPlaceholderChrome(layer.cssVars);
  }
  return layer.cssVars;
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
    const imgStyle = imageContentInlineStyle({
      ...layer.cssVars,
      '--object-fit': layer.cssVars['--object-fit'] || 'contain',
    });
    return {
      kind: 'image',
      html: `<img src="${escapeHtml(src)}" alt="logo" style="${imgStyle}" />`,
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
    const imgStyle = imageContentInlineStyle(layer.cssVars);
    const captions: string[] = [];
    if (layer.meta?.showDate && meta?.date) captions.push(escapeHtml(meta.date));
    if (layer.meta?.showCoords && meta?.coords) captions.push(escapeHtml(meta.coords));
    if (layer.meta?.showFilename && meta?.name) captions.push(escapeHtml(meta.name));
    const captionHtml = captions.length
      ? `<div style="position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,0.55);color:#fff;font-size:7pt;padding:1mm 1.5mm;line-height:1.2;">${captions.join(' · ')}</div>`
      : '';
    return {
      kind: 'html',
      html: `<div style="position:relative;width:100%;height:100%;overflow:hidden;"><img src="${escapeHtml(src)}" alt="foto-${index}" style="${imgStyle}" />${captionHtml}</div>`,
    };
  }
  if (layer.type === 'image') {
    if (!layer.value) return { kind: 'empty', html: '' };
    const imgStyle = imageContentInlineStyle(layer.cssVars);
    return {
      kind: 'image',
      html: `<img src="${escapeHtml(layer.value)}" alt="" style="${imgStyle}" />`,
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
    const fontSize = layer.cssVars['--font-size'] || '10pt';
    const color = layer.cssVars['--color'] || 'inherit';
    return {
      kind: 'html',
      html: `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:${escapeHtml(fontSize)};font-weight:700;color:${escapeHtml(color)};box-sizing:border-box;">${mark}</div>`,
    };
  }
  if (layer.type === 'signature') {
    const key = layer.meta?.key;
    const name = key && ctx.data[key] ? ctx.data[key] : layer.value || '';
    const fontSize = layer.cssVars['--font-size'] || '8pt';
    const color = layer.cssVars['--color'] || 'inherit';
    return {
      kind: 'html',
      html: `<div style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:flex-end;padding:1mm;box-sizing:border-box;color:${escapeHtml(color)};"><div style="border-top:1px solid currentColor;padding-top:1mm;font-size:${escapeHtml(fontSize)};text-align:center;">${escapeHtml(name || 'Firma')}</div></div>`,
    };
  }
  if (layer.type === 'table') {
    const { cells, fieldKeys } = parseTableData(layer.meta?.rowsData);
    const fontSize = layer.cssVars['--font-size'] || '8pt';
    const borderColor = layer.cssVars['--border-color'] || '#cbd5e1';
    const color = layer.cssVars['--color'] || 'inherit';
    const rowsHtml = cells
      .map((row, ri) => {
        const cellsHtml = row
          .map((cell, ci) => {
            const fieldKey = fieldKeys?.[ri]?.[ci];
            const text =
              fieldKey && ctx.data[fieldKey] != null && ctx.data[fieldKey] !== ''
                ? ctx.data[fieldKey]
                : cell;
            return `<td style="border:1px solid ${escapeHtml(borderColor)};padding:1mm 1.5mm;font-size:${escapeHtml(fontSize)};color:${escapeHtml(color)};">${escapeHtml(String(text))}</td>`;
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
  // Match Design artboard (mmToScreenPx at zoom=1): whole CSS pixels, no subpixel drift.
  const u = (mmVal: number) => (forScreen ? `${Math.round(mmVal * MM_TO_PX)}px` : `${mmVal}mm`);
  const pageW = forScreen ? `${Math.round(widthMm * MM_TO_PX)}px` : `${widthMm}mm`;
  const pageH = forScreen ? `${Math.round(heightMm * MM_TO_PX)}px` : `${heightMm}mm`;
  const contentLayers = prepareLayers(document, ctx);

  const nodes = contentLayers
    .map((layer) => {
      const ensured = layer.type === 'line' ? ensureLinePath(layer) : layer;
      const x = parseMm(ensured.cssVars['--translate-x']);
      const y = parseMm(ensured.cssVars['--translate-y']);
      const w = parseMm(ensured.cssVars['--width'], 10);
      const exportVars = cssVarsForExport(ensured, ctx);
      const h = parseMm(exportVars['--height'] ?? ensured.cssVars['--height'], 10);
      const resolved = resolveLayerContent(ensured, ctx);
      if (ensured.visible === false) return '';
      const styleVars =
        ensured.type === 'text' || ensured.type === 'field'
          ? {
              ...exportVars,
              '--color': exportVars['--color'] || DEFAULT_LAYER_COLOR,
              '--font-family': exportVars['--font-family'] || DEFAULT_LAYER_FONT,
            }
          : exportVars;
      const extra = cssVarsToInline(styleVars);
      const clip = clipPathForLayerType(ensured.type);
      const clipStyle = clip ? `clip-path:${clip};` : '';
      const hasTransform = Boolean(buildLayerTransform(ensured.cssVars));
      const transformOriginStyle = hasTransform ? 'transform-origin:center center;' : '';
      const hasExplicitRadius = Boolean(
        ensured.cssVars['--border-radius'] ||
          ensured.cssVars['--radius-tl'] ||
          ensured.cssVars['--radius-tr'] ||
          ensured.cssVars['--radius-br'] ||
          ensured.cssVars['--radius-bl'],
      );
      const ellipseRadius =
        ensured.type === 'ellipse' && !hasExplicitRadius && !clip ? 'border-radius:50%;' : '';
      const clipRadius = clip ? 'border-radius:0;' : '';
      const overflow = ensured.type === 'line' ? 'visible' : 'hidden';
      const lineFlex =
        ensured.type === 'line' ? 'display:flex;align-items:center;' : '';
      // clipRadius last so it overrides any border-radius from cssVarsToStyleParts
      const box = `position:absolute;left:${u(x)};top:${u(y)};width:${u(w)};height:${u(h)};box-sizing:border-box;overflow:${overflow};${lineFlex}${clipStyle}${transformOriginStyle}${ellipseRadius}${extra};${clipRadius}`;
      if (resolved.kind === 'text') {
        const justify = justifyContentForTextAlign(ensured.cssVars['--text-align']);
        const lineHeight = ensured.cssVars['--line-height'] || DEFAULT_LINE_HEIGHT;
        return `<div data-layer="${escapeHtml(ensured.id)}" style="${box};display:flex;align-items:center;justify-content:${justify};padding:2px 6px;"><span style="width:100%;line-height:${lineHeight};white-space:pre-wrap;">${resolved.html}</span></div>`;
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
    font-family: ${DEFAULT_LAYER_FONT};
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
