import { api } from '../../../api';
import { renderAndDeliverDocument } from '../../../utils/deliverRenderedDocument';
import { buildTimestampedFilename, fileToBase64 } from '../../../utils/pdfAssets';
import { stageFileForIpc } from '../../../utils/stageFile';
import {
  DEFAULT_CUADRANTE_LABEL,
  IMAGES_PER_PAGE,
  MAX_TOTAL_IMAGE_BYTES,
  MSG_IMAGE_TOTAL_TOO_LARGE,
} from '../constants';
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
  if (images.reduce((total, image) => total + image.file.size, 0) > MAX_TOTAL_IMAGE_BYTES) {
    throw new Error(MSG_IMAGE_TOTAL_TOO_LARGE);
  }

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
      if (!needDataUris && !hasToken) {
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

  const imagePayload = await buildImagePayload(images, {
    needDataUris: needHtml,
  });
  const { imagePaths, imagesBase64, imageDataUris } = imagePayload;

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

  if (html) {
    for (const key of Object.keys(imageDataUris)) delete imageDataUris[key];
  }

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

  return renderAndDeliverDocument(
    payload,
    (body, outputPath) => api.evidenciaVolanteoRender({ ...body, output_path: outputPath }),
    { defaultName, format },
  );
}
