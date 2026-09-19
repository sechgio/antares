import { createClient } from "jsr:@supabase/supabase-js@2.112.4";
import { corsHeaders } from "../_shared/cors.ts";
import { jsonError, requireAdmin } from "../_shared/admin-auth.ts";

interface CreateUserBody {
  email?: string;
  password?: string;
  email_confirm?: boolean;
  role?: "user" | "admin";
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: cors });
  }

  if (req.method !== "POST") {
    return jsonError("Method not allowed", 405, cors);
  }

  try {
    const body: CreateUserBody = await req.json();
    const email = body.email?.trim().toLowerCase();
    const password = body.password;

    if (!email || !password) {
      return jsonError("Email y password son obligatorios", 400, cors);
    }

    if (password.length < 8) {
      return jsonError("La contraseña debe tener al menos 8 caracteres", 400, cors);
    }

    const auth = await requireAdmin(req, cors, "Solo los administradores pueden crear usuarios");
    if (!auth.ok) return auth.response;
    const { userClient } = auth;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const adminClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: body.email_confirm ?? true,
    });

    if (createError) {
      return jsonError(createError.message, 400, cors);
    }

    if (body.role === "admin" && userData.user?.id) {
      const { error: adminError } = await userClient.rpc("admin_set_admin", {
        p_user_id: userData.user.id,
        p_is_admin: true,
      });
      if (adminError) {
        const { error: cleanupError } = await adminClient.auth.admin.deleteUser(userData.user.id);
        return new Response(
          JSON.stringify({
            error: adminError.message,
            ...(cleanupError ? { cleanup_error: cleanupError.message } : {}),
          }),
          {
            status: cleanupError ? 500 : 400,
            headers: { ...cors, "Content-Type": "application/json" },
          },
        );
      }
    }

    return new Response(
      JSON.stringify({ user: userData.user }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
