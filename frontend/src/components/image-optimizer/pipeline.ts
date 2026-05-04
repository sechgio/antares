import { BatchSettings, CropOffset, ImageItem, ProcessedArtifact } from './types';
import {
  buildItemSignature,
  computeResizeDimensions,
  createImageOverrides,
  generateId,
  getCropRectangle,
  getOutputMimeType,
  getProcessingPlan,
  resolveSettingsForItem,
} from './utils';

export async function loadImageDimensions(file: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen.'));
    };

    img.src = url;
  });
}

async function loadImageElement(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo cargar la imagen para procesarla.'));
    };

    img.src = url;
  });
}

function canvasToFile(canvas: HTMLCanvasElement, fileName: string, mimeType: string, quality: number): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('No se pudo exportar la imagen procesada.'));
          return;
        }
        resolve(new File([blob], fileName, { type: mimeType, lastModified: Date.now() }));
      },
      mimeType,
      quality,
    );
  });
}

async function renderTransformedFile(source: File, settings: BatchSettings, cropOffset?: CropOffset): Promise<File> {
  const image = await loadImageElement(source);
  const cropRect = settings.operations.cropEnabled
    ? getCropRectangle(image.naturalWidth, image.naturalHeight, settings.crop.aspectRatio, cropOffset, settings.crop.cropOrigin)
    : null;

  const sourceRect = cropRect ?? {
    width: image.naturalWidth,
    height: image.naturalHeight,
    offsetX: 0,
    offsetY: 0,
  };

  const resize = settings.operations.resizeEnabled
    ? computeResizeDimensions(
      sourceRect.width,
      sourceRect.height,
      settings.resize.maxWidth,
      settings.resize.maxHeight,
      settings.resize.noUpscale,
    )
    : { width: sourceRect.width, height: sourceRect.height, scale: 1 };

  const canvas = document.createElement('canvas');
  try {
    canvas.width = resize.width;
    canvas.height = resize.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('No se pudo crear el canvas de procesamiento.');
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      image,
      sourceRect.offsetX,
      sourceRect.offsetY,
      sourceRect.width,
      sourceRect.height,
      0,
      0,
      resize.width,
      resize.height,
    );

    const outputFormat = settings.operations.formatEnabled ? settings.format.outputFormat : 'original';
    const mimeType = getOutputMimeType(outputFormat, source.type);
    const quality = mimeType === 'image/png' ? 1 : 0.95;
    return await canvasToFile(canvas, source.name, mimeType, quality);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function compressImage(file: File, maxSizeMB: number, quality: number, mimeType?: string): Promise<Blob> {
  const img = await loadImageElement(file);
  const canvas = document.createElement('canvas');
  try {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo crear canvas');
    ctx.drawImage(img, 0, 0);

    const targetMime = mimeType || file.type || 'image/jpeg';
    const isPNG = targetMime === 'image/png';

    let currentQuality = isPNG ? 1 : quality;
    const maxBytes = maxSizeMB * 1024 * 1024;

    for (let attempt = 0; attempt < 8; attempt++) {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), targetMime, currentQuality);
      });

      if (!blob) break;

      if (blob.size <= maxBytes || isPNG || currentQuality <= 0.15) {
        return blob;
      }

      currentQuality = Math.max(0.1, currentQuality - 0.1);
    }

    const finalBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), targetMime, currentQuality);
    });

    if (!finalBlob) {
      throw new Error('No se pudo comprimir la imagen');
    }

    return finalBlob;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function createImageItem(file: File): Promise<ImageItem> {
  const dimensions = await loadImageDimensions(file).catch(() => ({ width: 0, height: 0 }));
  return {
    id: generateId(),
    sourceFile: file,
    preview: URL.createObjectURL(file),
    originalName: file.name,
    originalSize: file.size,
    sourceWidth: dimensions.width,
    sourceHeight: dimensions.height,
    status: 'pending',
    stale: false,
    selected: false,
    excluded: false,
    overrides: createImageOverrides(),
  };
}

export async function processImageItem(item: ImageItem, baseSettings: BatchSettings): Promise<ProcessedArtifact> {
  const effectiveSettings = resolveSettingsForItem(baseSettings, item);
  const plan = getProcessingPlan(item, effectiveSettings);
  const signature = buildItemSignature(item, baseSettings);

  if (plan.usesSourceDirectly) {
    const width = item.sourceWidth ?? 0;
    const height = item.sourceHeight ?? 0;
    return {
      blob: item.sourceFile,
      width,
      height,
      signature,
    };
  }

  let workingFile = item.sourceFile;
  if (plan.shouldCrop || plan.shouldResize || plan.shouldConvertFormat) {
    workingFile = await renderTransformedFile(item.sourceFile, effectiveSettings, item.overrides.customCropOffset);
  }

  let resultBlob: Blob = workingFile;
  if (plan.shouldCompress) {
    const targetMime = effectiveSettings.operations.formatEnabled && effectiveSettings.format.outputFormat !== 'original'
      ? getOutputMimeType(effectiveSettings.format.outputFormat, workingFile.type)
      : undefined;

    resultBlob = await compressImage(
      workingFile,
      effectiveSettings.compression.maxSizeMB,
      effectiveSettings.compression.quality,
      targetMime,
    );
  }

  const finalDimensions = await loadImageDimensions(resultBlob).catch(() => ({ width: item.sourceWidth ?? 0, height: item.sourceHeight ?? 0 }));

  return {
    blob: resultBlob,
    width: finalDimensions.width,
    height: finalDimensions.height,
    signature,
  };
}
