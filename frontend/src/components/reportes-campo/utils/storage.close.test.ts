import { afterEach, expect, it, vi } from 'vitest';
import type { StoredBranding, StoredPanel } from '../types';
import { deleteStoredPanel, loadBranding, loadPanelsByType, saveBranding, savePanel } from './storage';

function installDb(failRead = false) {
    const close = vi.fn();
    const read = {
        result: [], error: new Error('read failed'),
        onsuccess: null as (() => void) | null, onerror: null as (() => void) | null,
    };
    const brandingRead = {
        result: undefined, error: null,
        onsuccess: null as (() => void) | null, onerror: null as (() => void) | null,
    };
    const tx = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        objectStore: () => ({
            index: () => ({ getAll: () => {
                queueMicrotask(() => failRead ? read.onerror?.() : read.onsuccess?.());
                return read;
            } }),
            get: () => {
                queueMicrotask(() => brandingRead.onsuccess?.());
                return brandingRead;
            },
            put: () => queueMicrotask(() => tx.oncomplete?.()),
            delete: () => queueMicrotask(() => tx.oncomplete?.()),
        }),
    };
    const db = { close, transaction: () => tx };
    vi.stubGlobal('indexedDB', { open: () => {
        const request = { result: db, onsuccess: null as (() => void) | null };
        queueMicrotask(() => request.onsuccess?.());
        return request;
    } });
    vi.stubGlobal('IDBKeyRange', { only: (value: string) => value });
    return close;
}

afterEach(() => vi.unstubAllGlobals());

it('closes each Reportes de Campo database connection after reads and writes', async () => {
    const close = installDb();
    await loadPanelsByType('panel-fotografico');
    await loadBranding('panel-fotografico');
    await savePanel({} as StoredPanel);
    await deleteStoredPanel('panel-1');
    await saveBranding({} as StoredBranding);
    expect(close).toHaveBeenCalledTimes(5);
});

it('closes the Reportes de Campo connection when a read fails', async () => {
    const close = installDb(true);
    await expect(loadPanelsByType('panel-fotografico')).rejects.toThrow('read failed');
    expect(close).toHaveBeenCalledOnce();
});
