import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getReportConfig, REPORT_TYPES } from '../constants';
import { createEmptyPanel } from '../hooks/useCampoPanels';
import {
    brandingToStored,
    logoDataToStored,
    panelToStored,
    photoFileToStored,
    storedToBrandingLogos,
    storedToLogoData,
    storedToPanel,
    storedToPhotoFile,
} from './storage';
import type { LogoData, PhotoFile } from '../types';

describe('photoFileToStored / storedToPhotoFile', () => {
    beforeEach(() => {
        vi.stubGlobal('URL', {
            createObjectURL: vi.fn((blob: Blob) => `blob:${(blob as { name?: string }).name ?? 'x'}`),
            revokeObjectURL: vi.fn(),
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('round-trips a photo keeping id, name and type', () => {
        const file = new File(['bytes'], 'foto.jpg', { type: 'image/jpeg' });
        const photo: PhotoFile = {
            id: 'p1',
            file,
            previewUrl: 'blob:original',
        };

        const stored = photoFileToStored(photo);
        expect(stored.id).toBe('p1');
        expect(stored.name).toBe('foto.jpg');
        expect(stored.type).toBe('image/jpeg');
        expect(stored.blob).toBeInstanceOf(Blob);

        const restored = storedToPhotoFile(stored);
        expect(restored.id).toBe('p1');
        expect(restored.file.name).toBe('foto.jpg');
        expect(restored.file.type).toBe('image/jpeg');
        expect(restored.previewUrl).toBe('blob:foto.jpg');
    });
});

describe('logo / branding serialization', () => {
    beforeEach(() => {
        vi.stubGlobal('URL', {
            createObjectURL: vi.fn((blob: Blob) => `blob:${(blob as File).name ?? 'logo'}`),
            revokeObjectURL: vi.fn(),
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('round-trips logos left and right', () => {
        const left: LogoData = {
            file: new File(['L'], 'left.png', { type: 'image/png' }),
            url: 'blob:old-left',
        };
        const right: LogoData = {
            file: new File(['R'], 'right.jpg', { type: 'image/jpeg' }),
            url: 'blob:old-right',
        };

        const storedLeft = logoDataToStored(left, 'left');
        const storedRight = logoDataToStored(right, 'right');
        expect(storedLeft.id).toBe('logo-left');
        expect(storedRight.name).toBe('right.jpg');

        const restoredLeft = storedToLogoData(storedLeft);
        const restoredRight = storedToLogoData(storedRight);
        expect(restoredLeft.file.name).toBe('left.png');
        expect(restoredRight.file.type).toBe('image/jpeg');
    });

    it('round-trips branding for each report type including null logos', () => {
        for (const config of REPORT_TYPES) {
            const left: LogoData = {
                file: new File(['x'], `${config.id}-left.png`, { type: 'image/png' }),
                url: 'blob:l',
            };
            const stored = brandingToStored(config.id, left, null);
            expect(stored.reportType).toBe(config.id);
            expect(stored.logoLeft?.name).toBe(`${config.id}-left.png`);
            expect(stored.logoRight).toBeNull();

            const logos = storedToBrandingLogos(stored);
            expect(logos.logoLeft?.file.name).toBe(`${config.id}-left.png`);
            expect(logos.logoRight).toBeNull();
        }
    });
});

describe('panelToStored / storedToPanel', () => {
    beforeEach(() => {
        vi.stubGlobal('URL', {
            createObjectURL: vi.fn(() => 'blob:mock'),
            revokeObjectURL: vi.fn(),
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('round-trips a panel with photos and header', () => {
        const config = getReportConfig('panel-fotografico');
        const panel = createEmptyPanel(config);
        panel.header.CENTRO = 'CS Norte';
        panel.photos = [
            { id: 'p1', file: new File(['a'], '1.jpg', { type: 'image/jpeg' }), previewUrl: 'blob:1' },
            { id: 'p2', file: new File(['b'], '2.png', { type: 'image/png' }), previewUrl: 'blob:2' },
        ];

        const stored = panelToStored(panel, 'panel-fotografico');
        expect(stored.reportType).toBe('panel-fotografico');
        expect(stored.id).toBe(panel.id);
        expect(stored.header.CENTRO).toBe('CS Norte');
        expect(stored.photos).toHaveLength(2);
        expect(stored.photos[0].blob).toBeInstanceOf(Blob);

        const restored = storedToPanel(stored);
        expect(restored.id).toBe(panel.id);
        expect(restored.header.CENTRO).toBe('CS Norte');
        expect(restored.photos).toHaveLength(2);
        expect(restored.photos[0].file.name).toBe('1.jpg');
        expect(restored.photos[1].file.type).toBe('image/png');
        expect(restored.header).not.toBe(stored.header);
    });

    it('round-trips every field section for all 3 plantillas', () => {
        for (const config of REPORT_TYPES) {
            const panel = createEmptyPanel(config);
            for (const field of config.fields) {
                panel.header[field.key] = `val-${field.section ?? 'generales'}-${field.key}`;
            }
            panel.header.tituloSize = '22';
            panel.header.tituloColor = '#AABBCC';

            const stored = panelToStored(panel, config.id);
            const restored = storedToPanel(stored);

            const bySection = {
                generales: config.fields.filter((f) => (f.section ?? 'generales') === 'generales'),
                localizacion: config.fields.filter((f) => f.section === 'localizacion'),
                trabajo: config.fields.filter((f) => f.section === 'trabajo'),
            };

            for (const [section, fields] of Object.entries(bySection)) {
                for (const field of fields) {
                    expect(
                        restored.header[field.key],
                        `${config.id}.${section}.${field.key}`,
                    ).toBe(`val-${section}-${field.key}`);
                }
            }
            expect(restored.header.tituloSize).toBe('22');
            expect(restored.header.tituloColor).toBe('#AABBCC');
        }
    });
});
