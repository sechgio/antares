import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "https://yoyxclndjevkzzclhdcv.supabase.co",
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  const allow =
    !origin ||
    origin === "null" ||
    ALLOWED_ORIGINS.includes(origin) ||
    origin.includes("localhost:5173");

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (allow && origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  } else if (allow) {
    headers["Access-Control-Allow-Origin"] = "*";
  }
  return headers;
}

interface DeleteUserBody {
  user_id?: string;
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: cors });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const body: DeleteUserBody = await req.json();
    const targetUserId = body.user_id?.trim();

    if (!targetUserId) {
      return new Response(
        JSON.stringify({ error: "user_id es obligatorio" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    if (!UUID_RE.test(targetUserId)) {
      return new Response(
        JSON.stringify({ error: "user_id debe ser un UUID válido" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "This endpoint requires a valid Bearer token" }),
        { status: 401, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: callerUser } } = await userClient.auth.getUser();
    if (!callerUser) {
      return new Response(
        JSON.stringify({ error: "This endpoint requires a valid Bearer token" }),
        { status: 401, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const { data: profile } = await userClient
      .from("user_profiles")
      .select("is_admin, is_disabled")
      .eq("user_id", callerUser.id)
      .single();

    if (!profile?.is_admin || profile.is_disabled) {
      return new Response(
        JSON.stringify({ error: "Solo los administradores pueden eliminar usuarios" }),
        { status: 403, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    if (targetUserId === callerUser.id) {
      return new Response(
        JSON.stringify({ error: "No puedes eliminar tu propia cuenta" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: targetProfile } = await adminClient
      .from("user_profiles")
      .select("is_admin, is_disabled")
      .eq("user_id", targetUserId)
      .single();

    if (targetProfile?.is_admin && !targetProfile.is_disabled) {
      const { count, error: countError } = await adminClient
        .from("user_profiles")
        .select("user_id", { count: "exact", head: true })
        .eq("is_admin", true)
        .eq("is_disabled", false);

      if (countError) {
        return new Response(
          JSON.stringify({ error: countError.message }),
          { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }

      if ((count ?? 0) <= 1) {
        return new Response(
          JSON.stringify({ error: "No se puede eliminar al último administrador activo" }),
          { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
    }

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetUserId);

    if (deleteError) {
      return new Response(
        JSON.stringify({ error: deleteError.message }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
