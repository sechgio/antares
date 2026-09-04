import { ensurePdfJs } from '../../../lib/pdfjs';
import {
  DEFAULT_PDF_IMPORT_LIMITS,
  assertPdfFileSize,
  normalizePdfPageRange,
  resolvePdfImportLimits,
} from './pdfImportLimits';
import type { PdfImportLimits } from './pdfImportLimits';
import {
  parsePdfColor,
  transformedBounds,
} from './pdfGeometry';
import type {
  PdfBox,
  PdfDocumentExtraction,
  PdfImageAsset,
  PdfImportIssue,
  PdfImportOptions,
  PdfMatrix,
  PdfPageExtraction,
  PdfPathPoint,
  PdfPrimitive,
  PdfUnsupportedReason,
} from './pdfImportTypes';

type PdfRecord = Record<string, unknown>;
type PdfOperatorList = { fnArray?: unknown[]; argsArray?: unknown[][] };

const IDENTITY: PdfMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function asRecord(value: unknown): PdfRecord {
  return value && typeof value === 'object' ? (value as PdfRecord) : {};
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function numberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => finiteNumber(item));
}

function matrixFrom(value: unknown, fallback = IDENTITY): PdfMatrix {
  const values = numberArray(value);
  if (values.length < 6) return { ...fallback };
  return {
    a: values[0]!,
    b: values[1]!,
    c: values[2]!,
    d: values[3]!,
    e: values[4]!,
    f: values[5]!,
  };
}

function multiplyMatrix(left: PdfMatrix, right: PdfMatrix): PdfMatrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function transformPoint(matrix: PdfMatrix, point: PdfPathPoint): PdfPathPoint {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

function boxFromPoints(points: PdfPathPoint[]): PdfBox | undefined {
  if (!points.length) return undefined;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function normalizePdfRect(value: unknown): PdfBox | undefined {
  const values = numberArray(value);
  if (values.length < 4) return undefined;
  const x0 = Math.min(values[0]!, values[2]!);
  const y0 = Math.min(values[1]!, values[3]!);
  const x1 = Math.max(values[0]!, values[2]!);
  const y1 = Math.max(values[1]!, values[3]!);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function colorFromArgs(value: unknown, colorSpace: 'rgb' | 'gray' | 'cmyk'): string | undefined {
  const values = numberArray(value);
  if (colorSpace === 'gray') return parsePdfColor(values.slice(0, 1));
  if (colorSpace === 'rgb') return parsePdfColor(values.slice(0, 3));
  if (values.length < 4) return undefined;
  const [c, m, y, k] = values;
  return `#${Math.round((1 - Math.min(1, c! + k!)) * 255).toString(16).padStart(2, '0')}${Math.round((1 - Math.min(1, m! + k!)) * 255).toString(16).padStart(2, '0')}${Math.round((1 - Math.min(1, y! + k!)) * 255).toString(16).padStart(2, '0')}`.toUpperCase();
}

function bytesFrom(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
    return Uint8Array.from(value as number[]);
  }
  return null;
}

function dataUrlBytes(value: string): { bytes: Uint8Array; mimeType: string } | null {
  const match = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  const mimeType = match[1] || 'application/octet-stream';
  try {
    if (match[2]) {
      const binary = atob(match[3] || '');
      return {
        bytes: Uint8Array.from(binary, (char) => char.charCodeAt(0)),
        mimeType,
      };
    }
    return { bytes: new TextEncoder().encode(decodeURIComponent(match[3] || '')), mimeType };
  } catch {
    return null;
  }
}

async function encodeRgbaPng(data: Uint8Array, width: number, height: number): Promise<Uint8Array | null> {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      return new Uint8Array(await blob.arrayBuffer());
    }
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

async function resolvePdfImage(page: unknown, reference: unknown): Promise<unknown> {
  const pageRecord = asRecord(page);
  const objects = asRecord(pageRecord.objs);
  const get = typeof objects.get === 'function' ? objects.get.bind(objects) : null;
  if (!get) return reference;
  const imageId = typeof reference === 'string' ? reference : asRecord(reference).id;
  try {
    const direct = (get as (id: unknown) => unknown)(imageId);
    if (direct) return direct;
  } catch {
  }
  if (imageId === undefined) return reference;
  return new Promise((resolve) => {
    try {
      (get as (id: unknown, callback: (value: unknown) => void) => void)(imageId, resolve);
    } catch {
      resolve(reference);
    }
  });
}

async function imageAssetFromObject(
  page: unknown,
  rawReference: unknown,
  key: string,
): Promise<PdfImageAsset | null> {
  const image = asRecord(await resolvePdfImage(page, rawReference));
  const widthPx = Math.max(1, Math.round(finiteNumber(image.width ?? image.w)));
  const heightPx = Math.max(1, Math.round(finiteNumber(image.height ?? image.h)));
  const rawMime = typeof image.mimeType === 'string' ? image.mimeType : typeof image.type === 'string' ? image.type : '';

  const directDataUrl = typeof image.src === 'string' ? dataUrlBytes(image.src) : null;
  if (directDataUrl) {
    return { key, bytes: directDataUrl.bytes, mimeType: directDataUrl.mimeType, widthPx, heightPx };
  }

  const encoded = bytesFrom(image.bytes);
  if (encoded && rawMime.startsWith('image/')) {
    return { key, bytes: encoded, mimeType: rawMime, widthPx, heightPx };
  }

  const data = bytesFrom(image.data);
  if (!data || !widthPx || !heightPx) return null;
  if (rawMime.startsWith('image/')) {
    return { key, bytes: data, mimeType: rawMime, widthPx, heightPx };
  }
  if (data.byteLength !== widthPx * heightPx * 4) return null;
  const png = await encodeRgbaPng(data, widthPx, heightPx);
  return png ? { key, bytes: png, mimeType: 'image/png', widthPx, heightPx } : null;
}

function operatorNames(ops: unknown): Map<number, string> {
  const result = new Map<number, string>();
  for (const [name, code] of Object.entries(asRecord(ops))) {
    if (typeof code === 'number') result.set(code, name);
  }
  return result;
}

function opName(value: unknown, names: Map<number, string>): string {
  if (typeof value === 'string') return value;
  return typeof value === 'number' ? names.get(value) || `operator-${value}` : 'operator-unknown';
}

function abortError(): DOMException {
  return new DOMException('PDF import cancelled', 'AbortError');
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function addIssue(
  issueMap: Map<PdfUnsupportedReason, PdfImportIssue>,
  pageNumber: number,
  reason: PdfUnsupportedReason,
  message: string,
  count = 1,
): void {
  const current = issueMap.get(reason);
  if (current) current.count += count;
  else issueMap.set(reason, { pageNumber, reason, message, count });
}

function unsupportedPrimitive(
  pageNumber: number,
  reason: PdfUnsupportedReason,
  message: string,
  issueMap: Map<PdfUnsupportedReason, PdfImportIssue>,
  box?: PdfBox,
): PdfPrimitive {
  addIssue(issueMap, pageNumber, reason, message);
  return { kind: 'unsupported', box, reason, sourceOpCount: 1 };
}

function isPaintOperation(name: string): { fill: boolean; stroke: boolean } | null {
  if (name === 'fill' || name === 'eoFill') return { fill: true, stroke: false };
  if (name === 'stroke' || name === 'closeStroke') return { fill: false, stroke: true };
  if (name === 'fillStroke' || name === 'eoFillStroke') return { fill: true, stroke: true };
  return null;
}

interface RectCandidate {
  box: PdfBox;
  matrix: PdfMatrix;
}

interface GraphicsState {
  matrix: PdfMatrix;
  fill?: string;
  stroke?: string;
  lineWidth: number;
  rects: RectCandidate[];
  path: PdfPathPoint[];
  hasCurve: boolean;
}

function emptyGraphicsState(): GraphicsState {
  return { matrix: { ...IDENTITY }, lineWidth: 1, rects: [], path: [], hasCurve: false };
}

function matrixBox(box: PdfBox, matrix: PdfMatrix): { box: PdfBox; rotationDeg: number } | null {
  const bounds = transformedBounds(box, matrix);
  return bounds ? { box: bounds.box, rotationDeg: bounds.rotationDeg } : null;
}

async function extractOperators(
  pageNumber: number,
  page: unknown,
  operatorList: PdfOperatorList,
  pdfjs: typeof import('pdfjs-dist'),
  limits: PdfImportLimits,
): Promise<{ primitives: PdfPrimitive[]; warnings: string[]; issues: PdfImportIssue[] }> {
  const functions = Array.isArray(operatorList.fnArray) ? operatorList.fnArray : [];
  const argsArray = Array.isArray(operatorList.argsArray) ? operatorList.argsArray : [];
  const names = operatorNames(pdfjs.OPS);
  const primitives: PdfPrimitive[] = [];
  const warnings: string[] = [];
  const issueMap = new Map<PdfUnsupportedReason, PdfImportIssue>();
  const stack: GraphicsState[] = [];
  let state = emptyGraphicsState();
  let imageCount = 0;

  for (let index = 0; index < functions.length; index += 1) {
    const name = opName(functions[index], names);
    const args = argsArray[index] || [];
    const values = numberArray(args);

    if (name === 'save') {
      stack.push({ ...state, matrix: { ...state.matrix }, rects: [], path: [], hasCurve: false });
      continue;
    }
    if (name === 'restore') {
      state = stack.pop() || emptyGraphicsState();
      continue;
    }
    if (name === 'transform') {
      state.matrix = multiplyMatrix(state.matrix, matrixFrom(args));
      continue;
    }
    if (name === 'setFillRGBColor') state.fill = colorFromArgs(args, 'rgb');
    else if (name === 'setFillGray') state.fill = colorFromArgs(args, 'gray');
    else if (name === 'setFillCMYKColor') state.fill = colorFromArgs(args, 'cmyk');
    else if (name === 'setStrokeRGBColor') state.stroke = colorFromArgs(args, 'rgb');
    else if (name === 'setStrokeGray') state.stroke = colorFromArgs(args, 'gray');
    else if (name === 'setStrokeCMYKColor') state.stroke = colorFromArgs(args, 'cmyk');
    else if (name === 'setLineWidth') state.lineWidth = Math.max(0, values[0] || 0);
    else if (name === 'rectangle') {
      const transformed = matrixBox(
        { x: values[0] || 0, y: values[1] || 0, width: Math.abs(values[2] || 0), height: Math.abs(values[3] || 0) },
        state.matrix,
      );
      if (transformed) state.rects.push({ box: transformed.box, matrix: state.matrix });
      else primitives.push(unsupportedPrimitive(pageNumber, 'complex-path', 'Rectángulo con transformación no editable', issueMap));
    } else if (name === 'moveTo') {
      state.path.push(transformPoint(state.matrix, { x: values[0] || 0, y: values[1] || 0 }));
    } else if (name === 'lineTo') {
      state.path.push(transformPoint(state.matrix, { x: values[0] || 0, y: values[1] || 0 }));
    } else if (name === 'curveTo' || name === 'curveTo2' || name === 'curveTo3' || name === 'constructPath') {
      state.hasCurve = true;
    } else if (name === 'closePath') {
      if (state.path.length > 0) state.path.push({ ...state.path[0]! });
    } else if (name === 'endPath') {
      state.path = [];
      state.rects = [];
      state.hasCurve = false;
    } else if (name === 'setGState') {
      primitives.push(unsupportedPrimitive(pageNumber, 'transparency', 'Estado gráfico no editable (posible transparencia)', issueMap));
    } else if (name === 'clip' || name === 'eoClip' || name === 'transformClip') {
      primitives.push(unsupportedPrimitive(pageNumber, 'clipping', 'Máscara o clipping no editable', issueMap));
    } else if (name === 'paintImageMaskXObject' || name === 'paintImageMaskXObjectRepeat' || name === 'paintSolidColorImageMask') {
      primitives.push(unsupportedPrimitive(pageNumber, 'unsupported-operator', 'Máscara de imagen PDF no editable', issueMap));
    } else if (name.startsWith('paintImage') || name === 'paintInlineImageXObject') {
      imageCount += 1;
      if (imageCount > limits.maxImagesPerPage) {
        primitives.push(unsupportedPrimitive(pageNumber, 'limit-exceeded', 'La página supera el límite de imágenes', issueMap));
        continue;
      }
      const asset = await imageAssetFromObject(page, args[0], `page-${pageNumber}-image-${index}`);
      const placement = matrixBox({ x: 0, y: 0, width: 1, height: 1 }, state.matrix);
      if (!asset || !placement) {
        primitives.push(unsupportedPrimitive(pageNumber, 'unsupported-operator', 'Imagen PDF no disponible como asset editable', issueMap));
      } else if (asset.bytes.byteLength > limits.maxImageBytesTotal) {
        primitives.push(unsupportedPrimitive(pageNumber, 'limit-exceeded', 'Imagen PDF supera el presupuesto de bytes', issueMap));
      } else {
        primitives.push({ kind: 'image', box: placement.box, asset, rotationDeg: placement.rotationDeg });
      }
    } else {
      const paint = isPaintOperation(name);
      if (paint) {
        for (const candidate of state.rects) {
          primitives.push({
            kind: 'rect',
            box: candidate.box,
            fill: paint.fill ? state.fill : undefined,
            stroke: paint.stroke ? state.stroke : undefined,
            strokeWidthPt: paint.stroke ? state.lineWidth : undefined,
          });
        }
        if (!state.rects.length && state.path.length) {
          if (state.hasCurve || paint.fill || state.path.length !== 2) {
            primitives.push(unsupportedPrimitive(pageNumber, 'complex-path', 'Path PDF complejo no editable', issueMap, boxFromPoints(state.path)));
          } else {
            primitives.push({
              kind: 'line',
              box: boxFromPoints(state.path) || { x: 0, y: 0, width: 0, height: 0 },
              points: state.path,
              stroke: state.stroke,
              strokeWidthPt: state.lineWidth,
            });
          }
        }
        state.rects = [];
        state.path = [];
        state.hasCurve = false;
      } else if (
        !name.startsWith('begin') &&
        !name.startsWith('end') &&
        !['setFont', 'setTextMatrix', 'setCharSpacing', 'setWordSpacing', 'setHScale', 'setLeading', 'setTextRise', 'moveText', 'showText', 'showSpacedText', 'nextLine', 'dependency', 'setStrokeColorN', 'setFillColorN'].includes(name)
      ) {
        warnings.push(`Página ${pageNumber}: operador ${name} no importado`);
        primitives.push(unsupportedPrimitive(pageNumber, 'unsupported-operator', `Operador PDF no soportado: ${name}`, issueMap));
      }
    }
  }

  return { primitives, warnings, issues: [...issueMap.values()] };
}

function extractText(
  pageNumber: number,
  textContent: unknown,
  limits: PdfImportLimits,
): { primitives: PdfPrimitive[]; warnings: string[]; issues: PdfImportIssue[] } {
  const content = asRecord(textContent);
  const items = Array.isArray(content.items) ? content.items : [];
  const styles = asRecord(content.styles);
  const primitives: PdfPrimitive[] = [];
  const warnings: string[] = [];
  const issues: PdfImportIssue[] = [];
  const take = Math.min(items.length, limits.maxTextItemsPerPage);
  for (let index = 0; index < take; index += 1) {
    const item = asRecord(items[index]);
    const text = typeof item.str === 'string' ? item.str : '';
    if (!text) continue;
    const transform = matrixFrom(item.transform);
    const fontSizePt = Math.max(1, Math.hypot(transform.a, transform.b));
    const bounds = transformedBounds(
      { x: 0, y: 0, width: Math.max(0, finiteNumber(item.width, fontSizePt)), height: Math.max(1, finiteNumber(item.height, fontSizePt)) },
      transform,
    );
    if (!bounds) {
      issues.push({ pageNumber, reason: 'font-outline', message: 'Texto con transformación no editable', count: 1 });
      continue;
    }
    const style = asRecord(styles[String(item.fontName || '')]);
    primitives.push({
      kind: 'text',
      box: bounds.box,
      transform,
      text,
      fontFamily: typeof style.fontFamily === 'string' ? style.fontFamily : undefined,
      fontSizePt,
      color: '#000000',
      fontWeight: typeof style.fontWeight === 'string' ? style.fontWeight : undefined,
      fontStyle: typeof style.fontStyle === 'string' ? style.fontStyle : undefined,
    });
  }
  if (items.length > take) {
    const issue = { pageNumber, reason: 'limit-exceeded' as const, message: 'La página supera el límite de elementos de texto', count: items.length - take };
    issues.push(issue);
    warnings.push(`Página ${pageNumber}: se omitieron ${issue.count} elementos de texto por límite`);
  }
  return { primitives, warnings, issues };
}

function extractAnnotations(
  pageNumber: number,
  annotations: unknown,
): { primitives: PdfPrimitive[]; warnings: string[]; issues: PdfImportIssue[] } {
  const list = Array.isArray(annotations) ? annotations : [];
  const primitives: PdfPrimitive[] = [];
  const warnings: string[] = [];
  const issues: PdfImportIssue[] = [];
  for (const raw of list) {
    const annotation = asRecord(raw);
    const box = normalizePdfRect(annotation.rect);
    if (annotation.subtype !== 'Widget') continue;
    const isButton = annotation.fieldType === 'Btn';
    const flags = finiteNumber(annotation.fieldFlags);
    const isCheckbox = annotation.checkBox === true || (isButton && (flags & (1 << 16)) === 0 && (flags & (1 << 17)) === 0);
    if (!isCheckbox || !box) {
      issues.push({ pageNumber, reason: 'unsupported-operator', message: 'Widget PDF no reconocido como checkbox', count: 1 });
      continue;
    }
    const value = annotation.fieldValue ?? annotation.buttonValue ?? annotation.exportValue;
    const checked = value !== undefined && value !== false && value !== 'Off' && value !== 'off' && value !== '';
    primitives.push({
      kind: 'checkbox',
      box,
      checked,
      label: typeof annotation.fieldName === 'string' ? annotation.fieldName : undefined,
    });
  }
  if (issues.length) warnings.push(`Página ${pageNumber}: hay widgets no editables`);
  return { primitives, warnings, issues };
}

function mergeIssues(...groups: PdfImportIssue[][]): PdfImportIssue[] {
  const merged = new Map<PdfUnsupportedReason, PdfImportIssue>();
  for (const group of groups) {
    for (const issue of group) {
      const current = merged.get(issue.reason);
      if (current) current.count += issue.count;
      else merged.set(issue.reason, { ...issue });
    }
  }
  return [...merged.values()];
}

function bytesFromAttachment(value: unknown): Uint8Array | undefined {
  const bytes = bytesFrom(value);
  return bytes ? new Uint8Array(bytes) : undefined;
}

export function readCanvasManifestAttachment(
  attachments: unknown,
  maxBytes = DEFAULT_PDF_IMPORT_LIMITS.maxManifestBytes,
): Uint8Array | undefined {
  if (!attachments || typeof attachments !== 'object') return undefined;
  const entries = Object.entries(attachments as Record<string, unknown>);
  for (const [name, raw] of entries) {
    const attachment = asRecord(raw);
    const filename = typeof attachment.filename === 'string' ? attachment.filename : name;
    if (filename !== 'antares-canvas-manifest.json' && name !== 'antares-canvas-manifest.json') continue;
    const bytes = bytesFromAttachment(attachment.content ?? attachment.bytes ?? raw);
    if (bytes && bytes.byteLength <= maxBytes) return bytes;
    return undefined;
  }
  return undefined;
}

async function extractPage(
  pageNumber: number,
  page: unknown,
  pdfjs: typeof import('pdfjs-dist'),
  limits: PdfImportLimits,
): Promise<PdfPageExtraction> {
  const pageRecord = asRecord(page);
  const viewport = typeof pageRecord.getViewport === 'function'
    ? (pageRecord.getViewport as (options: { scale: number }) => { width: number; height: number }).call(page, { scale: 1 })
    : { width: 0, height: 0 };
  const getOperatorList = pageRecord.getOperatorList;
  const getTextContent = pageRecord.getTextContent;
  const getAnnotations = pageRecord.getAnnotations;
  const operatorList = typeof getOperatorList === 'function'
    ? await (getOperatorList as () => Promise<PdfOperatorList>).call(page)
    : { fnArray: [], argsArray: [] };
  const operatorCount = Array.isArray(operatorList.fnArray) ? operatorList.fnArray.length : 0;
  if (operatorCount > limits.maxOperatorsPerPage) {
    return {
      pageNumber,
      widthPt: finiteNumber(viewport.width),
      heightPt: finiteNumber(viewport.height),
      operators: operatorCount,
      primitives: [],
      warnings: [`Página ${pageNumber}: supera el límite de operadores`],
      issues: [{ pageNumber, reason: 'limit-exceeded', message: 'La página supera el límite de operadores', count: 1 }],
    };
  }
  const [textContent, annotations] = await Promise.all([
    typeof getTextContent === 'function' ? (getTextContent as () => Promise<unknown>).call(page) : Promise.resolve({ items: [], styles: {} }),
    typeof getAnnotations === 'function' ? (getAnnotations as (options: { intent: string }) => Promise<unknown>).call(page, { intent: 'display' }) : Promise.resolve([]),
  ]);
  const operatorResult = await extractOperators(pageNumber, page, operatorList, pdfjs, limits);
  const textResult = extractText(pageNumber, textContent, limits);
  const annotationResult = extractAnnotations(pageNumber, annotations);
  return {
    pageNumber,
    widthPt: finiteNumber(viewport.width),
    heightPt: finiteNumber(viewport.height),
    operators: operatorCount,
    primitives: [...operatorResult.primitives, ...textResult.primitives, ...annotationResult.primitives],
    warnings: [...operatorResult.warnings, ...textResult.warnings, ...annotationResult.warnings],
    issues: mergeIssues(operatorResult.issues, textResult.issues, annotationResult.issues),
  };
}

export async function extractPdfDocument(
  bytes: Uint8Array,
  options: PdfImportOptions = {},
): Promise<PdfDocumentExtraction> {
  const limits = resolvePdfImportLimits(options.limits);
  assertPdfFileSize(bytes.byteLength, limits);
  throwIfAborted(options.signal);
  const pdfjs = await ensurePdfJs();
  throwIfAborted(options.signal);
  const loadingTask = pdfjs.getDocument({ data: bytes, stopAtErrors: true });
  const pdf = await loadingTask.promise;
  let range: { first: number; last: number };
  try {
    range = normalizePdfPageRange(pdf.numPages, options.pageStart, options.pageEnd);
  } catch (error) {
    try {
      await pdf.cleanup();
    } finally {
      await pdf.destroy();
    }
    throw error;
  }
  const { first, last } = range;
  if (last - first + 1 > limits.maxPages) {
    try {
      await pdf.cleanup();
    } finally {
      await pdf.destroy();
    }
    throw new Error(`El PDF supera el máximo de ${limits.maxPages} páginas`);
  }

  const pages: PdfPageExtraction[] = [];
  let manifestBytes: Uint8Array | undefined;
  try {
    const getAttachments = (pdf as unknown as PdfRecord).getAttachments;
    if (typeof getAttachments === 'function') {
      const attachments = await (getAttachments as () => Promise<unknown>).call(pdf);
      manifestBytes = readCanvasManifestAttachment(attachments, limits.maxManifestBytes);
    }
    if (manifestBytes && options.onManifest && await options.onManifest(manifestBytes)) {
      return { pages: [], manifestBytes };
    }
    for (let pageNumber = first; pageNumber <= last; pageNumber += 1) {
      throwIfAborted(options.signal);
      const page = await pdf.getPage(pageNumber);
      try {
        const extracted = await extractPage(pageNumber, page, pdfjs, limits);
        pages.push(extracted);
        const skipped = extracted.issues?.reduce((sum, issue) => sum + issue.count, 0) || 0;
        options.onProgress?.({
          stage: 'extracting',
          page: pageNumber - first + 1,
          totalPages: last - first + 1,
          layers: extracted.primitives.filter((item) => item.kind !== 'unsupported').length,
          skipped,
        });
      } finally {
        const cleanup = (page as unknown as PdfRecord).cleanup;
        if (typeof cleanup === 'function') (cleanup as () => void).call(page);
      }
      await yieldToMain();
    }
  } finally {
    await pdf.cleanup();
    await pdf.destroy();
  }
  return { pages, manifestBytes };
}
