import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IMAGES_PER_PAGE } from '../constants';
import SheetPreview from '../components/SheetPreview';
import { PAGE_MARGIN_MM, PHOTO_HEIGHT_CM, TABLE_HEIGHT_CM } from '../layout';
import type { CuadranteRange, LocalImage } from '../types';
import { resolveCuadranteForPage } from './cuadranteRanges';

export function imageExportKey(index: number, filename: string): string {
  return `${index}::${filename}`;
}

export function buildExportHtml(
  title: string,
  cuadranteRanges: CuadranteRange[],
  images: LocalImage[],
  imageDataUris: Record<string, string>,
  logoLeftUri: string | null,
  logoRightUri: string | null,
): string {
  const pages: LocalImage[][] = [];
  if (images.length === 0) {
    pages.push([]);
  } else {
    for (let i = 0; i < images.length; i += IMAGES_PER_PAGE) {
      pages.push(images.slice(i, i + IMAGES_PER_PAGE));
    }
  }

  const sheets = pages.map((chunk, pageIndex) => {
    const pageNum = pageIndex + 1;
    const previewImages = chunk.map((img, slotIndex) => {
      const globalIndex = pageIndex * IMAGES_PER_PAGE + slotIndex;
      const key = imageExportKey(globalIndex, img.file.name);
      return {
        ...img,
        objectUrl: imageDataUris[key] ?? imageDataUris[img.file.name] ?? '',
      };
    });

    return renderToStaticMarkup(
      React.createElement(SheetPreview, {
        title,
        cuadrante: resolveCuadranteForPage(pageNum, cuadranteRanges),
        logoLeft: logoLeftUri,
        logoRight: logoRightUri,
        images: previewImages,
        pageNum,
        totalPages: pages.length,
        variant: 'export',
      }),
    );
  });

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <style>
    @page { size: A4 portrait; margin: ${PAGE_MARGIN_MM}mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; color: #000; }
    .ev-sheet-page {
      width: 100%;
      height: ${TABLE_HEIGHT_CM}cm;
      max-height: ${TABLE_HEIGHT_CM}cm;
      overflow: hidden;
      page-break-inside: avoid;
      break-inside: avoid-page;
      page-break-after: always;
      break-after: page;
    }
    .ev-sheet-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .ev-sheet-page table {
      page-break-inside: avoid;
      break-inside: avoid-page;
    }
    .ev-sheet-page img {
      max-width: 100%;
      max-height: ${PHOTO_HEIGHT_CM}cm;
      page-break-inside: avoid;
      break-inside: avoid-page;
    }
  </style>
</head>
<body>
${sheets.join('\n')}
</body>
</html>`;
}