/**
 * Web Worker for offloading batch image processing, resizing, and Blob conversion off the main UI thread.
 */

export interface ImageProcessingTask {
  id: string;
  file: File;
  maxDimension?: number;
  quality?: number;
  outputType?: string;
}

export interface ImageProcessingResult {
  id: string;
  name: string;
  type: string;
  blob: Blob;
  dataUrl?: string;
  width?: number;
  height?: number;
  error?: string;
}

self.onmessage = async (e: MessageEvent<ImageProcessingTask[]>) => {
  const tasks = e.data;
  const results: ImageProcessingResult[] = [];

  for (const task of tasks) {
    try {
      const { id, file } = task;
      // In Worker context, use createImageBitmap or FileReader / OffscreenCanvas if available
      let blob: Blob = file;
      let width = 0;
      let height = 0;

      if (typeof createImageBitmap !== 'undefined') {
        try {
          const bitmap = await createImageBitmap(file);
          width = bitmap.width;
          height = bitmap.height;

          const maxDim = task.maxDimension || 2048;
          const needsDownscale = width > maxDim || height > maxDim;
          const needsReencode = task.quality !== undefined || task.outputType !== undefined;
          if (needsDownscale || needsReencode) {
            const scale = Math.min(1, maxDim / Math.max(width, height));
            const targetW = Math.max(1, Math.round(width * scale));
            const targetH = Math.max(1, Math.round(height * scale));

            if (typeof OffscreenCanvas !== 'undefined') {
              const canvas = new OffscreenCanvas(targetW, targetH);
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(bitmap, 0, 0, targetW, targetH);
                const q = task.quality ?? 0.9;
                const t = task.outputType || file.type || 'image/jpeg';
                blob = await canvas.convertToBlob({ type: t, quality: q });
              }
            }
          }
          bitmap.close();
        } catch {
          blob = file;
        }
      }

      results.push({
        id,
        name: file.name,
        type: file.type,
        blob,
        width,
        height,
      });
    } catch (err) {
      results.push({
        id: task.id,
        name: task.file.name,
        type: task.file.type,
        blob: task.file,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  self.postMessage(results);
};
