import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('no actualiza antes del delay y sí después', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 100), {
      initialProps: { v: 'a' },
    });
    expect(result.current).toBe('a');
    rerender({ v: 'b' });
    expect(result.current).toBe('a');
    act(() => vi.advanceTimersByTime(99));
    expect(result.current).toBe('a');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe('b');
  });

  it('cambios rápidos solo emiten el último valor', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 100), {
      initialProps: { v: 'a' },
    });
    rerender({ v: 'b' });
    act(() => vi.advanceTimersByTime(50));
    rerender({ v: 'c' });
    act(() => vi.advanceTimersByTime(50));
    rerender({ v: 'd' });
    act(() => vi.advanceTimersByTime(99));
    expect(result.current).toBe('a');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe('d');
  });

  it('un cambio de delayMs reinicia la ventana', () => {
    const { result, rerender } = renderHook(
      ({ v, d }) => useDebouncedValue(v, d),
      { initialProps: { v: 'a', d: 200 } },
    );
    rerender({ v: 'b', d: 50 });
    act(() => vi.advanceTimersByTime(60));
    expect(result.current).toBe('b');
  });

  it('al desmontar cancela el timer pendiente', () => {
    const { result, rerender, unmount } = renderHook(({ v }) => useDebouncedValue(v, 100), {
      initialProps: { v: 'a' },
    });
    rerender({ v: 'b' });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(500));
    expect(result.current).toBe('a');
  });
});
