import {
  ASPECT_RATIO_OPTIONS,
  AspectRatio,
  BatchSettings,
  CropOffset,
  CropOrigin,
  CropRectangle,
  ImageItem,
  ImageStats,
  OutputFormat,
  PresetId,
  ProcessingPlan,
  ResizeDimensions,
} from './types';
import { PRESET_BY_ID, cloneBatchSettings } from './presets';

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getAspectRatioValue(ratio: AspectRatio): number | null {
  const option = ASPECT_RATIO_OPTIONS.find((item) => item.value === ratio);
  return option?.ratio ?? null;
}

export function getOutputMimeType(format: OutputFormat, originalType: string): string {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
    case 'bmp':
      return 'image/bmp';
    default:
      return originalType || 'image/jpeg';
  }
}

export function getExtensionForFormat(format: OutputFormat, originalName: string): string {
  const originalExtension = (originalName.split('.').pop() || 'jpg').toLowerCase();
  switch (format) {
    case 'jpeg':
      return 'jpg';
    case 'png':
      return 'png';
    case 'webp':
      return 'webp';
    case 'avif':
      return 'avif';
    case 'bmp':
      return 'bmp';
    default:
      return originalExtension;
  }
}

export function splitFilename(filename: string): { base: string; extension: string } {
  const sanitized = filename.trim().replace(/[\\/:*?"<>|]+/g, '-');
  const match = sanitized.match(/^(.*?)(?:\.([^.]+))?$/);
  const base = (match?.[1] || 'archivo').trim() || 'archivo';
  const extension = (match?.[2] || '').trim();
  return { base, extension };
}

function buildSequentialFilename(prefix: string, sequence: number, total: number, extension: string): string {
  const safePrefix = prefix.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_') || 'archivo';
  const digits = Math.max(3, String(total).length, String(sequence).length);
  const padded = String(sequence).padStart(digits, '0');
  return `${safePrefix}_${padded}.${extension}`;
}

export function computeResizeDimensions(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
  noUpscale = true,
): ResizeDimensions {
  if (width <= 0 || height <= 0) {
    return { width: 0, height: 0, scale: 1 };
  }

  const safeMaxWidth = maxWidth > 0 ? maxWidth : width;
  const safeMaxHeight = maxHeight > 0 ? maxHeight : height;
  let scale = Math.min(safeMaxWidth / width, safeMaxHeight / height);

  if (!Number.isFinite(scale) || scale <= 0) {
    scale = 1;
  }

  if (noUpscale) {
    scale = Math.min(scale, 1);
  }

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

export function getCropRectangle(
  width: number,
  height: number,
  aspectRatio: AspectRatio,
  offset?: CropOffset,
  cropOrigin: CropOrigin = 'bottom',
): CropRectangle | null {
  const ratio = getAspectRatioValue(aspectRatio);
  if (!ratio || width <= 0 || height <= 0) {
    return null;
  }

  const originalRatio = width / height;
  if (Math.abs(originalRatio - ratio) < 0.01) {
    return {
      cropType: 'none',
      width,
      height,
      offsetX: 0,
      offsetY: 0,
      maxOffsetX: 0,
      maxOffsetY: 0,
    };
  }

  if (originalRatio > ratio) {
    const cropWidth = Math.round(height * ratio);
    const maxOffsetX = width - cropWidth;
    const normalizedX = offset ? Math.max(0, Math.min(1, offset.x)) : 0.5;
    return {
      cropType: 'vertical',
      width: cropWidth,
      height,
      offsetX: Math.round(maxOffsetX * normalizedX),
      offsetY: 0,
      maxOffsetX,
      maxOffsetY: 0,
    };
  }

  const cropHeight = Math.round(width / ratio);
  const maxOffsetY = height - cropHeight;
  const defaultY = cropOrigin === 'top' ? 0 : 1;
  const normalizedY = offset ? Math.max(0, Math.min(1, offset.y)) : defaultY;
  return {
    cropType: 'horizontal',
    width,
    height: cropHeight,
    offsetX: 0,
    offsetY: Math.round(maxOffsetY * normalizedY),
    maxOffsetX: 0,
    maxOffsetY,
  };
}

export function hasCropOperation(settings: BatchSettings): boolean {
  return settings.operations.cropEnabled && settings.crop.aspectRatio !== 'original';
}

export function hasFormatConversion(settings: BatchSettings): boolean {
  return settings.operations.formatEnabled && settings.format.outputFormat !== 'original';
}

export function hasResizeOperation(settings: BatchSettings): boolean {
  return settings.operations.resizeEnabled;
}

export function hasCompressionOperation(settings: BatchSettings): boolean {
  return settings.operations.compressionEnabled;
}

export function isDirectExportMode(settings: BatchSettings): boolean {
  return !hasCropOperation(settings) && !hasResizeOperation(settings) && !hasFormatConversion(settings) && !hasCompressionOperation(settings);
}

export function resolveSettingsForItem(baseSettings: BatchSettings, item: ImageItem): BatchSettings {
  const next = cloneBatchSettings(baseSettings);
  const presetId = item.overrides.presetId;
  if (presetId) {
    const preset = PRESET_BY_ID[presetId];
    if (preset) {
      next.operations = {
        ...next.operations,
        cropEnabled: preset.settings.operations.cropEnabled,
        resizeEnabled: preset.settings.operations.resizeEnabled,
        formatEnabled: preset.settings.operations.formatEnabled,
        compressionEnabled: preset.settings.operations.compressionEnabled,
      };
      next.crop = { ...next.crop, ...preset.settings.crop };
      next.resize = { ...next.resize, ...preset.settings.resize };
      next.format = { ...next.format, ...preset.settings.format };
      next.compression = { ...next.compression, ...preset.settings.compression };
    }
  }

  if (item.overrides.skipCompression) {
    next.operations.compressionEnabled = false;
  }

  return next;
}

export function getProcessingPlan(item: ImageItem, settings: BatchSettings): ProcessingPlan {
  const cropRect =
    hasCropOperation(settings) && item.sourceWidth && item.sourceHeight
      ? getCropRectangle(item.sourceWidth, item.sourceHeight, settings.crop.aspectRatio, item.overrides.customCropOffset, settings.crop.cropOrigin)
      : null;
  const effectiveCrop = cropRect && cropRect.cropType !== 'none' ? cropRect : null;
  const sourceWidth = effectiveCrop?.width ?? item.sourceWidth ?? 0;
  const sourceHeight = effectiveCrop?.height ?? item.sourceHeight ?? 0;
  const resize = settings.operations.resizeEnabled
    ? computeResizeDimensions(sourceWidth, sourceHeight, settings.resize.maxWidth, settings.resize.maxHeight, settings.resize.noUpscale)
    : { width: sourceWidth, height: sourceHeight, scale: 1 };
  const shouldResize = settings.operations.resizeEnabled
    ? sourceWidth > 0 && sourceHeight > 0
      ? resize.width !== sourceWidth || resize.height !== sourceHeight
      : true
    : false;
  const shouldCrop = !!effectiveCrop;
  const shouldConvertFormat = settings.operations.formatEnabled && settings.format.outputFormat !== 'original';
  const shouldCompress = settings.operations.compressionEnabled && !item.overrides.skipCompression;
  const usesSourceDirectly = !shouldCrop && !shouldResize && !shouldConvertFormat && !shouldCompress;
  const targetFormat = settings.operations.formatEnabled ? settings.format.outputFormat : 'original';
  return {
    usesSourceDirectly,
    shouldCrop,
    shouldResize,
    shouldConvertFormat,
    shouldCompress,
    targetFormat,
    targetMimeType: getOutputMimeType(targetFormat, item.sourceFile.type),
    targetExtension: getExtensionForFormat(targetFormat, item.originalName),
  };
}

export function isItemDirectExport(item: ImageItem, settings: BatchSettings): boolean {
  const effective = resolveSettingsForItem(settings, item);
  return getProcessingPlan(item, effective).usesSourceDirectly;
}

function buildFilenameCore(item: ImageItem, index: number, total: number, settings: BatchSettings): string {
  const effective = resolveSettingsForItem(settings, item);
  const format = effective.operations.formatEnabled ? effective.format.outputFormat : 'original';
  const extension = getExtensionForFormat(format, item.originalName);

  if (item.overrides.customFilename.trim()) {
    const { base } = splitFilename(item.overrides.customFilename);
    return `${base}.${extension}`;
  }

  if (settings.operations.renameEnabled) {
    return buildSequentialFilename(
      settings.rename.prefix,
      settings.rename.startAt + index,
      total + settings.rename.startAt - 1,
      extension,
    );
  }

  const { base } = splitFilename(item.originalName);
  return `${base}.${extension}`;
}

export function dedupeFilenames(filenames: string[]): string[] {
  const seen = new Map<string, number>();
  return filenames.map((filename) => {
    const { base, extension } = splitFilename(filename);
    const key = `${base}.${extension}`.toLowerCase();
    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
    if (count === 0) {
      return `${base}.${extension}`;
    }
    return `${base}-${count + 1}.${extension}`;
  });
}

export function buildDownloadNameMap(items: ImageItem[], settings: BatchSettings): Map<string, string> {
  const names = items.map((item, index) => buildFilenameCore(item, index, items.length, settings));
  const uniqueNames = dedupeFilenames(names);
  return new Map(items.map((item, index) => [item.id, uniqueNames[index]]));
}

export function reorderImageItems(items: ImageItem[], draggedId: string, targetId: string): ImageItem[] {
  if (draggedId === targetId) {
    return items;
  }

  const draggedIndex = items.findIndex((item) => item.id === draggedId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (draggedIndex < 0 || targetIndex < 0) {
    return items;
  }

  const next = [...items];
  const [draggedItem] = next.splice(draggedIndex, 1);
  const insertionIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
  next.splice(insertionIndex, 0, draggedItem);
  return next;
}

export function previewFilenames(settings: BatchSettings, count: number): string[] {
  const virtualItems = Array.from({ length: Math.max(3, count || 0) }, (_, index) => ({
    id: String(index),
    originalName: `ejemplo-${index + 1}.jpg`,
    sourceFile: new File([], `ejemplo-${index + 1}.jpg`, { type: 'image/jpeg' }),
    preview: '',
    originalSize: 0,
    status: 'pending' as const,
    stale: false,
    selected: false,
    excluded: false,
    overrides: { customFilename: '', customCropOffset: undefined, excluded: false, skipCompression: false, presetId: null },
  })) as ImageItem[];
  const nameMap = buildDownloadNameMap(virtualItems, settings);
  return virtualItems.slice(0, 3).map((item) => nameMap.get(item.id) || item.originalName);
}

export function buildItemSignature(item: ImageItem, settings: BatchSettings): string {
  const effective = resolveSettingsForItem(settings, item);
  return JSON.stringify({
    operations: {
      cropEnabled: effective.operations.cropEnabled,
      resizeEnabled: effective.operations.resizeEnabled,
      formatEnabled: effective.operations.formatEnabled,
      compressionEnabled: effective.operations.compressionEnabled,
    },
    crop: effective.crop,
    resize: effective.resize,
    format: effective.format,
    compression: effective.compression,
    customCropOffset: item.overrides.customCropOffset ?? null,
  });
}

export function syncStaleState(items: ImageItem[], settings: BatchSettings): ImageItem[] {
  return items.map((item) => {
    const shouldBeStale = item.status === 'completed' && !!item.resultBlob && item.processedSignature !== buildItemSignature(item, settings);
    return shouldBeStale === item.stale ? item : { ...item, stale: shouldBeStale };
  });
}

export function getEligibleItems(items: ImageItem[], scope: 'all' | 'selected' = 'all'): ImageItem[] {
  return items.filter((item) => !item.excluded && (scope === 'all' || item.selected));
}

export function getDownloadableItems(items: ImageItem[], settings: BatchSettings, scope: 'all' | 'selected' = 'all'): ImageItem[] {
  return getEligibleItems(items, scope).filter((item) => {
    if (isItemDirectExport(item, settings)) {
      return true;
    }
    return item.status === 'completed' && !item.stale && !!item.resultBlob;
  });
}

export function getProcessableItems(items: ImageItem[], settings: BatchSettings, scope: 'all' | 'selected' = 'all'): ImageItem[] {
  return getEligibleItems(items, scope).filter((item) => {
    if (isItemDirectExport(item, settings)) {
      return false;
    }
    return item.status === 'pending' || item.status === 'error' || item.stale;
  });
}

export function getPrimaryActionLabel(items: ImageItem[], settings: BatchSettings): string {
  const eligible = getEligibleItems(items);
  if (eligible.length === 0) {
    return 'Procesar';
  }

  const everyItemDirect = eligible.every((item) => isItemDirectExport(item, settings));
  if (everyItemDirect) {
    return settings.operations.renameEnabled ? 'Descargar renombradas' : 'Descargar originales';
  }

  if (eligible.some((item) => item.stale)) {
    return 'Reprocesar';
  }

  return 'Procesar';
}

export function getStats(items: ImageItem[], settings: BatchSettings): ImageStats {
  const selectedCount = items.filter((item) => item.selected).length;
  const included = items.filter((item) => !item.excluded);
  const processed = items.filter((item) => item.status === 'completed' && item.resultBlob && !item.stale);
  const readyCount = getDownloadableItems(items, settings).length;
  const totalOriginalSize = included.reduce((acc, item) => acc + item.originalSize, 0);
  const totalResultSize = included.reduce((acc, item) => acc + (item.resultSize ?? item.originalSize), 0);
  const savedBytes = totalOriginalSize - totalResultSize;
  const savedPercentage = totalOriginalSize > 0 ? (savedBytes / totalOriginalSize) * 100 : 0;

  return {
    totalCount: items.length,
    selectedCount,
    includedCount: included.length,
    processedCount: processed.length,
    staleCount: items.filter((item) => item.stale).length,
    errorCount: items.filter((item) => item.status === 'error').length,
    pendingCount: items.filter((item) => item.status === 'pending').length,
    readyCount,
    totalOriginalSize,
    totalResultSize,
    savedBytes,
    savedPercentage,
  };
}

export function buildZipFilename(settings: BatchSettings): string {
  const raw = settings.export.zipName.trim().replace(/[\\/:*?"<>|]+/g, '-');
  const name = raw || 'imagenes_optimizadas';
  return name.toLowerCase().endsWith('.zip') ? name : `${name}.zip`;
}

export function createImageOverrides(presetId: PresetId | null = null) {
  return {
    skipCompression: false,
    customFilename: '',
    customCropOffset: undefined,
    excluded: false,
    presetId,
  };
}

export function revokeItemUrls(item: ImageItem): void {
  URL.revokeObjectURL(item.preview);
  if (item.resultPreview) {
    URL.revokeObjectURL(item.resultPreview);
  }
}
