/**
 * OffscreenCanvas image process worker for the optimizer.
 * Receives transferable ArrayBuffers; returns encoded image bytes.
 */
/// <reference lib="webworker" />

import type { BatchSettings, CropOffset } from './types';
import { computeResizeDimensions, getCropRectangle, getOutputMimeType } from './utils';

export type ProcessWorkerRequest = {
  requestId: string;
  buffer: ArrayBuffer;
  sourceType: string;
  fileName: string;
  settings: BatchSettings;
  cropOffset?: CropOffset;
  shouldCrop: boolean;
  shouldResize: boolean;
  shouldConvertFormat: boolean;
  shouldCompress: boolean;
};

export type ProcessWorkerResponse =
  | {
      requestId: string;
      ok: true;
      buffer: ArrayBuffer;
      mimeType: string;
      width: number;
      height: number;
    }
  | {
      requestId: string;
      ok: false;
      error: string;
    };

declare const self: DedicatedWorkerGlobalScope;

async function encodeCanvas(
  canvas: OffscreenCanvas,
  mimeType: string,
  quality: number,
): Promise<Blob> {
  return canvas.convertToBlob({ type: mimeType, quality });
}

async function processJob(job: ProcessWorkerRequest): Promise<ProcessWorkerResponse> {
  const { requestId, buffer, sourceType, settings, cropOffset } = job;
  try {
    const blob = new Blob([buffer], { type: sourceType || 'application/octet-stream' });
    const bitmap = await createImageBitmap(blob);
    try {
      const srcW = bitmap.width;
      const srcH = bitmap.height;

      const cropRect =
        job.shouldCrop && settings.operations.cropEnabled
          ? getCropRectangle(
              srcW,
              srcH,
              settings.crop.aspectRatio,
              cropOffset,
              settings.crop.cropOrigin,
            )
          : null;

      const sourceRect =
        cropRect && cropRect.cropType !== 'none'
          ? {
              width: cropRect.width,
              height: cropRect.height,
              offsetX: cropRect.offsetX,
              offsetY: cropRect.offsetY,
            }
          : { width: srcW, height: srcH, offsetX: 0, offsetY: 0 };

      const resize =
        job.shouldResize && settings.operations.resizeEnabled
          ? computeResizeDimensions(
              sourceRect.width,
              sourceRect.height,
              settings.resize.maxWidth,
              settings.resize.maxHeight,
              settings.resize.noUpscale,
            )
          : { width: sourceRect.width, height: sourceRect.height, scale: 1 };

      const outW = Math.max(1, resize.width);
      const outH = Math.max(1, resize.height);
      const canvas = new OffscreenCanvas(outW, outH);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('No se pudo crear el canvas de procesamiento.');
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        bitmap,
        sourceRect.offsetX,
        sourceRect.offsetY,
        sourceRect.width,
        sourceRect.height,
        0,
        0,
        outW,
        outH,
      );

      const outputFormat = job.shouldConvertFormat && settings.operations.formatEnabled
        ? settings.format.outputFormat
        : 'original';
      let mimeType = getOutputMimeType(outputFormat, sourceType);
      if (!mimeType) mimeType = 'image/jpeg';

      let outBlob: Blob;
      if (job.shouldCompress && settings.operations.compressionEnabled) {
        const isPNG = mimeType === 'image/png';
        let currentQuality = isPNG ? 1 : settings.compression.quality;
        const maxBytes = settings.compression.maxSizeMB * 1024 * 1024;
        outBlob = await encodeCanvas(canvas, mimeType, currentQuality);

        if (!isPNG) {
          for (let attempt = 0; attempt < 8; attempt += 1) {
            if (outBlob.size <= maxBytes || currentQuality <= 0.15) break;
            currentQuality = Math.max(0.1, currentQuality - 0.1);
            outBlob = await encodeCanvas(canvas, mimeType, currentQuality);
          }
        }
      } else {
        const quality = mimeType === 'image/png' ? 1 : 0.95;
        outBlob = await encodeCanvas(canvas, mimeType, quality);
      }

      const outBuffer = await outBlob.arrayBuffer();
      return {
        requestId,
        ok: true,
        buffer: outBuffer,
        mimeType: outBlob.type || mimeType,
        width: outW,
        height: outH,
      };
    } finally {
      bitmap.close();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error en worker de imagen';
    return { requestId, ok: false, error: message };
  }
}

self.onmessage = (event: MessageEvent<ProcessWorkerRequest>) => {
  const job = event.data;
  void processJob(job).then((response) => {
    if (response.ok) {
      self.postMessage(response, [response.buffer]);
    } else {
      self.postMessage(response);
    }
  });
};
