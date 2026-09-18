import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useOperationCoordinator } from './useOperationCoordinator';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useOperationCoordinator', () => {
  it('busy es false al inicio y true durante la operación', async () => {
    const { result } = renderHook(() => useOperationCoordinator());
    expect(result.current.busy).toBe(false);
    const d = deferred<string>();
    let op: Promise<string>;
    act(() => {
      op = result.current.runOperation(() => d.promise);
    });
    expect(result.current.busy).toBe(true);
    await act(async () => {
      d.resolve('ok');
      await op!;
    });
    expect(result.current.busy).toBe(false);
  });

  it('busy permanece true hasta que terminen todas las operaciones solapadas', async () => {
    const { result } = renderHook(() => useOperationCoordinator());
    const d1 = deferred<void>();
    const d2 = deferred<void>();
    let p1: Promise<void>;
    let p2: Promise<void>;
    act(() => {
      p1 = result.current.runOperation(() => d1.promise);
      p2 = result.current.runOperation(() => d2.promise);
    });
    expect(result.current.busy).toBe(true);
    await act(async () => {
      d1.resolve();
      await p1!;
    });
    expect(result.current.busy).toBe(true);
    await act(async () => {
      d2.resolve();
      await p2!;
    });
    expect(result.current.busy).toBe(false);
  });

  it('una operación que falla libera busy y propaga el error', async () => {
    const { result } = renderHook(() => useOperationCoordinator());
    const boom = new Error('fallo');
    let caught: unknown;
    await act(async () => {
      await result.current
        .runOperation(() => Promise.reject(boom))
        .catch((e) => {
          caught = e;
        });
    });
    expect(caught).toBe(boom);
    expect(result.current.busy).toBe(false);
  });

  it('runOperation devuelve el resultado de la operación', async () => {
    const { result } = renderHook(() => useOperationCoordinator());
    let value: number | undefined;
    await act(async () => {
      value = await result.current.runOperation(async () => 42);
    });
    expect(value).toBe(42);
  });
});
