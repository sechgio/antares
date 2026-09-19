import { createClient, type SupabaseClient, type User } from "jsr:@supabase/supabase-js@2.112.4";

export function jsonError(
  message: string,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export type AdminAuthResult =
  | { ok: true; userClient: SupabaseClient; callerUser: User }
  | { ok: false; response: Response };

/**
 * Gate compartido de las funciones admin-*: exige Bearer token válido y un
 * perfil `is_admin` no deshabilitado. Devuelve el cliente autenticado del
 * llamador o la Response de rechazo ya construida.
 */
export async function requireAdmin(
  req: Request,
  cors: Record<string, string>,
  forbiddenError: string,
): Promise<AdminAuthResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return {
      ok: false,
      response: jsonError("This endpoint requires a valid Bearer token", 401, cors),
    };
  }

  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user: callerUser } } = await userClient.auth.getUser();
  if (!callerUser) {
    return {
      ok: false,
      response: jsonError("This endpoint requires a valid Bearer token", 401, cors),
    };
  }

  const { data: profile } = await userClient
    .from("user_profiles")
    .select("is_admin, is_disabled")
    .eq("user_id", callerUser.id)
    .single();

  if (!profile?.is_admin || profile.is_disabled) {
    return { ok: false, response: jsonError(forbiddenError, 403, cors) };
  }

  return { ok: true, userClient, callerUser };
}
