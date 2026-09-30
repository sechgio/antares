import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getPluginOrder, isPluginEnabled, setPluginOrder, usePluginEnabled, usePluginOrder } from './plugins';

afterEach(() => {
  localStorage.clear();
});

describe('usePluginEnabled', () => {
  it('applies a flag written by another window on the storage event', () => {
    const { result } = renderHook(() => usePluginEnabled('audius'));
    expect(result.current).toBe(false);

    act(() => {
      localStorage.setItem('plugin.audius.enabled', 'true');
      window.dispatchEvent(new StorageEvent('storage', { key: 'plugin.audius.enabled' }));
    });

    expect(result.current).toBe(true);
    expect(isPluginEnabled('audius')).toBe(true);
  });

  it('keeps the default when the storage event is about another key', () => {
    const { result } = renderHook(() => usePluginEnabled('radio-live'));

    act(() => {
      localStorage.setItem('plugin.audius.enabled', 'false');
      window.dispatchEvent(new StorageEvent('storage', { key: 'plugin.audius.enabled' }));
    });

    expect(result.current).toBe(true);
  });
});

describe('usePluginOrder', () => {
  it('defaults to the declaration order', () => {
    const { result } = renderHook(() => usePluginOrder());
    expect(result.current).toEqual(['radio-live', 'spotify', 'audius', 'jamendo', 'archive']);
  });

  it('persists the order and drops unknown ids', () => {
    setPluginOrder(['audius', 'bogus' as never, 'radio-live']);

    expect(getPluginOrder()).toEqual(['audius', 'radio-live', 'spotify', 'jamendo', 'archive']);
    expect(JSON.parse(localStorage.getItem('plugins.titlebar.order')!)).toEqual([
      'audius',
      'radio-live',
      'spotify',
      'jamendo',
      'archive',
    ]);
  });

  it('appends plugins missing from a partial stored order', () => {
    localStorage.setItem('plugins.titlebar.order', JSON.stringify(['spotify']));

    expect(getPluginOrder()).toEqual(['spotify', 'radio-live', 'audius', 'jamendo', 'archive']);
  });

  it('reflects an order written by another window on the storage event', () => {
    const { result } = renderHook(() => usePluginOrder());

    act(() => {
      localStorage.setItem('plugins.titlebar.order', JSON.stringify(['audius', 'spotify', 'radio-live']));
      window.dispatchEvent(new StorageEvent('storage', { key: 'plugins.titlebar.order' }));
    });

    expect(result.current).toEqual(['audius', 'spotify', 'radio-live', 'jamendo', 'archive']);
  });
});
