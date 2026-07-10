import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCampoBranding } from './useCampoBranding';
import type { StoredBranding } from '../types';

const saveBranding = vi.fn(async () => undefined);
const loadBranding = vi.fn(async () => null as StoredBranding | null);

vi.mock('../utils/storage', async () => {
    const actual = await vi.importActual<typeof import('../utils/storage')>('../utils/storage');
    return {
        ...actual,
        saveBranding: (...args: unknown[]) => saveBranding(...args),
        loadBranding: (...args: unknown[]) => loadBranding(...args),
    };
});

function makeFileList(file: File): FileList {
    const list = {
        length: 1,
        item: (i: number) => (i === 0 ? file : null),
        0: file,
        [Symbol.iterator]: function* () {
            yield file;
        },
    };
    return list as unknown as FileList;
}

describe('useCampoBranding', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        saveBranding.mockClear();
        loadBranding.mockClear();
        loadBranding.mockResolvedValue(null);
        vi.stubGlobal('URL', {
            createObjectURL: vi.fn((blob: Blob) => `blob:${(blob as File).name ?? 'x'}`),
            revokeObjectURL: vi.fn(),
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('flushes logos on unmount', async () => {
        const { result, unmount } = renderHook(() => useCampoBranding('panel-fotografico'));

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        act(() => {
            result.current.setLogo('left', makeFileList(new File(['L'], 'left.png', { type: 'image/png' })));
            result.current.setLogo('right', makeFileList(new File(['R'], 'right.png', { type: 'image/png' })));
        });

        expect(saveBranding).not.toHaveBeenCalled();
        unmount();

        expect(saveBranding).toHaveBeenCalledTimes(1);
        const stored = saveBranding.mock.calls[0][0] as StoredBranding;
        expect(stored.reportType).toBe('panel-fotografico');
        expect(stored.logoLeft?.name).toBe('left.png');
        expect(stored.logoRight?.name).toBe('right.png');
    });

    it('restores logos from storage on mount', async () => {
        loadBranding.mockResolvedValue({
            reportType: 'maquina-balde',
            logoLeft: {
                id: 'logo-left',
                name: 'empresa.png',
                type: 'image/png',
                blob: new Blob(['x'], { type: 'image/png' }),
            },
            logoRight: null,
            updatedAt: 1,
        });

        const { result } = renderHook(() => useCampoBranding('maquina-balde'));

        await act(async () => {
            await vi.runAllTimersAsync();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(result.current.logoLeft?.file.name).toBe('empresa.png');
        expect(result.current.logoRight).toBeNull();
    });

    it('flushes previous plantilla branding when switching type', async () => {
        const { result, rerender } = renderHook(
            ({ type }) => useCampoBranding(type),
            { initialProps: { type: 'panel-fotografico' as const } },
        );

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        act(() => {
            result.current.setLogo('left', makeFileList(new File(['L'], 'a.png', { type: 'image/png' })));
        });

        rerender({ type: 'desinfeccion-reservorios' });

        await act(async () => {
            await Promise.resolve();
        });

        expect(saveBranding).toHaveBeenCalled();
        const stored = saveBranding.mock.calls[0][0] as StoredBranding;
        expect(stored.reportType).toBe('panel-fotografico');
        expect(loadBranding).toHaveBeenCalledWith('desinfeccion-reservorios');
    });
});
