import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { getReportConfig } from '../constants';
import { createEmptyPanel, useCampoPanels } from '../hooks/useCampoPanels';
import { derivePanelLabel } from '../utils/panelLabel';

vi.mock('../../../hooks/useToast', () => ({
    useToast: () => ({ addToast: vi.fn() }),
}));

describe('derivePanelLabel', () => {
    it('combines centro and fecha when available', () => {
        const config = getReportConfig('panel-fotografico');
        const header = {
            ...createEmptyPanel(config).header,
            CENTRO: 'CS Norte',
            FECHA_TRABAJO: '2026-06-24',
        };

        expect(derivePanelLabel(header)).toBe('CS Norte · 2026-06-24');
    });

    it('falls back to panel nuevo when empty', () => {
        const config = getReportConfig('panel-fotografico');
        expect(derivePanelLabel(createEmptyPanel(config).header)).toBe('Panel nuevo');
    });
});

describe('useCampoPanels', () => {
    const config = getReportConfig('panel-fotografico');

    beforeEach(() => {
        vi.stubGlobal('URL', {
            createObjectURL: vi.fn(() => 'blob:mock'),
            revokeObjectURL: vi.fn(),
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('creates an initial panel', () => {
        const { result } = renderHook(() => useCampoPanels(config));

        expect(result.current.panels.length).toBe(1);
        expect(result.current.selectedPanel).not.toBeNull();
    });

    it('creates and selects a new panel', () => {
        const { result } = renderHook(() => useCampoPanels(config));
        const firstId = result.current.selectedPanelId;

        act(() => {
            result.current.createPanel();
        });

        expect(result.current.panels.length).toBe(2);
        expect(result.current.selectedPanelId).not.toBe(firstId);
    });

    it('updates header and label on active panel', () => {
        const { result } = renderHook(() => useCampoPanels(config));

        act(() => {
            result.current.updateHeader('CENTRO', 'CS Lima');
        });

        expect(result.current.selectedPanel?.header.CENTRO).toBe('CS Lima');
        expect(result.current.selectedPanel?.label).toBe('CS Lima');
    });

    it('deletes a panel and keeps at least one', () => {
        const { result } = renderHook(() => useCampoPanels(config));
        const id = result.current.selectedPanelId!;

        act(() => {
            result.current.deletePanel(id);
        });

        expect(result.current.panels.length).toBe(1);
        expect(result.current.selectedPanelId).not.toBe(id);
    });

    it('navigates between panels', () => {
        const { result } = renderHook(() => useCampoPanels(config));
        const firstId = result.current.selectedPanelId!;

        act(() => {
            result.current.createPanel();
        });

        act(() => {
            result.current.goRelativePanel(1);
        });

        expect(result.current.selectedPanelId).not.toBe(firstId);

        act(() => {
            result.current.goRelativePanel(-1);
        });

        expect(result.current.selectedPanelId).toBe(firstId);
    });
});
