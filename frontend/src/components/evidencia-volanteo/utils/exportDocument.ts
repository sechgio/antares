import { api } from '../../../api';
import { DEFAULT_CUADRANTE_LABEL, IMAGES_PER_PAGE } from '../constants';
import type { CuadranteRange, LocalImage, LogoAsset } from '../types';
import { buildExportHtml, imageExportKey } from './buildExportHtml';
import { resolveCuadranteForPage } from './cuadranteRanges';

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function buildImagePayload(images: LocalImage[]): Promise<{
  imagePaths: Record<string, string>;
  imagesBase64: Record<string, string>;
  imageDataUris: Record<string, string>;
}> {
  const imagePaths: Record<string, string> = {};
  const imagesBase64: Record<string, string> = {};
  const imageDataUris: Record<string, string> = {};
  for (const [index, image] of images.entries()) {
    const filename = image.file.name;
    const base64 = await readFileAsBase64(image.file);
    const exportKey = imageExportKey(index, filename);
    imagesBase64[exportKey] = base64;
    imageDataUris[exportKey] = `data:${image.file.type || 'image/jpeg'};base64,${base64}`;
    if (image.localPath) {
      imagePaths[exportKey] = image.localPath;
    }
  }
  return { imagePaths, imagesBase64, imageDataUris };
}

function defaultFilename(format: 'pdf' | 'docx'): string {
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  return `evidencia_volanteo_${ts}.${format}`;
}

export async function exportEvidenciaDocument(
  title: string,
  cuadranteRanges: CuadranteRange[],
  images: LocalImage[],
  logoLeft: LogoAsset | null,
  logoRight: LogoAsset | null,
  format: 'pdf' | 'docx' = 'pdf',
  cuadranteLabel: string = DEFAULT_CUADRANTE_LABEL,
  showCuadranteLabel: boolean = true,
): Promise<{ filename: string }> {
  const logos: { left_b64?: string; right_b64?: string } = {};
  if (logoLeft) logos.left_b64 = await readFileAsBase64(logoLeft.file);
  if (logoRight) logos.right_b64 = await readFileAsBase64(logoRight.file);

  const { imagePaths, imagesBase64, imageDataUris } = await buildImagePayload(images);
  const logoLeftUri = logoLeft
    ? `data:${logoLeft.file.type || 'image/png'};base64,${await readFileAsBase64(logoLeft.file)}`
    : null;
  const logoRightUri = logoRight
    ? `data:${logoRight.file.type || 'image/png'};base64,${await readFileAsBase64(logoRight.file)}`
    : null;

  const pages = [];
  for (let i = 0; i < images.length; i += IMAGES_PER_PAGE) {
    const pageNum = Math.floor(i / IMAGES_PER_PAGE) + 1;
    const chunk = images.slice(i, i + IMAGES_PER_PAGE);
    pages.push({
      cuadrante: resolveCuadranteForPage(pageNum, cuadranteRanges),
      images: chunk.map((img, idx) => ({
        filename: imageExportKey(i + idx, img.file.name),
        position: idx + 1,
      })),
    });
  }

  if (pages.length === 0) {
    pages.push({ cuadrante: resolveCuadranteForPage(1, cuadranteRanges), images: [] });
  }

  const ext = format === 'docx' ? 'docx' : 'pdf';
  const defaultName = defaultFilename(format);
  const payload = {
    title,
    cuadrante: '',
    cuadrante_label: cuadranteLabel,
    show_cuadrante_label: showCuadranteLabel,
    pages,
    logos,
    images: imagesBase64,
    image_paths: imagePaths,
    format,
    ...(format === 'pdf'
      ? {
          html: buildExportHtml(
            title,
            cuadranteRanges,
            images,
            imageDataUris,
            logoLeftUri,
            logoRightUri,
            cuadranteLabel,
            showCuadranteLabel,
          ),
        }
      : {}),
  };

  if (window.electronAPI?.invoke) {
    const dialogResp = await api.dialogSave({
      title: 'Guardar documento',
      defaultPath: defaultName,
      filters: [{ name: format === 'docx' ? 'Word' : 'PDF', extensions: [ext] }],
    });
    if (dialogResp.paths && dialogResp.paths.length > 0) {
      const outputPath = dialogResp.paths[0];
      const resp = await api.evidenciaVolanteoRender({
        ...payload,
        output_path: outputPath,
      });
      return { filename: resp.filename || outputPath };
    }
    return { filename: '' };
  }

  const resp = await api.evidenciaVolanteoRender(payload);

  const content = resp.content_base64 || resp.pdf_base64;
  const contentBytes = atob(content);
  const buffer = new Uint8Array(contentBytes.length);
  for (let i = 0; i < contentBytes.length; i++) {
    buffer[i] = contentBytes.charCodeAt(i);
  }

  const mimeType = format === 'docx'
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : 'application/pdf';

  const blob = new Blob([buffer], { type: mimeType });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = resp.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);

  return { filename: resp.filename };
}