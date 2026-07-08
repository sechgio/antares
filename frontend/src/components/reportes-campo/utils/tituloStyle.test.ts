import { describe, expect, it } from 'vitest';
import { getDefaultHeader, getReportConfig, REPORT_TYPES } from '../constants';
import { buildReportPdfHtml } from './export';
import {
    DEFAULT_TITULO_COLOR,
    DEFAULT_TITULO_SIZE_PX,
    TITULO_COLOR_KEY,
    TITULO_SIZE_KEY,
    resolveTituloStyle,
    stepTituloSize,
} from './tituloStyle';
import type { PhotoFile } from '../types';

function makePhoto(): PhotoFile {
    const file = new File(['image'], 'foto.jpg', { type: 'image/jpeg' });
    return { id: '1', file, previewUrl: 'blob:preview' };
}

describe('resolveTituloStyle', () => {
    it('returns defaults for empty header', () => {
        expect(resolveTituloStyle({})).toEqual({
            fontSizePx: DEFAULT_TITULO_SIZE_PX,
            color: DEFAULT_TITULO_COLOR,
        });
    });

    it('accepts valid size and hex color', () => {
        expect(
            resolveTituloStyle({
                [TITULO_SIZE_KEY]: '20',
                [TITULO_COLOR_KEY]: '#0066cc',
            }),
        ).toEqual({ fontSizePx: 20, color: '#0066CC' });
    });

    it('falls back on invalid size or color', () => {
        expect(
            resolveTituloStyle({
                [TITULO_SIZE_KEY]: '999',
                [TITULO_COLOR_KEY]: 'red',
            }),
        ).toEqual({
            fontSizePx: DEFAULT_TITULO_SIZE_PX,
            color: DEFAULT_TITULO_COLOR,
        });
    });

    it('steps title size across presets', () => {
        expect(stepTituloSize(14, 1)).toBe(16);
        expect(stepTituloSize(14, -1)).toBe(12);
        expect(stepTituloSize(10, -1)).toBe(10);
        expect(stepTituloSize(28, 1)).toBe(28);
    });
});

describe('titulo style in report defaults and PDF', () => {
    it('includes default title style in every template header', () => {
        for (const reportType of REPORT_TYPES) {
            const header = getDefaultHeader(reportType);
            expect(header[TITULO_SIZE_KEY]).toBe(String(DEFAULT_TITULO_SIZE_PX));
            expect(header[TITULO_COLOR_KEY]).toBe(DEFAULT_TITULO_COLOR);
        }
    });

    it('embeds custom title size and color in printable HTML for all templates', () => {
        for (const reportType of REPORT_TYPES) {
            const header = {
                ...getDefaultHeader(reportType),
                [TITULO_SIZE_KEY]: '22',
                [TITULO_COLOR_KEY]: '#CC0000',
            };
            const html = buildReportPdfHtml({
                config: getReportConfig(reportType.id),
                header,
                photos: [makePhoto()],
                logoLeft: null,
                logoRight: null,
            });

            expect(html, reportType.id).toContain('font-size:22px');
            expect(html, reportType.id).toContain('color:#CC0000');
            expect(html, reportType.id).toContain(header.titulo || reportType.defaultTitulo);
        }
    });
});
