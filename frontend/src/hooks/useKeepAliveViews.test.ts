import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KEEP_ALIVE_LIMIT, KEEP_ALIVE_VIEWS, bumpKeepAliveOrder, useKeepAliveViews } from './useKeepAliveViews';
import type { TabId } from '../navigation';

describe('bumpKeepAliveOrder', () => {
  it('pone el tab al frente sin duplicarlo', () => {
    expect(bumpKeepAliveOrder(['espacios', 'convert'], 'convert')).toEqual(['convert', 'espacios']);
    expect(bumpKeepAliveOrder([], 'espacios')).toEqual(['espacios']);
  });

  it('desaloja el menos usado recientemente al superar el límite', () => {
    let order: readonly TabId[] = [];
    for (const tab of ['espacios', 'convert', 'formatos'] as TabId[]) {
      order = bumpKeepAliveOrder(order, tab);
    }
    expect(order).toEqual(['formatos', 'convert', 'espacios']);
    order = bumpKeepAliveOrder(order, 'padron');
    expect(order).toEqual(['padron', 'formatos', 'convert']);
    expect(order).not.toContain('espacios');
    expect(order.length).toBe(KEEP_ALIVE_LIMIT);
  });

  it('reentrar a un tab ya presente no desaloja a los demás', () => {
    const order = bumpKeepAliveOrder(['formatos', 'convert', 'espacios'], 'espacios');
    expect(order).toEqual(['espacios', 'formatos', 'convert']);
  });
});

describe('useKeepAliveViews', () => {
  it('registra las vistas de la lista blanca en orden de uso', () => {
    const { result, rerender } = renderHook(({ tab }) => useKeepAliveViews(tab), {
      initialProps: { tab: 'previewPanel' as TabId },
    });
    expect(result.current).toEqual([]);

    rerender({ tab: 'espacios' });
    expect(result.current).toEqual(['espacios']);

    rerender({ tab: 'convert' });
    expect(result.current).toEqual(['convert', 'espacios']);

    rerender({ tab: 'espacios' });
    expect(result.current).toEqual(['espacios', 'convert']);
  });

  it('ignora las vistas fuera de la lista blanca y conserva el orden previo', () => {
    const { result, rerender } = renderHook(({ tab }) => useKeepAliveViews(tab), {
      initialProps: { tab: 'espacios' as TabId },
    });
    expect(result.current).toEqual(['espacios']);

    rerender({ tab: 'formatos' });
    expect(result.current).toEqual(['espacios']);

    rerender({ tab: 'padron' });
    expect(result.current).toEqual(['espacios']);
  });

  it('la lista blanca arranca solo con espacios y convert', () => {
    expect([...KEEP_ALIVE_VIEWS].sort()).toEqual(['convert', 'espacios']);
  });
});
