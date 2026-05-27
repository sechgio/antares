import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { api } from '../../../api';
import { fileToPdfImageSource } from '../../../utils/pdfAssets';
import SheetPreview from '../components/SheetPreview';
import { CHUNK_SIZE, chunkArray } from '../constants';
import type { LogoData, PhotoFile, ReportTypeConfig } from '../types';

export interface ExportReportPdfResult {
    cancelled?: boolean;
    filename?: string;
    savedPath?: string;
}

async function preparePhotosForPdf(
    photos: PhotoFile[],
    localImagePaths: Record<string, string>,
): Promise<PhotoFile[]> {
    return Promise.all(
        photos.map(async (photo, index) => ({
            ...photo,
            previewUrl: await fileToPdfImageSource(photo.file, `photo-${index}`, localImagePaths),
        })),
    );
}

async function prepareLogoForPdf(
    logo: LogoData | null,
    key: string,
    localImagePaths: Record<string, string>,
): Promise<string | null> {
    if (!logo) return null;
    return fileToPdfImageSource(logo.file, key, localImagePaths);
}

export function buildReportPdfHtml({
    config,
    header,
    photos,
    logoLeft,
    logoRight,
}: {
    config: ReportTypeConfig;
    header: Record<string, string>;
    photos: PhotoFile[];
    logoLeft: string | null;
    logoRight: string | null;
}): string {
    const pages = chunkArray(photos, CHUNK_SIZE);
    const body = pages
        .map((images, index) =>
            renderToStaticMarkup(
                React.createElement(
                    'div',
                    { className: 'report-page' },
                    React.createElement(SheetPreview, {
                        config,
                        header,
                        logoLeft,
                        logoRight,
                        images,
                        pageNum: index + 1,
                        totalPages: pages.length,
                    }),
                ),
            ),
        )
        .join('\n');

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>
  @page { size: A4 portrait; margin: 0; }
  html, body {
    width: auto;
    min-height: 100%;
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #000000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body { font-family: Arial, Helvetica, sans-serif; }
  .report-page {
    width: 210mm;
    height: 297mm;
    page-break-after: always;
    break-after: page;
    overflow: hidden;
  }
  .report-page:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  .preview-paper-scope {
    background: #ffffff !important;
    color: #000000 !important;
    box-shadow: none !important;
  }
  img {
    break-inside: avoid;
  }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

export async function exportReportPdf(
    config: ReportTypeConfig,
    header: Record<string, string>,
    photos: PhotoFile[],
    logoLeft: LogoData | null,
    logoRight: LogoData | null,
): Promise<ExportReportPdfResult> {
    if (photos.length === 0) {
        throw new Error('No hay imagenes para exportar.');
    }

    const saveTarget = await api.dialogSave({
        title: 'Guardar PDF',
        defaultPath: config.filename,
        filters: [
            { name: 'PDF', extensions: ['pdf'] },
            { name: 'Todos los archivos', extensions: ['*'] },
        ],
    });
    const outputPath = saveTarget.paths[0];
    if (!outputPath) {
        return { cancelled: true };
    }

    const localImagePaths: Record<string, string> = {};
    const [pdfPhotos, pdfLogoLeft, pdfLogoRight] = await Promise.all([
        preparePhotosForPdf(photos, localImagePaths),
        prepareLogoForPdf(logoLeft, 'logo-left', localImagePaths),
        prepareLogoForPdf(logoRight, 'logo-right', localImagePaths),
    ]);

    const html = buildReportPdfHtml({
        config,
        header,
        photos: pdfPhotos,
        logoLeft: pdfLogoLeft,
        logoRight: pdfLogoRight,
    });

    const response = await api.htmlToPdf({
        html,
        filename: config.filename,
        outputPath,
        localImagePaths: Object.keys(localImagePaths).length > 0 ? localImagePaths : undefined,
    });

    return {
        filename: response.filename,
        savedPath: 'saved_path' in response ? response.saved_path : undefined,
    };
}
