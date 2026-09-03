import { api } from '../../../api';
import { buildTimestampedFilename, downloadBase64Blob, fileToBase64 } from '../../../utils/pdfAssets';
import { stageFileForIpc } from '../../../utils/stageFile';
import { DEFAULT_CUADRANTE_LABEL, IMAGES_PER_PAGE } from '../constants';
import type { CuadranteRange, LocalImage, LogoAsset } from '../types';
import { buildExportHtml, imageExportKey } from './buildExportHtml';
import { resolveCuadranteForPage } from './cuadranteRanges';

export async function buildImagePayload(
  images: LocalImage[],
  options: { needDataUris?: boolean } = {},
): Promise<{
  imagePaths: Record<string, string>;
  imagesBase64: Record<string, string>;
  imageDataUris: Record<string, string>;
}> {
  const needDataUris = options.needDataUris ?? false;
  const imagePaths: Record<string, string> = {};
  const imagesBase64: Record<string, string> = {};
  const imageDataUris: Record<string, string> = {};

  for (const [index, image] of images.entries()) {
    const filename = image.file.name;
    const exportKey = imageExportKey(index, filename);

    if (!needDataUris) {
      const token = await stageFileForIpc(image.file);
      if (token) imagePaths[exportKey] = token;
    }

    const hasToken = Boolean(imagePaths[exportKey]);

    if (needDataUris || !hasToken) {
      const base64 = await fileToBase64(image.file);
      if (!hasToken) {
        imagesBase64[exportKey] = base64;
      }
      if (needDataUris) {
        imageDataUris[exportKey] = `data:${image.file.type || 'image/jpeg'};base64,${base64}`;
      }
    }
  }

  return { imagePaths, imagesBase64, imageDataUris };
}

export async function readLogoOnce(logo: LogoAsset | null): Promise<{
  b64?: string;
  dataUri: string | null;
}> {
  if (!logo) return { dataUri: null };
  const b64 = await fileToBase64(logo.file);
  return {
    b64,
    dataUri: `data:${logo.file.type || 'image/png'};base64,${b64}`,
  };
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
  const needHtml = format === 'pdf';

  const [leftLogo, rightLogo] = await Promise.all([
    readLogoOnce(logoLeft),
    readLogoOnce(logoRight),
  ]);

  const { imagePaths, imagesBase64, imageDataUris } = await buildImagePayload(images, {
    needDataUris: needHtml,
  });

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
  const defaultName = buildTimestampedFilename('evidencia_volanteo', format);

  const html = needHtml
    ? buildExportHtml(
      title,
      cuadranteRanges,
      images,
      imageDataUris,
      leftLogo.dataUri,
      rightLogo.dataUri,
      cuadranteLabel,
      showCuadranteLabel,
    )
    : undefined;

  const logos: { left_b64?: string; right_b64?: string } = {};
  if (!html) {
    if (leftLogo.b64) logos.left_b64 = leftLogo.b64;
    if (rightLogo.b64) logos.right_b64 = rightLogo.b64;
  }

  const payload = {
    title,
    cuadrante: '',
    cuadrante_label: cuadranteLabel,
    show_cuadrante_label: showCuadranteLabel,
    pages,
    logos,
    format,
    ...(html
      ? { html }
      : {
          images: imagesBase64,
          image_paths: imagePaths,
        }),
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
  const mimeType = format === 'docx'
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : 'application/pdf';

  downloadBase64Blob(content, resp.filename, mimeType);

  return { filename: resp.filename };
}
