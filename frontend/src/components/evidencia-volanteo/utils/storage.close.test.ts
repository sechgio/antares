import { afterEach, expect, it, vi } from 'vitest';
import type { EvidenciaSession } from '../types';
import { loadSession, saveSession } from './storage';

function installDb(failRead = false) {
  const close = vi.fn();
  const read = {
    result: undefined, error: new Error('read failed'),
    onsuccess: null as (() => void) | null, onerror: null as (() => void) | null,
  };
  const tx = {
    oncomplete: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onabort: null as (() => void) | null,
    objectStore: () => ({
      get: () => {
        queueMicrotask(() => failRead ? read.onerror?.() : read.onsuccess?.());
        return read;
      },
      put: () => queueMicrotask(() => tx.oncomplete?.()),
    }),
  };
  const db = { close, transaction: () => tx };
  vi.stubGlobal('indexedDB', { open: () => {
    const request = { result: db, onsuccess: null as (() => void) | null };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  } });
  return close;
}

afterEach(() => vi.unstubAllGlobals());

it('closes Evidencia Volanteo connections after reading and saving', async () => {
  const close = installDb();
  await loadSession();
  await saveSession({
    title: 'Informe', cuadranteLabel: 'A', showCuadranteLabel: true,
    cuadranteRanges: [], logoLeft: null, logoRight: null, images: [], updatedAt: 0,
  } as EvidenciaSession);
  expect(close).toHaveBeenCalledTimes(2);
});

it('closes the Evidencia Volanteo connection when a read fails', async () => {
  const close = installDb(true);
  await expect(loadSession()).rejects.toThrow('read failed');
  expect(close).toHaveBeenCalledOnce();
});
