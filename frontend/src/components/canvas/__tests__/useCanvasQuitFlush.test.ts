import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasDocument } from '../types';
import type { CanvasHistoryHandle } from '../hooks/useCanvasHistory';

const notifyMock = vi.hoisted(() => ({
  onNotify: vi.fn(),
}));

vi.mock('../../../api', () => ({
  api: {
    canvasSave: vi.fn(),
    canvasSaveHistory: vi.fn(),
  },
  onNotify: notifyMock.onNotify,
}));

vi.mock('../../../utils/ackCanvasFlush', () => ({
  acknowledgeCanvasFlush: vi.fn(async () => {}),
}));

vi.mock('../../../utils/observability', () => ({
  reportFrontendEvent: vi.fn(),
}));

vi.mock('../hooks/useCanvasSync', () => ({
  isOpenDocumentDirty: vi.fn(() => false),
}));

vi.mock('../utils/imageBlobStore', () => ({
  serializeDocumentImages: vi.fn(async (doc: CanvasDocument) => doc),
  serializeHistorySteps: vi.fn(async (steps: unknown[]) => steps),
}));

import { api } from '../../../api';
import { useCanvasQuitFlush } from '../hooks/useCanvasQuitFlush';

function makeHistory(): CanvasHistoryHandle {
  const document = {
    id: 'doc-1',
    name: 'Doc',
  } as CanvasDocument;
  return {
    document,
    documentRef: { current: document },
    hasUnsavedEditsRef: { current: true },
    past: [],
    future: [],
    markSaved: vi.fn(),
  } as unknown as CanvasHistoryHandle;
}

describe('useCanvasQuitFlush', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.canvasSave).mockResolvedValue({ document: makeHistory().document });
    vi.mocked(api.canvasSaveHistory).mockResolvedValue({ success: true });
  });

  it('marks saved state after local fallback when onSave fails', async () => {
    let listener: ((method: string) => Promise<void>) | undefined;
    notifyMock.onNotify.mockImplementation((callback: (method: string) => Promise<void>) => {
      listener = callback;
      return vi.fn();
    });

    const history = makeHistory();
    const onSave = vi.fn(async () => false);
    renderHook(() => useCanvasQuitFlush({
      history,
      editingLayerId: null,
      commitInlineEdit: vi.fn(),
      commitPageLayersGesture: vi.fn(),
      onPanelCommitLive: vi.fn(),
      onSave,
      panelBaselineRef: { current: null },
      gestureBaselineRef: { current: null },
      renameBaselineRef: { current: null },
      openDirtyRef: { current: true },
    }));

    await act(async () => {
      await listener?.('app.flush-canvas-before-quit');
    });

    expect(onSave).toHaveBeenCalledWith({ silent: true });
    expect(api.canvasSave).toHaveBeenCalled();
    expect(api.canvasSaveHistory).toHaveBeenCalledWith('doc-1', [], []);
    expect(history.markSaved).toHaveBeenCalled();
  });
});
