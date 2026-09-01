import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { REPORT_TYPES, chunkArray, getDefaultHeader, getReportConfig } from '../constants';
import {
    buildConsolidatedFilename,
    buildConsolidatedReportPdfHtml,
    buildIndividualFilename,
    buildReportPdfHtml,
    exportConsolidatedReportPdf,
    exportReportPdf,
} from './export';
import type { CampoPanel, PhotoFile } from '../types';

const mockApi = vi.hoisted(() => ({
    dialogSave: vi.fn(),
    htmlToPdf: vi.fn(),
}));
const stageFileForIpc = vi.hoisted(() => vi.fn());

vi.mock('../../../api', () => ({
    api: mockApi,
}));
vi.mock('../../../utils/stageFile', () => ({ stageFileForIpc }));

function makePhoto(name = 'foto.jpg'): PhotoFile {
    const file = new File(['image'], name, { type: 'image/jpeg' });
    return { id: '1', file, previewUrl: 'blob:preview' };
}

describe('reportes-campo report model', () => {
    it('builds one report page per group of six photos', () => {
        expect(chunkArray([1, 2, 3, 4, 5, 6, 7], 6)).toEqual([[1, 2, 3, 4, 5, 6], [7]]);
    });

    it('uses a 3x2 photo grid on every report template', () => {
        for (const reportType of REPORT_TYPES) {
            expect(reportType.photosPerPage).toBe(6);
            expect(reportType.gridColumns).toBe(3);
            expect(reportType.gridRows).toBe(2);
        }
    });

    it('uses the configured title as the default header title', () => {
        const config = getReportConfig('maquina-balde');

        expect(getDefaultHeader(config).titulo).toBe('Máquina de Balde');
    });

    it('does not depend on HTTP endpoints for desktop export', () => {
        for (const reportType of REPORT_TYPES) {
            expect(reportType).not.toHaveProperty('endpoint');
        }
    });

    it('builds printable A4 HTML instead of rasterizing the live DOM', () => {
        const config = getReportConfig('panel-fotografico');
        const photo = new File(['image'], 'foto.jpg', { type: 'image/jpeg' });
        const html = buildReportPdfHtml({
            config,
            header: getDefaultHeader(config),
            photos: [{ id: '1', file: photo, previewUrl: 'antares-local-image:photo-0' }],
            logoLeft: null,
            logoRight: null,
        });

        expect(html).toContain('@page { size: A4 portrait; margin: 0; }');
        expect(html).toContain('class="report-page"');
        expect(html).toContain('antares-local-image:photo-0');
    });

    it('renders a dynamic 2+1 grid for three photos without extra empty cells', () => {
        const config = getReportConfig('panel-fotografico');
        const photos: PhotoFile[] = [
            makePhoto('a.jpg'),
            makePhoto('b.jpg'),
            makePhoto('c.jpg'),
        ];
        const html = buildReportPdfHtml({
            config,
            header: getDefaultHeader(config),
            photos,
            logoLeft: null,
            logoRight: null,
        });

        expect((html.match(/alt="Foto \d+"/g) ?? []).length).toBe(3);
        expect(html.match(/Sin imagen/g) ?? []).toHaveLength(0);
    });

    it('renders exact photo cells for every supported image count in PDF HTML', () => {
        const config = getReportConfig('panel-fotografico');

        for (let count = 1; count <= 6; count += 1) {
            const photos = Array.from({ length: count }, (_, index) => makePhoto(`foto-${index}.jpg`));
            const html = buildReportPdfHtml({
                config,
                header: getDefaultHeader(config),
                photos,
                logoLeft: null,
                logoRight: null,
            });

            expect((html.match(/alt="Foto \d+"/g) ?? []).length, `count=${count}`).toBe(count);
            expect(html.match(/Sin imagen/g) ?? [], `count=${count}`).toHaveLength(0);
        }
    });

    it('uses contain sizing for 2-column grids (1–4 photos) and fill for 3-column grids (5–6)', () => {
        const config = getReportConfig('panel-fotografico');

        const htmlFour = buildReportPdfHtml({
            config,
            header: getDefaultHeader(config),
            photos: Array.from({ length: 4 }, (_, index) => makePhoto(`foto-${index}.jpg`)),
            logoLeft: null,
            logoRight: null,
        });
        expect(htmlFour).toContain('object-fit:contain');
        expect(htmlFour).not.toContain('aspect-ratio');
        expect(htmlFour).not.toContain('object-fit:fill');

        const htmlSix = buildReportPdfHtml({
            config,
            header: getDefaultHeader(config),
            photos: Array.from({ length: 6 }, (_, index) => makePhoto(`foto-${index}.jpg`)),
            logoLeft: null,
            logoRight: null,
        });
        expect(htmlSix).toContain('object-fit:fill');
        expect(htmlSix).not.toContain('object-fit:contain');
    });

    it('builds consolidated HTML for multiple panels with distinct headers', () => {
        const config = getReportConfig('panel-fotografico');
        const photoA = new File(['image'], 'a.jpg', { type: 'image/jpeg' });
        const photoB = new File(['image'], 'b.jpg', { type: 'image/jpeg' });
        const headerA = { ...getDefaultHeader(config), CENTRO: 'CS Norte', titulo: 'Panel A' };
        const headerB = { ...getDefaultHeader(config), CENTRO: 'CS Sur', titulo: 'Panel B' };

        const html = buildConsolidatedReportPdfHtml({
            config,
            panels: [
                { header: headerA, photos: [{ id: '1', file: photoA, previewUrl: 'a' }] },
                { header: headerB, photos: [{ id: '2', file: photoB, previewUrl: 'b' }] },
            ],
            logoLeft: null,
            logoRight: null,
        });

        expect(html.match(/class="report-page"/g)?.length).toBe(2);
        expect(html).toContain('CS Norte');
        expect(html).toContain('CS Sur');
    });

    it('skips panels without photos in consolidated HTML', () => {
        const config = getReportConfig('panel-fotografico');
        const photo = new File(['image'], 'foto.jpg', { type: 'image/jpeg' });
        const html = buildConsolidatedReportPdfHtml({
            config,
            panels: [
                { header: getDefaultHeader(config), photos: [] },
                { header: getDefaultHeader(config), photos: [{ id: '1', file: photo, previewUrl: 'x' }] },
            ],
            logoLeft: null,
            logoRight: null,
        });

        expect(html.match(/class="report-page"/g)?.length).toBe(1);
    });

    it('builds individual and consolidated filenames', () => {
        const config = getReportConfig('panel-fotografico');
        expect(buildIndividualFilename(config, 'CS Norte · 2026-06-24')).toBe(
            'panel_fotografico_CS_Norte_·_2026-06-24.pdf',
        );
        expect(buildConsolidatedFilename(config, new Date('2026-06-24T12:00:00Z'))).toBe(
            'panel_fotografico_consolidado_2026-06-24.pdf',
        );
    });

    it('exports through the native Electron HTML-to-PDF renderer', async () => {
        const config = getReportConfig('panel-fotografico');
        const photo = new File(['image'], 'foto.jpg', { type: 'image/jpeg' });
        Object.defineProperty(photo, 'path', { value: 'C:\\tmp\\foto.jpg' });
        const photos: PhotoFile[] = [{ id: '1', file: photo, previewUrl: 'blob:preview' }];

        mockApi.dialogSave.mockResolvedValue({ paths: ['C:\\tmp\\panel.pdf'] });
        mockApi.htmlToPdf.mockResolvedValue({ filename: 'panel.pdf', saved_path: 'C:\\tmp\\panel.pdf' });

        const result = await exportReportPdf(config, getDefaultHeader(config), photos, null, null);

        expect(mockApi.dialogSave).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Guardar PDF',
            defaultPath: config.filename,
        }));
        expect(mockApi.htmlToPdf).toHaveBeenCalledWith(expect.objectContaining({
            filename: config.filename,
            outputPath: 'C:\\tmp\\panel.pdf',
            localImagePaths: { 'antares-local-image:photo-0': 'antares-read_report' },
        }));
        expect(result).toEqual({ filename: 'panel.pdf', savedPath: 'C:\\tmp\\panel.pdf' });
    });

    it('exports consolidated PDF in a single htmlToPdf call', async () => {
        const config = getReportConfig('panel-fotografico');
        const photo = new File(['image'], 'foto.jpg', { type: 'image/jpeg' });
        Object.defineProperty(photo, 'path', { value: 'C:\\tmp\\foto.jpg' });

        const panels: CampoPanel[] = [
            {
                id: 'p1',
                label: 'Panel 1',
                header: getDefaultHeader(config),
                photos: [{ id: '1', file: photo, previewUrl: 'blob:1' }],
                createdAt: Date.now(),
            },
            {
                id: 'p2',
                label: 'Panel 2',
                header: getDefaultHeader(config),
                photos: [],
                createdAt: Date.now(),
            },
        ];

        mockApi.dialogSave.mockResolvedValue({ paths: ['C:\\tmp\\consolidado.pdf'] });
        mockApi.htmlToPdf.mockResolvedValue({ filename: 'consolidado.pdf', saved_path: 'C:\\tmp\\consolidado.pdf' });

        const result = await exportConsolidatedReportPdf(config, panels, null, null);

        expect(mockApi.dialogSave).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Guardar PDF consolidado',
            defaultPath: 'panel_fotografico_consolidado_2026-06-24.pdf',
        }));
        expect(mockApi.htmlToPdf).toHaveBeenCalledTimes(1);
        expect(result.filename).toBe('consolidado.pdf');
    });

    it('does not render when the save dialog is cancelled', async () => {
        const config = getReportConfig('panel-fotografico');
        const photos: PhotoFile[] = [makePhoto()];

        mockApi.dialogSave.mockResolvedValue({ paths: [] });

        await expect(exportReportPdf(config, getDefaultHeader(config), photos, null, null))
            .resolves.toEqual({ cancelled: true });
        expect(mockApi.htmlToPdf).not.toHaveBeenCalled();
    });
});

beforeEach(() => {
  mockApi.dialogSave.mockReset();
  mockApi.htmlToPdf.mockReset();
  stageFileForIpc.mockResolvedValue('antares-read_report');
  // jsdom exposes Image but never completes blob URL decoding. The export
  // tests exercise the IPC payload, not canvas decoding, so force the
  // deterministic FileReader fallback here.
  vi.stubGlobal('Image', undefined);
  vi.stubGlobal('FileReader', undefined);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-24T12:00:00Z'));
});

afterEach(() => {
  stageFileForIpc.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
