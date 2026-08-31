import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConversionFileRefs } from './useConversionFileRefs';

describe('useConversionFileRefs', () => {
  const previousElectronApi = window.electronAPI;

  afterEach(() => {
    window.electronAPI = previousElectronApi;
  });

  it('keeps browser fallback references usable without the Electron bridge', async () => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = {};
    const { result } = renderHook(() => useConversionFileRefs(['foto.jpg']));
    const file = new File(['foto'], 'foto.jpg', { type: 'image/jpeg' });

    act(() => result.current.mergeFiles(['foto.jpg'], [], [file]));

    expect(result.current.fileRefsReady).toBe(true);
    await expect(result.current.resolveFileRefs(['foto.jpg'])).resolves.toEqual(['foto.jpg']);
  });

  it('stages File objects and reuses dialog tokens only when no File is attached', async () => {
    const create = vi.fn(async (name: string) => ({ token: `staged-${name}` }));
    const complete = vi.fn(async (token: string) => ({ file_token: `antares-read_${token}` }));
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      fileStagedCreate: create,
      fileStagedAppend: vi.fn(async () => undefined),
      fileStagedComplete: complete,
    };
    const { result } = renderHook(() => useConversionFileRefs(['foto.jpg', 'otro.jpg']));

    act(() => {
      result.current.mergeFiles(['foto.jpg'], [], [new File(['foto'], 'foto.jpg', { type: 'image/jpeg' })]);
      result.current.mergeFiles(['otro.jpg'], ['antares-read_dialog']);
    });

    expect(result.current.fileRefsReady).toBe(true);
    await expect(result.current.resolveFileRefs(['foto.jpg', 'otro.jpg']))
      .resolves.toEqual(['antares-read_staged-foto.jpg', 'antares-read_dialog']);
    expect(create).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith('staged-foto.jpg');
  });
});
