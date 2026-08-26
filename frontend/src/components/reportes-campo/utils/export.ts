import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { api } from '../../../api';
import { mapWithConcurrencyLimit } from '../../../utils/mapWithConcurrencyLimit';
import { fileToPdfImageSource } from '../../../utils/pdfAssets';
import SheetPreview from '../components/SheetPreview';
import { CHUNK_SIZE, chunkArray } from '../constants';
import type { CampoPanel, LogoData, PhotoFile, ReportTypeConfig } from '../types';
import { safeFilenamePart } from './panelLabel';

export interface ExportReportPdfResult {
    cancelled?: boolean;
    filename?: string;
    savedPath?: string;
}

const PRINT_STYLES = `
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
`;

async function preparePhotosForPdf(
    photos: PhotoFile[],
    localImagePaths: Record<string, string>,
    keyPrefix = 'photo',
): Promise<PhotoFile[]> {
    return mapWithConcurrencyLimit(photos, 4, async (photo, index) => ({
        ...photo,
        previewUrl: await fileToPdfImageSource(photo.file, `${keyPrefix}-${index}`, localImagePaths),
    }));
}

async function prepareLogoForPdf(
    logo: LogoData | null,
    key: string,
    localImagePaths: Record<string, string>,
): Promise<string | null> {
    if (!logo) return null;
    return fileToPdfImageSource(logo.file, key, localImagePaths);
}

function buildPanelPagesHtml({
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
    const pages = chunkArray(photos, config.photosPerPage || CHUNK_SIZE);
    return pages
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
}

function wrapReportHtml(body: string): string {
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>${PRINT_STYLES}</style>
</head>
<body>
${body}
</body>
</html>`;
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
    const body = buildPanelPagesHtml({ config, header, photos, logoLeft, logoRight });
    return wrapReportHtml(body);
}

export function buildConsolidatedReportPdfHtml({
    config,
    panels,
    logoLeft,
    logoRight,
}: {
    config: ReportTypeConfig;
    panels: Array<{
        header: Record<string, string>;
        photos: PhotoFile[];
    }>;
    logoLeft: string | null;
    logoRight: string | null;
}): string {
    const body = panels
        .filter((panel) => panel.photos.length > 0)
        .map((panel) => buildPanelPagesHtml({
            config,
            header: panel.header,
            photos: panel.photos,
            logoLeft,
            logoRight,
        }))
        .join('\n');

    return wrapReportHtml(body);
}

export function buildIndividualFilename(config: ReportTypeConfig, label: string): string {
    const base = config.filename.replace(/\.pdf$/i, '');
    return `${safeFilenamePart(base)}_${safeFilenamePart(label)}.pdf`;
}

export function buildConsolidatedFilename(config: ReportTypeConfig, date = new Date()): string {
    const base = config.filename.replace(/\.pdf$/i, '');
    return `${safeFilenamePart(base)}_consolidado_${date.toISOString().slice(0, 10)}.pdf`;
}

export async function exportReportPdf(
    config: ReportTypeConfig,
    header: Record<string, string>,
    photos: PhotoFile[],
    logoLeft: LogoData | null,
    logoRight: LogoData | null,
    options?: { defaultFilename?: string },
): Promise<ExportReportPdfResult> {
    if (photos.length === 0) {
        throw new Error('No hay imagenes para exportar.');
    }

    const defaultFilename = options?.defaultFilename ?? config.filename;
    const saveTarget = await api.dialogSave({
        title: 'Guardar PDF',
        defaultPath: defaultFilename,
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
        filename: defaultFilename,
        outputPath,
        localImagePaths: Object.keys(localImagePaths).length > 0 ? localImagePaths : undefined,
    });

    return {
        filename: response.filename,
        savedPath: 'saved_path' in response ? response.saved_path : undefined,
    };
}

export async function exportConsolidatedReportPdf(
    config: ReportTypeConfig,
    panels: CampoPanel[],
    logoLeft: LogoData | null,
    logoRight: LogoData | null,
): Promise<ExportReportPdfResult> {
    const exportablePanels = panels.filter((panel) => panel.photos.length > 0);
    if (exportablePanels.length === 0) {
        throw new Error('No hay paneles con imagenes para exportar.');
    }

    const defaultFilename = buildConsolidatedFilename(config);
    const saveTarget = await api.dialogSave({
        title: 'Guardar PDF consolidado',
        defaultPath: defaultFilename,
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
    const [pdfLogoLeft, pdfLogoRight] = await Promise.all([
        prepareLogoForPdf(logoLeft, 'logo-left', localImagePaths),
        prepareLogoForPdf(logoRight, 'logo-right', localImagePaths),
    ]);

    const preparedPanels = await mapWithConcurrencyLimit(exportablePanels, 2, async (panel, panelIndex) => ({
        header: panel.header,
        photos: await preparePhotosForPdf(panel.photos, localImagePaths, `panel-${panelIndex}-photo`),
    }));

    const html = buildConsolidatedReportPdfHtml({
        config,
        panels: preparedPanels,
        logoLeft: pdfLogoLeft,
        logoRight: pdfLogoRight,
    });

    const response = await api.htmlToPdf({
        html,
        filename: defaultFilename,
        outputPath,
        localImagePaths: Object.keys(localImagePaths).length > 0 ? localImagePaths : undefined,
    });

    return {
        filename: response.filename,
        savedPath: 'saved_path' in response ? response.saved_path : undefined,
    };
}
