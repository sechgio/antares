import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { getReportConfig } from '../constants';
import { useCampoPanels } from './useCampoPanels';
import { TITULO_COLOR_KEY, TITULO_SIZE_KEY } from '../utils/tituloStyle';
import type { StoredPanel } from '../types';

const savePanel = vi.fn(async () => undefined);
const loadPanelsByType = vi.fn(async () => [] as StoredPanel[]);
const deleteStoredPanel = vi.fn(async () => undefined);

vi.mock('../utils/storage', async () => {
    const actual = await vi.importActual<typeof import('../utils/storage')>('../utils/storage');
    return {
        ...actual,
        savePanel: (...args: unknown[]) => savePanel(...args),
        loadPanelsByType: (...args: unknown[]) => loadPanelsByType(...args),
        deleteStoredPanel: (...args: unknown[]) => deleteStoredPanel(...args),
    };
});

function makeFileList(files: File[]): FileList {
    const list = {
        length: files.length,
        item: (i: number) => files[i] ?? null,
        [Symbol.iterator]: function* () {
            yield* files;
        },
    } as FileList;
    files.forEach((file, i) => {
        Object.defineProperty(list, i, { value: file, enumerable: true });
    });
    return list;
}

describe('useCampoPanels persistence', () => {
    const config = getReportConfig('panel-fotografico');

    beforeEach(() => {
        vi.useFakeTimers();
        savePanel.mockClear();
        loadPanelsByType.mockClear();
        deleteStoredPanel.mockClear();
        loadPanelsByType.mockResolvedValue([]);
        vi.stubGlobal('URL', {
            createObjectURL: vi.fn(() => 'blob:mock'),
            revokeObjectURL: vi.fn(),
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('flushes pending header edits on unmount instead of dropping them', async () => {
        const { result, unmount } = renderHook(() => useCampoPanels(config));

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        act(() => {
            result.current.updateHeader('CENTRO', 'CS Norte');
            result.current.updateHeader('DISTRITO', 'Miraflores');
            result.current.updateHeader('ACTIVIDAD', 'Reparación');
            result.current.updateHeader('CUADRILLA', 'C-12');
            result.current.updateHeader('FECHA_TRABAJO', '2026-07-10');
            result.current.updateHeader('DIRECCIONES_AFECTADAS', 'Av. Principal 100');
            result.current.updateHeader('ESTADO', 'Lima');
        });

        expect(savePanel).not.toHaveBeenCalled();

        unmount();

        expect(savePanel).toHaveBeenCalledTimes(1);
        const stored = savePanel.mock.calls[0][0] as StoredPanel;
        expect(stored.reportType).toBe('panel-fotografico');
        expect(stored.header.CENTRO).toBe('CS Norte');
        expect(stored.header.DISTRITO).toBe('Miraflores');
        expect(stored.header.ACTIVIDAD).toBe('Reparación');
        expect(stored.header.CUADRILLA).toBe('C-12');
        expect(stored.header.FECHA_TRABAJO).toBe('2026-07-10');
        expect(stored.header.DIRECCIONES_AFECTADAS).toBe('Av. Principal 100');
        expect(stored.header.ESTADO).toBe('Lima');
    });

    it('persists all header fields after debounce settles', async () => {
        const { result } = renderHook(() => useCampoPanels(config));

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        act(() => {
            result.current.updateHeader('CENTRO', 'CS Sur');
            result.current.updateHeader('ESTADO', 'Lima');
        });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(500);
        });

        expect(savePanel).toHaveBeenCalled();
        const stored = savePanel.mock.calls.at(-1)![0] as StoredPanel;
        expect(stored.header.CENTRO).toBe('CS Sur');
        expect(stored.header.ESTADO).toBe('Lima');
    });

    it('persists titulo style keys with the header', async () => {
        const { result, unmount } = renderHook(() => useCampoPanels(config));

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        act(() => {
            result.current.updateHeader(TITULO_SIZE_KEY, '20');
            result.current.updateHeader(TITULO_COLOR_KEY, '#0066CC');
        });

        unmount();

        const stored = savePanel.mock.calls[0][0] as StoredPanel;
        expect(stored.header[TITULO_SIZE_KEY]).toBe('20');
        expect(stored.header[TITULO_COLOR_KEY]).toBe('#0066CC');
    });

    it('flushes previous template type when switching plantilla', async () => {
        const { result, rerender } = renderHook(
            ({ cfg }) => useCampoPanels(cfg),
            { initialProps: { cfg: config } },
        );

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        act(() => {
            result.current.updateHeader('CENTRO', 'CS Norte');
        });

        expect(savePanel).not.toHaveBeenCalled();

        const nextConfig = getReportConfig('desinfeccion-reservorios');
        rerender({ cfg: nextConfig });

        await act(async () => {
            await Promise.resolve();
        });

        expect(savePanel).toHaveBeenCalled();
        const stored = savePanel.mock.calls[0][0] as StoredPanel;
        expect(stored.reportType).toBe('panel-fotografico');
        expect(stored.header.CENTRO).toBe('CS Norte');
        expect(loadPanelsByType).toHaveBeenCalledWith('desinfeccion-reservorios');
    });

    it('restores all stored header fields on remount', async () => {
        const storedPanel: StoredPanel = {
            id: 'panel-restored',
            reportType: 'panel-fotografico',
            label: 'CS Norte · 2026-07-10',
            header: {
                titulo: 'Panel Fotográfico',
                CENTRO: 'CS Norte',
                FECHA_TRABAJO: '2026-07-10',
                DIRECCIONES_AFECTADAS: 'Calle 1',
                DISTRITO: 'Miraflores',
                ESTADO: 'Lima',
                ACTIVIDAD: 'Reparación',
                CUADRILLA: 'C-12',
                [TITULO_SIZE_KEY]: '18',
                [TITULO_COLOR_KEY]: '#112233',
            },
            createdAt: 1,
            updatedAt: 2,
            photos: [],
        };
        loadPanelsByType.mockResolvedValue([storedPanel]);

        const { result } = renderHook(() => useCampoPanels(config));

        await act(async () => {
            await vi.runAllTimersAsync();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(result.current.panels).toHaveLength(1);
        expect(result.current.selectedPanel?.id).toBe('panel-restored');
        expect(result.current.selectedPanel?.header.CENTRO).toBe('CS Norte');
        expect(result.current.selectedPanel?.header.DISTRITO).toBe('Miraflores');
        expect(result.current.selectedPanel?.header.ACTIVIDAD).toBe('Reparación');
        expect(result.current.selectedPanel?.header.CUADRILLA).toBe('C-12');
        expect(result.current.selectedPanel?.header[TITULO_SIZE_KEY]).toBe('18');
        expect(result.current.selectedPanel?.header[TITULO_COLOR_KEY]).toBe('#112233');
    });

    it('persists photos on unmount flush', async () => {
        const { result, unmount } = renderHook(() => useCampoPanels(config));

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        const file = new File(['img'], 'foto.jpg', { type: 'image/jpeg' });
        act(() => {
            result.current.addPhotos(makeFileList([file]));
        });

        unmount();

        const stored = savePanel.mock.calls[0][0] as StoredPanel;
        expect(stored.photos).toHaveLength(1);
        expect(stored.photos[0].name).toBe('foto.jpg');
        expect(stored.photos[0].type).toBe('image/jpeg');
    });

    it('deletes stored panel and cancels pending flush for that id', async () => {
        const { result } = renderHook(() => useCampoPanels(config));

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        const id = result.current.selectedPanelId!;
        act(() => {
            result.current.updateHeader('CENTRO', 'Temp');
        });
        act(() => {
            result.current.deletePanel(id);
        });

        expect(deleteStoredPanel).toHaveBeenCalledWith(id);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(500);
        });

        const savedIds = savePanel.mock.calls.map((c) => (c[0] as StoredPanel).id);
        expect(savedIds).not.toContain(id);
    });

    it('flushes every field of each plantilla on unmount', async () => {
        for (const typeId of ['panel-fotografico', 'desinfeccion-reservorios', 'maquina-balde'] as const) {
            savePanel.mockClear();
            loadPanelsByType.mockResolvedValue([]);
            const cfg = getReportConfig(typeId);
            const { result, unmount } = renderHook(() => useCampoPanels(cfg));

            await act(async () => {
                await vi.runAllTimersAsync();
            });

            act(() => {
                for (const field of cfg.fields) {
                    result.current.updateHeader(field.key, `${typeId}-${field.key}`);
                }
            });

            unmount();

            expect(savePanel, typeId).toHaveBeenCalled();
            const stored = savePanel.mock.calls.at(-1)![0] as StoredPanel;
            expect(stored.reportType).toBe(typeId);
            for (const field of cfg.fields) {
                expect(stored.header[field.key], `${typeId}.${field.key}`).toBe(`${typeId}-${field.key}`);
            }
        }
    });
});
