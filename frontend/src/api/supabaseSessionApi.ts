type IpcInvoke = <T>(method: string, params?: Record<string, unknown> | object) => Promise<T>;

// sb-011: el blob completo de sesión de Supabase vive cifrado en el proceso
// principal (safeStorage); en el renderer solo existe en memoria.
export function createSupabaseSessionApi(invoke: IpcInvoke) {
  return {
    supabaseSessionGet: () => invoke<{ blob: Record<string, string> | null }>('supabase_session_get'),
    supabaseSessionPut: (blob: Record<string, string>) =>
      invoke<{ success: boolean }>('supabase_session_put', { blob }),
    supabaseSessionClear: () => invoke<{ success: boolean }>('supabase_session_clear'),
  };
}
