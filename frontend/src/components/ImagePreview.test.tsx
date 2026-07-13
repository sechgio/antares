import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

const mockApi = vi.hoisted(() => ({
  previewImage: vi.fn(),
}));

vi.mock('../api', () => ({ api: mockApi, onNotify: () => () => {} }));

import ImagePreview, { __clearImagePreviewCacheForTests } from './ImagePreview';

describe('ImagePreview single-flight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    __clearImagePreviewCacheForTests();
    mockApi.previewImage.mockResolvedValue({
      preview: 'data:image/jpeg;base64,AAA',
      width: '100',
      height: '80',
      orig_size_kb: '12',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    __clearImagePreviewCacheForTests();
  });

  it('debounces rapid prop changes and calls with the latest params', async () => {
    const { rerender } = render(
      <ImagePreview path="C:/a.jpg" formato="JPEG" calidad={80} resizeAncho="" resizeAlto="" />,
    );

    // Rapid scrub of quality — only last value should matter after debounce.
    for (const q of [81, 82, 83, 84, 85]) {
      rerender(
        <ImagePreview path="C:/a.jpg" formato="JPEG" calidad={q} resizeAncho="" resizeAlto="" />,
      );
    }

    expect(mockApi.previewImage).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    await waitFor(() => expect(mockApi.previewImage).toHaveBeenCalled());
    expect(mockApi.previewImage).toHaveBeenCalledTimes(1);
    expect(mockApi.previewImage).toHaveBeenCalledWith({
      path: 'C:/a.jpg',
      formato: 'JPEG',
      calidad: 85,
      resize: null,
    });
  });

  it('does not stack concurrent preview_image; final call uses latest props', async () => {
    let resolveFirst: ((v: unknown) => void) | null = null;
    mockApi.previewImage
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        preview: 'data:image/jpeg;base64,BBB',
        width: '200',
        height: '160',
        orig_size_kb: '20',
      });

    const { rerender } = render(
      <ImagePreview path="C:/a.jpg" formato="JPEG" calidad={50} resizeAncho="" resizeAlto="" />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    await waitFor(() => expect(mockApi.previewImage).toHaveBeenCalledTimes(1));

    // Change props while first request is still in flight.
    rerender(
      <ImagePreview path="C:/a.jpg" formato="PNG" calidad={90} resizeAncho="" resizeAlto="" />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    // Should not have started a second concurrent call yet (single-flight queues).
    expect(mockApi.previewImage).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst?.({
        preview: 'data:image/jpeg;base64,AAA',
        width: '100',
        height: '80',
        orig_size_kb: '12',
      });
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
    });

    await waitFor(() => expect(mockApi.previewImage).toHaveBeenCalledTimes(2));
    expect(mockApi.previewImage).toHaveBeenLastCalledWith({
      path: 'C:/a.jpg',
      formato: 'PNG',
      calidad: 90,
      resize: null,
    });

    // Intermediate (JPEG/50) result must not remain; final call's meta sticks.
    await waitFor(() => {
      expect(screen.getByText(/200×160px/)).toBeInTheDocument();
    });
    // imgs use alt="" so role is presentation, not img
    const previewImgs = document.querySelectorAll('img');
    const converted = Array.from(previewImgs).find((img) => img.src.includes('base64,BBB'));
    expect(converted).toBeTruthy();
  });

  it('cache hit skips IPC for the same params', async () => {
    mockApi.previewImage.mockResolvedValue({
      preview: 'data:image/jpeg;base64,CACHED',
      width: '10',
      height: '10',
      orig_size_kb: '1',
    });

    const { unmount } = render(
      <ImagePreview path="C:/cache.jpg" formato="JPEG" calidad={95} resizeAncho="" resizeAlto="" />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    await waitFor(() => expect(mockApi.previewImage).toHaveBeenCalledTimes(1));

    unmount();

    render(
      <ImagePreview path="C:/cache.jpg" formato="JPEG" calidad={95} resizeAncho="" resizeAlto="" />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    // Second mount with same params should hit LRU and not call IPC again.
    expect(mockApi.previewImage).toHaveBeenCalledTimes(1);
  });
});
