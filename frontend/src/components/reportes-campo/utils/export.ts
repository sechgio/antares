import React from 'react';
import { createRoot } from 'react-dom/client';
import SheetPreview from '../components/SheetPreview';
import { CHUNK_SIZE, chunkArray } from '../constants';
import type { LogoData, PhotoFile, ReportTypeConfig } from '../types';

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PX_PER_MM = 3.7795;
const RENDER_SCALE = 3;

const waitForImages = async (scope: HTMLElement): Promise<void> => {
    const images = Array.from(scope.querySelectorAll('img'));
    await Promise.all(
        images.map(
            (image) =>
                new Promise<void>((resolve) => {
                    if (image.complete) {
                        resolve();
                        return;
                    }
                    image.addEventListener('load', () => resolve(), { once: true });
                    image.addEventListener('error', () => resolve(), { once: true });
                }),
        ),
    );
};

const waitForFonts = async (): Promise<void> => {
    if (document.fonts?.ready) {
        await document.fonts.ready;
    }
};

const waitForReflow = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

const rasterizePage = async (node: HTMLElement): Promise<string> => {
    const { toJpeg } = await import('html-to-image');
    const naturalWidth = node.scrollWidth || node.offsetWidth;
    const targetWidth = Math.round(A4_WIDTH_MM * PX_PER_MM * RENDER_SCALE);
    const pixelRatio = targetWidth / naturalWidth;

    return toJpeg(node, {
        quality: 0.94,
        backgroundColor: '#ffffff',
        pixelRatio,
        width: naturalWidth,
        height: node.scrollHeight || node.offsetHeight,
        style: {
            margin: '0',
        },
    });
};

export async function exportReportPdf(
    config: ReportTypeConfig,
    header: Record<string, string>,
    photos: PhotoFile[],
    logoLeft: LogoData | null,
    logoRight: LogoData | null,
): Promise<void> {
    if (photos.length === 0) {
        throw new Error('No hay imagenes para exportar.');
    }

    const { default: jsPDF } = await import('jspdf');
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    container.style.zIndex = '-9999';
    container.style.opacity = '0';
    container.style.pointerEvents = 'none';
    document.body.appendChild(container);

    const root = createRoot(container);
    const pages = chunkArray(photos, CHUNK_SIZE);

    try {
        root.render(
            React.createElement(
                React.Fragment,
                null,
                pages.map((images, index) =>
                    React.createElement(
                        'div',
                        { key: index, 'data-export-page': 'true' },
                        React.createElement(SheetPreview, {
                            config,
                            header,
                            logoLeft: logoLeft?.url ?? null,
                            logoRight: logoRight?.url ?? null,
                            images,
                            pageNum: index + 1,
                            totalPages: pages.length,
                        }),
                    ),
                ),
            ),
        );

        await waitForReflow();
        await waitForImages(container);
        await waitForFonts();

        const pageNodes = Array.from(container.querySelectorAll<HTMLElement>("[data-export-page='true']"));
        if (pageNodes.length === 0) {
            throw new Error('No hay paginas listas para exportar.');
        }

        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4',
        });

        for (let index = 0; index < pageNodes.length; index += 1) {
            const imageData = await rasterizePage(pageNodes[index]);
            if (index > 0) {
                pdf.addPage('a4', 'portrait');
            }
            pdf.addImage(imageData, 'JPEG', 0, 0, A4_WIDTH_MM, A4_HEIGHT_MM, undefined, 'MEDIUM');
        }

        pdf.save(config.filename);
    } finally {
        root.unmount();
        document.body.removeChild(container);
    }
}
