import type { CanvasDocument, CanvasLayer } from '../types';
import { parseMm } from '../types';
import { fieldDesignLabel, justifyContentForTextAlign } from '../ops/inlineEdit';
import { clipPathForLayerType } from '../ops/shapePaths';
import {
  buildLayerTransform,
  cssVarsToStyleParts,
  imageContentInlineStyle,
} from '../ops/layerStyle';
import {
  buildLayerPaintStyle,
  DEFAULT_LAYER_FONT,
  DEFAULT_LINE_HEIGHT,
} from '../ops/layerPaint';
import { collectGoogleFontFamilies, googleFontsHeadHtml } from '../ops/fontCatalog';
import { buildLineSvgContent } from '../ops/lineSvg';
import { ensureLinePath } from '../ops/pathGeometry';
import { parseTableData } from '../ops/tableData';

export { cssVarsToStyleParts };

/** Inner chrome paddings — must match LayerNode at zoom=1 (not mm). */
const SIGNATURE_PAD = '1px';
const TABLE_CELL_PAD = '1px 2px';
const CAPTION_PAD = '2px 4px';

export interface FillContext {
  data: Record<string, string>;
  images: string[];
  logoLeft: string | null;
  logoRight: string | null;
  imageMeta?: Array<{ date?: string; coords?: string; name?: string }>;
}

/** Matches LayerNode chrome placeholders (logo / empty imageSlot / grid) at zoom=1. */
const CHROME_PLACEHOLDER_STYLE =
  'width:100%;text-align:center;color:#94a3b8;font-size:10px;font-family:ui-monospace, SFMono-Regular, Menlo, monospace;';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Serialize buildLayerPaintStyle (same defaults as LayerNode @ zoom 1) to inline CSS. */
function paintVarsToInline(vars: CanvasLayer['cssVars']): string {
  const paint = buildLayerPaintStyle(vars, { scale: 1 });
  return Object.entries(paint)
    .map(([camel, value]) => {
      const kebab = camel.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      return `${kebab}:${value}`;
    })
    .join(';');
}

/** Drop editor placeholder fill/border — used for filled logos (clean Generar/PDF). */
export function stripPlaceholderChrome(vars: CanvasLayer['cssVars']): CanvasLayer['cssVars'] {
  return {
    ...vars,
    '--background-color': 'transparent',
    '--fill-visible': '0',
    '--stroke-visible': '0',
    '--border-width': '0px',
    '--border': '',
  };
}

/**
 * Line layers clear box paint (SVG stroke carries the visual).
 * Filled logos drop placeholder chrome so brand marks sit on the page without a grey box.
 * Empty logo/field slots keep design chrome (WYSIWYG placeholders).
 */
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
  if (layer.type === 'logo') {
    const src = layer.meta?.side === 'right' ? ctx?.logoRight : ctx?.logoLeft;
    if (src) return stripPlaceholderChrome(layer.cssVars);
  }
  return layer.cssVars;
}

function resolveLayerContent(
  layer: CanvasLayer,
  ctx: FillContext,
): { kind: 'text' | 'image' | 'empty' | 'html'; html: string } {
  if (layer.type === 'frame') {
    return { kind: 'empty', html: '' };
  }
  if (layer.type === 'grid') {
    const cols = layer.meta?.cols ?? 2;
    const rows = layer.meta?.rows ?? 2;
    return {
      kind: 'html',
      html: `<span style="${CHROME_PLACEHOLDER_STYLE}">Grid ${cols}×${rows}</span>`,
    };
  }
  if (layer.type === 'group') {
    return { kind: 'text', html: escapeHtml('Grupo') };
  }
  if (layer.visible === false) {
    return { kind: 'empty', html: '' };
  }
  if (layer.type === 'text') {
    return { kind: 'text', html: escapeHtml(layer.value || '') };
  }
  if (layer.type === 'field') {
    const key = layer.meta?.key || '';
    const hasData = key && ctx.data[key] != null && ctx.data[key] !== '';
    const value = hasData ? ctx.data[key] : fieldDesignLabel(layer);
    return { kind: 'text', html: escapeHtml(String(value)) };
  }
  if (layer.type === 'logo') {
    const src = layer.meta?.side === 'right' ? ctx.logoRight : ctx.logoLeft;
    if (!src) {
      const side = layer.meta?.side === 'right' ? 'R' : 'L';
      return {
        kind: 'html',
        html: `<span style="${CHROME_PLACEHOLDER_STYLE}">Logo ${side}</span>`,
      };
    }
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
        kind: 'html',
        html: `<span style="${CHROME_PLACEHOLDER_STYLE}">Foto ${index + 1}</span>`,
      };
    }
    const imgStyle = imageContentInlineStyle(layer.cssVars);
    const captions: string[] = [];
    if (layer.meta?.showDate && meta?.date) captions.push(escapeHtml(meta.date));
    if (layer.meta?.showCoords && meta?.coords) captions.push(escapeHtml(meta.coords));
    if (layer.meta?.showFilename && meta?.name) captions.push(escapeHtml(meta.name));
    const captionHtml = captions.length
      ? `<div style="position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,0.55);color:#fff;font-size:7pt;padding:${CAPTION_PAD};line-height:1.2;">${captions.join(' · ')}</div>`
      : '';
    return {
      kind: 'html',
      html: `<div style="position:relative;width:100%;height:100%;overflow:hidden;"><img src="${escapeHtml(src)}" alt="foto-${index}" style="${imgStyle}" />${captionHtml}</div>`,
    };
  }
  if (layer.type === 'image') {
    if (!layer.value) {
      return {
        kind: 'html',
        html: `<span style="${CHROME_PLACEHOLDER_STYLE}">Imagen</span>`,
      };
    }
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
    layer.type === 'diamond' ||
    layer.type === 'hexagon' ||
    layer.type === 'pentagon' ||
    layer.type === 'star'
  ) {
    return { kind: 'empty', html: '' };
  }
  if (layer.type === 'line') {
    const svg = buildLineSvgContent(ensureLinePath(layer));
    return {
      kind: 'html',
      html: `<div style="width:100%;height:100%;pointer-events:none">${svg}</div>`,
    };
  }
  if (layer.type === 'checkbox') {
    const key = layer.meta?.key;
    let checked = Boolean(layer.meta?.checked);
    if (key && ctx.data[key] != null) {
      const raw = String(ctx.data[key]).toLowerCase();
      checked = raw === '1' || raw === 'true' || raw === 'si' || raw === 'sí' || raw === 'x' || raw === 'yes';
    }
    const mark = checked ? '✓' : '';
    // font-size/color inherit from outer paint (same as LayerNode).
    return {
      kind: 'html',
      html: `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:inherit;color:inherit;box-sizing:border-box;">${mark}</div>`,
    };
  }
  if (layer.type === 'signature') {
    const key = layer.meta?.key;
    const name = key && ctx.data[key] ? ctx.data[key] : layer.value || '';
    return {
      kind: 'html',
      html: `<div style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:flex-end;padding:${SIGNATURE_PAD};box-sizing:border-box;color:inherit;"><div style="border-top:1px solid currentColor;padding-top:${SIGNATURE_PAD};font-size:inherit;text-align:center;">${escapeHtml(name || 'Firma')}</div></div>`,
    };
  }
  if (layer.type === 'table') {
    const { cells, fieldKeys } = parseTableData(layer.meta?.rowsData);
    const borderColor = layer.cssVars['--border-color'] || '#cbd5e1';
    const rowsHtml = cells
      .map((row, ri) => {
        const cellsHtml = row
          .map((cell, ci) => {
            const fieldKey = fieldKeys?.[ri]?.[ci];
            const text =
              fieldKey && ctx.data[fieldKey] != null && ctx.data[fieldKey] !== ''
                ? ctx.data[fieldKey]
                : cell;
            return `<td style="border:1px solid ${escapeHtml(borderColor)};padding:${TABLE_CELL_PAD};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(String(text))}</td>`;
          })
          .join('');
        return `<tr>${cellsHtml}</tr>`;
      })
      .join('');
    return {
      kind: 'html',
      html: `<table style="width:100%;height:100%;border-collapse:collapse;table-layout:fixed;font-size:inherit;color:inherit;">${rowsHtml}</table>`,
    };
  }
  return { kind: 'empty', html: '' };
}

function prepareLayers(document: CanvasDocument): CanvasLayer[] {
  // Do not re-layout grids here — Design renders stored slot positions as-is.
  // Relayout only happens in the editor when the user edits grid cols/rows/gap.
  return document.layers.filter((l) => l.visible !== false && l.type !== 'frame');
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
  const contentLayers = prepareLayers(document);

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
      const extra = paintVarsToInline(exportVars);
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
      const justify = justifyContentForTextAlign(ensured.cssVars['--text-align']);
      const isTextBox = ensured.type === 'text' || ensured.type === 'field';
      const pad = isTextBox ? 'padding:2px 6px;' : 'padding:0;';
      // Match LayerNode: every layer is a flex box (alignment + chrome placeholders).
      const valign = isTextBox ? ensured.cssVars['--text-valign'] || 'center' : 'center';
      const flex = `display:flex;align-items:${valign};justify-content:${justify};`;
      const blendMode = ensured.cssVars['--blend-mode']
        ? `mix-blend-mode:${ensured.cssVars['--blend-mode']};`
        : '';
      // clipRadius last so it overrides any border-radius from cssVarsToStyleParts
      const box = `position:absolute;left:${u(x)};top:${u(y)};width:${u(w)};height:${u(h)};box-sizing:border-box;overflow:${overflow};${flex}${pad}${blendMode}${clipStyle}${transformOriginStyle}${ellipseRadius}${extra};${clipRadius}`;
      if (resolved.kind === 'text') {
        const lineHeight = ensured.cssVars['--line-height'] || DEFAULT_LINE_HEIGHT;
        const fontFamily = ensured.cssVars['--font-family'] || DEFAULT_LAYER_FONT;
        const align = ensured.cssVars['--text-align'] || 'left';
        const fontStyle = ensured.cssVars['--font-style'];
        const textDecoration = ensured.cssVars['--text-decoration'];
        const letterSpacing = ensured.cssVars['--letter-spacing'] || 'normal';
        const textTransform = ensured.cssVars['--text-transform'];
        const typo = [
          fontStyle ? `font-style:${fontStyle};` : '',
          textDecoration ? `text-decoration:${textDecoration};` : '',
          `letter-spacing:${letterSpacing};`,
          textTransform && textTransform !== 'none' ? `text-transform:${textTransform};` : '',
        ].join('');
        const innerSpan =
          ensured.type === 'field' || ensured.type === 'text'
            ? `width:100%;line-height:${lineHeight};white-space:pre-wrap;font-family:${fontFamily};font-size:inherit;color:inherit;text-align:${align};${typo}`
            : `width:100%;line-height:${lineHeight};white-space:pre-wrap;`;
        return `<div data-layer="${escapeHtml(ensured.id)}" style="${box}"><span style="${innerSpan}">${resolved.html}</span></div>`;
      }
      if (resolved.kind === 'image' || resolved.kind === 'html') {
        return `<div data-layer="${escapeHtml(ensured.id)}" style="${box}">${resolved.html}</div>`;
      }
      return `<div data-layer="${escapeHtml(ensured.id)}" style="${box}"></div>`;
    })
    .join('\n');

  const fontLinks = googleFontsHeadHtml(collectGoogleFontFamilies(contentLayers));

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(document.name)}</title>
${fontLinks ? `${fontLinks}\n` : ''}<style>
  @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${pageW};
    height: ${pageH};
    margin: 0;
    background: #fff;
    font-family: ${DEFAULT_LAYER_FONT};
    letter-spacing: normal;
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
