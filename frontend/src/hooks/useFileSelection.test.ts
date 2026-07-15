import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useFileSelection } from './useFileSelection';

describe('useFileSelection', () => {
  it('clears selectedFile when it leaves the file list', () => {
    const { result, rerender } = renderHook(
      ({ files }) => useFileSelection(files),
      { initialProps: { files: ['a.jpg', 'b.jpg'] } },
    );

    act(() => {
      result.current.setSelectedFile('a.jpg');
      result.current.setSelectedFiles(new Set(['a.jpg', 'b.jpg']));
    });
    expect(result.current.selectedFile).toBe('a.jpg');

    rerender({ files: ['b.jpg'] });
    expect(result.current.selectedFile).toBeNull();
    expect(result.current.selectedFiles.has('a.jpg')).toBe(false);
    expect(result.current.selectedFiles.has('b.jpg')).toBe(true);
  });
});
