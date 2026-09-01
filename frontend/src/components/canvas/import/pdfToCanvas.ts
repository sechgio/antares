import { createLayer } from '../constants';
import {
  getPageCount,
} from '../ops/pages';
import { mm, newId, normalizeDocument, type CanvasDocument, type CanvasLayer } from '../types';
import { resolvePdfImportLimits } from './pdfImportLimits';
import type { PdfImportLimits } from './pdfImportLimits';
import {
  pdfBoxToCanvasBox,
  pdfPointsToMm,
} from './pdfGeometry';
import type {
  PdfCanvasFragment,
  PdfImportIssue,
  PdfPageExtraction,
  PdfPrimitive,
} from './pdfImportTypes';

export type { PdfCanvasFragment } from './pdfImportTypes';

export interface PdfToCanvasOptions {
  limits?: Partial<PdfImportLimits>;
  mixedPagePolicy?: 'reject' | 'scale-to-first';
  assetValues?: ReadonlyMap<string, string>;
}

interface PageScale {
  widthPt: number;
  heightPt: number;
  factor: number;
  sourceWidthPt: number;
  sourceHeightPt: number;
}

function pageList(pageOrPages: PdfPageExtraction | PdfPageExtraction[]): PdfPageExtraction[] {
  return Array.isArray(pageOrPages) ? pageOrPages : [pageOrPages];
}

function samePageSize(a: PdfPageExtraction, b: PdfPageExtraction): boolean {
  return Math.abs(a.widthPt - b.widthPt) < 0.01 && Math.abs(a.heightPt - b.heightPt) < 0.01;
}

function pageScales(pages: PdfPageExtraction[], policy: 'reject' | 'scale-to-first'): PageScale[] {
  const first = pages[0];
  if (!first) return [];
  const mixed = pages.some((page) => !samePageSize(first, page));
  if (mixed && policy === 'reject') {
    const pagesWithDifferentSize = pages
      .filter((page) => !samePageSize(first, page))
      .map((page) => page.pageNumber)
      .join(', ');
    throw new Error(`El PDF tiene tamaños de página incompatibles: ${pagesWithDifferentSize}`);
  }
  return pages.map((page) => {
    if (!mixed || policy === 'reject') {
      return {
        widthPt: page.widthPt,
        heightPt: page.heightPt,
        factor: 1,
        sourceWidthPt: page.widthPt,
        sourceHeightPt: page.heightPt,
      };
    }
    const factor = Math.min(first.widthPt / page.widthPt, first.heightPt / page.heightPt);
    return {
      widthPt: first.widthPt,
      heightPt: first.heightPt,
      factor: Number.isFinite(factor) && factor > 0 ? factor : 1,
      sourceWidthPt: page.widthPt,
      sourceHeightPt: page.heightPt,
    };
  });
}

function scaledBox(box: { x: number; y: number; width: number; height: number }, factor: number) {
  return {
    x: box.x * factor,
    y: box.y * factor,
    width: box.width * factor,
    height: box.height * factor,
  };
}

function cssBox(
  box: { x: number; y: number; width: number; height: number },
  page: PageScale,
): { xMm: number; yMm: number; widthMm: number; heightMm: number } {
  return pdfBoxToCanvasBox(scaledBox(box, page.factor), {
    widthPt: page.widthPt,
    heightPt: page.heightPt,
  });
}

function baseVars(box: { xMm: number; yMm: number; widthMm: number; heightMm: number }) {
  return {
    '--width': mm(Math.max(0.01, box.widthMm)),
    '--height': mm(Math.max(0.01, box.heightMm)),
    '--translate-x': mm(box.xMm),
    '--translate-y': mm(box.yMm),
  };
}

function strokeWidthPtToPx(widthPt: number | undefined): number {
  const pt = Number.isFinite(widthPt) ? Math.max(0, widthPt || 0) : 0;
  return Math.max(0.25, (pt * 96) / 72);
}

function issueForUnsupported(page: PdfPageExtraction, primitive: Extract<PdfPrimitive, { kind: 'unsupported' }>): PdfImportIssue {
  return {
    pageNumber: page.pageNumber,
    reason: primitive.reason,
    message: `Contenido no importado: ${primitive.reason}`,
    count: 1,
  };
}

function addIssue(issues: PdfImportIssue[], issue: PdfImportIssue): void {
  const current = issues.find((item) => item.reason === issue.reason && item.pageNumber === issue.pageNumber);
  if (current) current.count += issue.count;
  else issues.push(issue);
}

function linePath(
  primitive: Extract<PdfPrimitive, { kind: 'line' }>,
  page: PageScale,
): Array<{ x: number; y: number }> {
  const sourceBox = scaledBox(primitive.box, page.factor);
  return primitive.points.map((point) => ({
    x: pdfPointsToMm((point.x * page.factor) - sourceBox.x),
    y: pdfPointsToMm((sourceBox.y + sourceBox.height) - (point.y * page.factor)),
  }));
}

function layerFromPrimitive(
  primitive: PdfPrimitive,
  pageScale: PageScale,
  assetValues: ReadonlyMap<string, string>,
): CanvasLayer | null {
  if (primitive.kind === 'unsupported') return null;
  const box = cssBox(primitive.box, pageScale);
  if (primitive.kind === 'text') {
    return {
      ...createLayer('text'),
      id: newId(),
      name: 'Texto PDF',
      value: primitive.text,
      pageIndex: 0,
      cssVars: {
        ...baseVars(box),
        '--color': primitive.color || '#000000',
        '--font-size': `${Math.max(1, primitive.fontSizePt * pageScale.factor)}pt`,
        '--font-family': primitive.fontFamily || 'Arial, sans-serif',
        '--font-weight': primitive.fontWeight || '400',
        '--font-style': primitive.fontStyle || 'normal',
        '--text-align': primitive.textAlign || 'left',
        '--background-color': 'transparent',
        ...(Math.abs(primitive.transform.b) > 1e-6 ? { '--rotate': `${Math.atan2(primitive.transform.b, primitive.transform.a) * 180 / Math.PI}deg` } : {}),
      },
    };
  }
  if (primitive.kind === 'rect' || primitive.kind === 'ellipse') {
    return {
      ...createLayer(primitive.kind),
      id: newId(),
      name: primitive.kind === 'rect' ? 'Rectángulo PDF' : 'Elipse PDF',
      value: '',
      pageIndex: 0,
      cssVars: {
        ...baseVars(box),
        '--background-color': primitive.fill || 'transparent',
        '--border-width': primitive.stroke ? `${strokeWidthPtToPx(primitive.strokeWidthPt)}px` : '0px',
        '--border-color': primitive.stroke || 'transparent',
        ...(primitive.kind === 'ellipse' ? { '--border-radius': '50%' } : {}),
        ...(primitive.rotationDeg ? { '--rotate': `${primitive.rotationDeg}deg` } : {}),
      },
    };
  }
  if (primitive.kind === 'line') {
    const points = linePath(primitive, pageScale);
    return {
      ...createLayer('line'),
      id: newId(),
      name: 'Línea PDF',
      value: '',
      pageIndex: 0,
      cssVars: {
        ...baseVars(box),
        '--background-color': 'transparent',
        '--fill-visible': '0',
        '--border-width': `${strokeWidthPtToPx(primitive.strokeWidthPt)}px`,
        '--border-color': primitive.stroke || '#000000',
        '--stroke-visible': '1',
      },
      meta: { path: { points, closed: false } },
    };
  }
  if (primitive.kind === 'checkbox') {
    return {
      ...createLayer('checkbox'),
      id: newId(),
      name: primitive.label || 'Checkbox PDF',
      value: '',
      pageIndex: 0,
      cssVars: {
        ...baseVars(box),
        '--background-color': '#ffffff',
        '--border-width': '1px',
        '--border-color': '#000000',
      },
      meta: { checked: primitive.checked },
    };
  }
  if (primitive.kind === 'image') {
    const liveValue = assetValues.get(primitive.asset.key) || primitive.asset.key;
    return {
      ...createLayer('image'),
      id: newId(),
      name: 'Imagen PDF',
      value: liveValue,
      pageIndex: 0,
      cssVars: {
        ...baseVars(box),
        '--object-fit': 'contain',
        '--background-color': 'transparent',
        ...(primitive.rotationDeg ? { '--rotate': `${primitive.rotationDeg}deg` } : {}),
      },
    };
  }
  return null;
}

function pageFrame(page: PdfPageExtraction, pageScale: PageScale): CanvasLayer {
  return {
    id: newId(),
    type: 'frame',
    name: `PDF Página ${page.pageNumber}`,
    value: '',
    locked: true,
    pageIndex: 0,
    cssVars: {
      '--width': mm(pdfPointsToMm(pageScale.widthPt)),
      '--height': mm(pdfPointsToMm(pageScale.heightPt)),
      '--translate-x': '0mm',
      '--translate-y': '0mm',
      '--background-color': '#ffffff',
    },
  };
}

export function mapPdfPagesToCanvas(
  pageOrPages: PdfPageExtraction | PdfPageExtraction[],
  options: PdfToCanvasOptions = {},
): PdfCanvasFragment {
  const pages = pageList(pageOrPages);
  const limits = resolvePdfImportLimits(options.limits);
  const policy = options.mixedPagePolicy || 'reject';
  const scales = pageScales(pages, policy);
  const layers: CanvasLayer[] = [];
  const importedLayerIds: string[] = [];
  const fields: PdfCanvasFragment['fields'] = [];
  const issues: PdfImportIssue[] = [];
  const warnings: string[] = [];
  let importedCount = 0;
  let skippedCount = 0;

  pages.forEach((page, pageOffset) => {
    const pageScale = scales[pageOffset]!;
    const frame = pageFrame(page, pageScale);
    frame.pageIndex = pageOffset;
    layers.push(frame);
    warnings.push(...page.warnings);
    for (const issue of page.issues || []) addIssue(issues, issue);
    const reportedReasons = new Set((page.issues || []).map((issue) => issue.reason));
    if (pageOffset > 0 && !samePageSize(pages[0]!, page)) {
      addIssue(issues, {
        pageNumber: page.pageNumber,
        reason: 'mixed-page-size',
        message: 'La página fue escalada al tamaño de la primera página',
        count: 1,
      });
    }
    let pageLayerCount = 0;
    for (const primitive of page.primitives) {
      if (primitive.kind === 'unsupported') {
        skippedCount += 1;
        if (!reportedReasons.has(primitive.reason)) {
          addIssue(issues, issueForUnsupported(page, primitive));
        }
        continue;
      }
      if (pageLayerCount >= limits.maxLayersPerPage || importedCount >= limits.maxLayersTotal) {
        skippedCount += 1;
        addIssue(issues, {
          pageNumber: page.pageNumber,
          reason: 'limit-exceeded',
          message: 'Se alcanzó el límite de capas importables',
          count: 1,
        });
        continue;
      }
      const layer = layerFromPrimitive(primitive, pageScale, options.assetValues || new Map());
      if (!layer) {
        skippedCount += 1;
        continue;
      }
      layer.pageIndex = pageOffset;
      layers.push(layer);
      importedLayerIds.push(layer.id);
      importedCount += 1;
      pageLayerCount += 1;
    }
  });

  const report = {
    importedCount,
    skippedCount,
    pagesProcessed: pages.length,
    issues,
    warnings,
  };
  return {
    pages: pages.map((_, index) => ({ id: newId(), name: `PDF Página ${index + 1}` })),
    layers,
    fields,
    firstPageIndex: 0,
    importedLayerIds,
    report,
  };
}

export function appendPdfFragment(document: CanvasDocument, fragment: PdfCanvasFragment): CanvasDocument {
  const offset = getPageCount(document);
  const basePages = document.pages?.length
    ? [...document.pages]
    : [{ id: newId(), name: 'Página 1' }];
  const pages = [
    ...basePages,
    ...fragment.pages.map((page, index) => ({ ...page, name: `PDF ${offset + index + 1}` })),
  ];
  const layers = [
    ...document.layers,
    ...fragment.layers.map((layer) => ({ ...layer, pageIndex: (layer.pageIndex ?? 0) + offset })),
  ];
  return normalizeDocument({
    ...document,
    pages,
    layers,
    fields: [...document.fields, ...fragment.fields],
    styles: [...(document.styles || []), ...(fragment.styles || [])],
  });
}
