import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_CUADRANTE_LABEL, IMAGES_PER_PAGE } from '../constants';
import SheetPreview from '../components/SheetPreview';
import { PAGE_MARGIN_MM, TABLE_WIDTH_CM } from '../layout';
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
  cuadranteLabel: string = DEFAULT_CUADRANTE_LABEL,
  showCuadranteLabel: boolean = true,
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
        cuadranteLabel,
        showCuadranteLabel,
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
    html, body {
      margin: 0;
      padding: 0;
      color: #000;
      background: #fff;
      font-family: Aptos, Arial, Helvetica, sans-serif;
    }
    .preview-paper-scope,
    .ev-sheet-page {
      background: #fff;
      color: #000;
    }
    /* Sin height/overflow fijos: evita cortar el borde inferior del panel */
    .ev-sheet-page {
      width: ${TABLE_WIDTH_CM}cm;
      overflow: visible;
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
      border-collapse: collapse;
    }
    .ev-sheet-page img {
      display: block;
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
