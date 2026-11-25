import { beforeEach, describe, expect, it } from 'vitest';

import { createSecureSupabaseStorage } from './supabase';

type Blob = Record<string, string>;

function installBridge(puts: Blob[]): void {
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    invoke: (method: string, params?: { blob?: Blob }) => {
      if (method === 'supabase_session_put' && params?.blob) puts.push({ ...params.blob });
      return Promise.resolve({ success: true });
    },
  };
}

describe('createSecureSupabaseStorage (sb-011)', () => {
  beforeEach(() => {
    (window as unknown as { supabaseSessionSeed?: unknown }).supabaseSessionSeed = undefined;
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
    (window as unknown as { supabaseSessionSeed?: unknown }).supabaseSessionSeed = { 'sb-seed': 'x' };
    expect(createSecureSupabaseStorage()).toBeNull();
  });

  it('con bridge y sin seed (primer arranque) instala storage seguro con blob vacio', async () => {
    const puts: Blob[] = [];
    installBridge(puts);
    const storage = createSecureSupabaseStorage();
    expect(storage).not.toBeNull();
    expect(storage!.getItem('sb-proyecto-auth-token')).toBeNull();

    storage!.setItem('sb-proyecto-auth-token', 'token-inicial');
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
    expect(storage!.getItem('sb-proyecto-auth-token')).toBe('token-legacy');
    expect(storage!.getItem('sb-proyecto-auth-token-code-verifier')).toBe('verifier-legacy');
    expect(window.localStorage.getItem('sb-proyecto-auth-token')).toBeNull();
    expect(window.localStorage.getItem('sb-proyecto-auth-token-code-verifier')).toBeNull();
    expect(window.localStorage.getItem('otra-clave')).toBe('intocable');
    expect(puts.at(-1)).toEqual({
      'sb-proyecto-auth-token': 'token-legacy',
      'sb-proyecto-auth-token-code-verifier': 'verifier-legacy',
    });
  });

  it('no sobrescribe claves ya presentes en el seed cifrado pero igual limpia el legacy', async () => {
    (window as unknown as { supabaseSessionSeed?: unknown }).supabaseSessionSeed = {
      'sb-proyecto-auth-token': 'token-cifrado-vigente',
    };
    window.localStorage.setItem('sb-proyecto-auth-token', 'token-legacy-obsoleto');
    const puts: Blob[] = [];
    installBridge(puts);

    const storage = createSecureSupabaseStorage();

    expect(storage!.getItem('sb-proyecto-auth-token')).toBe('token-cifrado-vigente');
    expect(window.localStorage.getItem('sb-proyecto-auth-token')).toBeNull();
    expect(puts).toEqual([]);
  });

  it('con seed e bridge: get/put/remove persisten el blob completo cifrado', async () => {
    (window as unknown as { supabaseSessionSeed?: unknown }).supabaseSessionSeed = { 'sb-seed': 'seeded' };
    const puts: Blob[] = [];
    installBridge(puts);
    const storage = createSecureSupabaseStorage();
    expect(storage).not.toBeNull();
    expect(storage!.getItem('sb-seed')).toBe('seeded');
    expect(storage!.getItem('ausente')).toBeNull();

    storage!.setItem('sb-seed', 'rota-do');
    storage!.setItem('nuevo', 'valor');
    expect(puts.at(-1)).toEqual({ 'sb-seed': 'rota-do', nuevo: 'valor' });

    storage!.removeItem('nuevo');
    expect(puts.at(-1)).toEqual({ 'sb-seed': 'rota-do' });
    expect(storage!.getItem('nuevo')).toBeNull();
  });
});
