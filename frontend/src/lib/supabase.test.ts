import { beforeEach, describe, expect, it } from 'vitest';

describe('createSecureSupabaseStorage (sb-011)', () => {
  beforeEach(() => {
    (window as unknown as { supabaseSessionSeed?: unknown }).supabaseSessionSeed = undefined;
    (window as unknown as { electronAPI?: unknown }).electronAPI = undefined;
  });

  it('devuelve null sin seed o sin bridge: cae al localStorage clasico', async () => {
    const { createSecureSupabaseStorage } = await import('./supabase');
    expect(createSecureSupabaseStorage()).toBeNull();
    (window as unknown as { supabaseSessionSeed?: unknown }).supabaseSessionSeed = {};
    expect(createSecureSupabaseStorage()).toBeNull();
  });

  it('con seed e bridge: get/put/remove persisten el blob completo cifrado', async () => {
    (window as unknown as { supabaseSessionSeed?: unknown }).supabaseSessionSeed = { 'sb-seed': 'seeded' };
    const puts: Array<Record<string, string>> = [];
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      invoke: (method: string, params?: { blob?: Record<string, string> }) => {
        if (method === 'supabase_session_put' && params?.blob) puts.push({ ...params.blob });
        return Promise.resolve({ success: true });
      },
    };
    const { createSecureSupabaseStorage } = await import('./supabase');
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
