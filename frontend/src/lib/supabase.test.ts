import { beforeEach, describe, expect, it } from 'vitest';

import { createSecureSupabaseStorage } from './supabase';

type Blob = Record<string, string>;

function installBridge(puts: Blob[], seed: Blob | null = null): void {
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    invoke: (method: string, params?: { blob?: Blob }) => {
      if (method === 'supabase_session_get') return Promise.resolve({ blob: seed });
      if (method === 'supabase_session_put' && params?.blob) puts.push({ ...params.blob });
      return Promise.resolve({ success: true });
    },
  };
}

describe('createSecureSupabaseStorage (sb-011)', () => {
  beforeEach(() => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = undefined;
    const legacyKeys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith('sb-')) legacyKeys.push(key);
    }
    for (const key of legacyKeys) window.localStorage.removeItem(key);
  });

  it('devuelve null solo sin bridge: fuera de Electron cae al storage clasico', async () => {
    expect(createSecureSupabaseStorage()).toBeNull();
    expect(createSecureSupabaseStorage()).toBeNull();
  });

  it('con bridge y sin seed (primer arranque) instala storage seguro con blob vacio', async () => {
    const puts: Blob[] = [];
    installBridge(puts);
    const storage = createSecureSupabaseStorage();
    expect(storage).not.toBeNull();
    expect(await storage!.getItem('sb-proyecto-auth-token')).toBeNull();

    await storage!.setItem('sb-proyecto-auth-token', 'token-inicial');
    expect(puts.at(-1)).toEqual({ 'sb-proyecto-auth-token': 'token-inicial' });
  });

  it('migra claves sb-* del localStorage clasico al blob cifrado y las elimina del origen', async () => {
    window.localStorage.setItem('sb-proyecto-auth-token', 'token-legacy');
    window.localStorage.setItem('sb-proyecto-auth-token-code-verifier', 'verifier-legacy');
    window.localStorage.setItem('otra-clave', 'intocable');
    const puts: Blob[] = [];
    installBridge(puts);

    const storage = createSecureSupabaseStorage();

    expect(storage).not.toBeNull();
    expect(await storage!.getItem('sb-proyecto-auth-token')).toBe('token-legacy');
    expect(await storage!.getItem('sb-proyecto-auth-token-code-verifier')).toBe('verifier-legacy');
    expect(window.localStorage.getItem('sb-proyecto-auth-token')).toBeNull();
    expect(window.localStorage.getItem('sb-proyecto-auth-token-code-verifier')).toBeNull();
    expect(window.localStorage.getItem('otra-clave')).toBe('intocable');
    expect(puts.at(-1)).toEqual({
      'sb-proyecto-auth-token': 'token-legacy',
      'sb-proyecto-auth-token-code-verifier': 'verifier-legacy',
    });
  });

  it('no sobrescribe claves ya presentes en el seed cifrado pero igual limpia el legacy', async () => {
    window.localStorage.setItem('sb-proyecto-auth-token', 'token-legacy-obsoleto');
    const puts: Blob[] = [];
    installBridge(puts, { 'sb-proyecto-auth-token': 'token-cifrado-vigente' });

    const storage = createSecureSupabaseStorage();

    expect(await storage!.getItem('sb-proyecto-auth-token')).toBe('token-cifrado-vigente');
    expect(window.localStorage.getItem('sb-proyecto-auth-token')).toBeNull();
    expect(puts).toEqual([]);
  });

  it('con seed e bridge: get/put/remove persisten el blob completo cifrado', async () => {
    const puts: Blob[] = [];
    installBridge(puts, { 'sb-seed': 'seeded' });
    const storage = createSecureSupabaseStorage();
    expect(storage).not.toBeNull();
    expect(await storage!.getItem('sb-seed')).toBe('seeded');
    expect(await storage!.getItem('ausente')).toBeNull();

    await storage!.setItem('sb-seed', 'rota-do');
    await storage!.setItem('nuevo', 'valor');
    expect(puts.at(-1)).toEqual({ 'sb-seed': 'rota-do', nuevo: 'valor' });

    await storage!.removeItem('nuevo');
    expect(puts.at(-1)).toEqual({ 'sb-seed': 'rota-do' });
    expect(await storage!.getItem('nuevo')).toBeNull();
  });

  it('la sesion se hidrata por IPC sin exponerse en ningun global de la ventana', async () => {
    const win = window as unknown as Record<string, unknown>;
    const puts: Blob[] = [];
    installBridge(puts, { 'sb-seed': 'secreto-consumido' });

    const storage = createSecureSupabaseStorage();

    expect(storage).not.toBeNull();
    expect(await storage!.getItem('sb-seed')).toBe('secreto-consumido');
    for (const key of Object.keys(win)) {
      expect(key.startsWith('supabase')).toBe(false);
    }
  });
});
