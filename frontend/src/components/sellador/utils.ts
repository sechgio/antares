export interface StampPlacement {
  pageAssignments: number[];
  stampedPages: number[];
  seed: number;
}

export type StampCornerPreset =
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left'
  | 'top-center'
  | 'bottom-center';

export interface StampPosition {
  id: string;
  name: string;
  rect: StampRect;
}

export interface ResolvedStampPlacement {
  pageNum: number;
  rect: StampRect;
  stampIndex: number;
  positionIndex: number;
}

export type PositionAssignmentMode = 'cycle' | 'manual';

const MAX_STAMP_POSITIONS = 8;

export interface StampRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfPageSize {
  width: number;
  height: number;
}

export type StampDragMode = 'move' | 'resize' | null;

const MIN_STAMP_SIZE = 24;

export function clampStampRect(rect: StampRect, page: PdfPageSize): StampRect {
  const width = Math.max(MIN_STAMP_SIZE, Math.min(rect.width, page.width));
  const height = Math.max(MIN_STAMP_SIZE, Math.min(rect.height, page.height));
  const x = Math.max(0, Math.min(rect.x, page.width - width));
  const y = Math.max(0, Math.min(rect.y, page.height - height));
  return { x, y, width, height };
}

export function defaultStampRect(page: PdfPageSize, stampAspect: number): StampRect {
  const width = Math.max(MIN_STAMP_SIZE, page.width * 0.16);
  const height = width / stampAspect;
  const fittedHeight = height > page.height * 0.35 ? page.height * 0.35 : height;
  const fittedWidth = fittedHeight * stampAspect;
  return clampStampRect({
    x: page.width - fittedWidth - 36,
    y: page.height - fittedHeight - 36,
    width: fittedWidth,
    height: fittedHeight,
  }, page);
}

export function rectAtDropPoint(
  page: PdfPageSize,
  dropX: number,
  dropY: number,
  stampAspect: number,
  current?: StampRect | null,
): StampRect {
  const width = current?.width ?? Math.max(MIN_STAMP_SIZE, page.width * 0.16);
  const height = current?.height ?? width / stampAspect;
  return clampStampRect({
    x: dropX - width / 2,
    y: dropY - height / 2,
    width,
    height,
  }, page);
}

function lcgNext(state: number): number {
  return (Math.imul(1664525, state) + 1013904223) >>> 0;
}

export function effectiveStampCount(numPages: number, stampCount: number): number {
  if (numPages <= 0 || stampCount <= 0) return 0;
  return Math.min(stampCount, numPages);
}

export function distributeStampPages(numPages: number, stampCount: number, seed: number): number[] {
  const count = effectiveStampCount(numPages, stampCount);
  if (count <= 0) return [];
  const indices = Array.from({ length: numPages }, (_, i) => i);
  let state = seed >>> 0;
  for (let i = numPages - 1; i > 0; i -= 1) {
    state = lcgNext(state);
    const j = state % (i + 1);
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
  }
  return indices.slice(0, count);
}

export function buildStampPlacement(numPages: number, stampCount: number, seed: number): StampPlacement {
  const zeroBased = distributeStampPages(numPages, stampCount, seed);
  const pageAssignments = zeroBased.map((page) => page + 1);
  const stampedPages = [...pageAssignments].sort((a, b) => a - b);
  return { pageAssignments, stampedPages, seed };
}

export function countAssignments(pageAssignments: number[]): Map<number, number> {
  const counts = new Map<number, number>();
  pageAssignments.forEach((page) => {
    counts.set(page, (counts.get(page) ?? 0) + 1);
  });
  return counts;
}

export async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

export function stripPdfExtension(name: string): string {
  return name.replace(/\.pdf$/i, '');
}

export function createPositionId(): string {
  return `pos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createStampPosition(
  index: number,
  rect: StampRect,
): StampPosition {
  return { id: createPositionId(), name: `Posición ${index}`, rect };
}

export function presetStampRect(
  page: PdfPageSize,
  stampAspect: number,
  preset: StampCornerPreset,
  sizeFrom?: StampRect | null,
): StampRect {
  const ref = sizeFrom ?? defaultStampRect(page, stampAspect);
  const margin = 28;
  let x = margin;
  let y = margin;
  if (preset.includes('right')) x = page.width - ref.width - margin;
  if (preset.includes('center') && preset.includes('top')) {
    x = (page.width - ref.width) / 2;
    y = margin;
  } else if (preset.includes('center') && preset.includes('bottom')) {
    x = (page.width - ref.width) / 2;
    y = page.height - ref.height - margin;
  } else if (preset.includes('bottom')) {
    y = page.height - ref.height - margin;
  }
  return clampStampRect({ ...ref, x, y }, page);
}

export function ensureSlotIndices(
  stampCount: number,
  current: number[],
  positionCount: number,
): number[] {
  if (positionCount <= 0) return [];
  const next: number[] = [];
  for (let i = 0; i < stampCount; i += 1) {
    next.push(current[i] ?? i % positionCount);
  }
  return next.map((slot) => Math.max(0, Math.min(slot, positionCount - 1)));
}

export function buildResolvedPlacements(
  pageAssignments: number[],
  positions: StampPosition[],
  slotIndices: number[],
): ResolvedStampPlacement[] {
  if (positions.length === 0 || pageAssignments.length === 0) return [];
  const seenPages = new Set<number>();
  return pageAssignments.map((pageNum, stampIndex) => {
    if (seenPages.has(pageNum)) {
      throw new Error(`Solo un sello por página (duplicado: ${pageNum})`);
    }
    seenPages.add(pageNum);
    const positionIndex = slotIndices[stampIndex] ?? stampIndex % positions.length;
    const safeIndex = Math.max(0, Math.min(positionIndex, positions.length - 1));
    const rect = positions[safeIndex].rect;
    return {
      pageNum,
      rect: { ...rect },
      stampIndex,
      positionIndex: safeIndex,
    };
  });
}

export function toBackendStampPlacements(
  resolved: ResolvedStampPlacement[],
): Array<{ page_index: number; x: number; y: number; width: number; height: number }> {
  return resolved.map((item) => ({
    page_index: item.pageNum - 1,
    x: item.rect.x,
    y: item.rect.y,
    width: item.rect.width,
    height: item.rect.height,
  }));
}

export function groupPlacementsByPage(
  resolved: ResolvedStampPlacement[],
): Map<number, StampRect[]> {
  const map = new Map<number, StampRect[]>();
  resolved.forEach((item) => {
    const list = map.get(item.pageNum) ?? [];
    list.push(item.rect);
    map.set(item.pageNum, list);
  });
  return map;
}

export const MAX_STAMP_POSITIONS_LIMIT = MAX_STAMP_POSITIONS;
