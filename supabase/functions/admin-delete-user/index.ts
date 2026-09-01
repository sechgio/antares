import { createClient } from "jsr:@supabase/supabase-js@2.112.4";
import { corsHeaders } from "../_shared/cors.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

    const { error: deleteError } = await userClient.rpc("admin_delete_user", {
      p_user_id: targetUserId,
    });

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
