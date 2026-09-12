import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useImageUploaderState } from './useImageUploaderState';

function asFileList(files: File[]): FileList {
  return {
    ...files,
    length: files.length,
    item: (index: number) => files[index] ?? null,
  } as unknown as FileList;
}

describe('useImageUploaderState', () => {
  it('preserves optional file filtering before onAdd', async () => {
    const jpeg = new File(['jpg'], 'photo.jpg', { type: 'image/jpeg' });
    const text = new File(['txt'], 'notes.txt', { type: 'text/plain' });
    const onAdd = vi.fn(async () => ['rechazado']);
    const { result } = renderHook(() => useImageUploaderState({
      images: [],
      onAdd,
      acceptFile: (file) => file.type === 'image/jpeg',
    }));

    await act(async () => {
      await result.current.handleFiles(asFileList([jpeg, text]));
    });

    expect(onAdd).toHaveBeenCalledWith([jpeg]);
    expect(result.current.errors).toEqual(['rechazado']);
  });

  it('keeps the first ten images collapsed and exposes the original indexes', () => {
    const images = Array.from({ length: 12 }, (_, index) => ({
      file: new File(['x'], `${index}.jpg`, { type: 'image/jpeg' }),
      objectUrl: `blob:${index}`,
    }));
    const { result } = renderHook(() => useImageUploaderState({ images, onAdd: () => [] }));

    expect(result.current.visibleImages).toHaveLength(10);
    expect(result.current.hiddenCount).toBe(2);

    act(() => result.current.toggleExpanded());
    expect(result.current.visibleImages).toHaveLength(12);
  });

  it('clamps hiddenCount to 0 when images length is below limit and resets inputRef', async () => {
    const { result } = renderHook(() => useImageUploaderState({ images: [], onAdd: () => [] }));
    expect(result.current.hiddenCount).toBe(0);

    const input = document.createElement('input');
    input.type = 'file';
    input.value = '';
    Object.defineProperty(result.current.inputRef, 'current', { value: input, writable: true });

    await act(async () => {
      await result.current.handleFiles(asFileList([]));
    });
    expect(input.value).toBe('');
  });
});
