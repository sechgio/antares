import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from './async';

afterEach(() => vi.useRealTimers());

describe('withTimeout', () => {
  it('devuelve el resultado y elimina el timer', async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve(42), 50, 'export')).resolves.toBe(42);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('conserva el error original y elimina el timer', async () => {
    vi.useFakeTimers();
    const error = new Error('fallo de exportación');
    await expect(withTimeout(Promise.reject(error), 50, 'export')).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('acepta thenables', async () => {
    vi.useFakeTimers();
    const source = Promise.resolve(7);
    const thenable: PromiseLike<number> = { then: source.then.bind(source) };
    await expect(withTimeout(thenable, 50, 'export')).resolves.toBe(7);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['resolve', 'reject'] as const)('ignora una finalización tardía: %s', async (outcome) => {
    vi.useFakeTimers();
    let resolve!: (value: number) => void;
    let reject!: (error: Error) => void;
    const source = new Promise<number>((res, rej) => { resolve = res; reject = rej; });
    const pending = withTimeout(source, 50, 'export');
    const rejected = expect(pending).rejects.toThrow('export timed out after 50ms');
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    if (outcome === 'resolve') resolve(42);
    else reject(new Error('fallo tardío'));
    await vi.runAllTimersAsync();
    await expect(pending).rejects.toThrow('export timed out after 50ms');
    expect(vi.getTimerCount()).toBe(0);
  });
});
