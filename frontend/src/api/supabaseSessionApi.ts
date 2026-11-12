type IpcInvoke = <T>(method: string, params?: Record<string, unknown> | object) => Promise<T>;

export function createSupabaseSessionApi(invoke: IpcInvoke) {
  return {
    supabaseSessionGet: () => invoke<{ blob: Record<string, string> | null }>('supabase_session_get'),
    supabaseSessionPut: (blob: Record<string, string>) =>
      invoke<{ success: boolean }>('supabase_session_put', { blob }),
    supabaseSessionClear: () => invoke<{ success: boolean }>('supabase_session_clear'),
  };
}
