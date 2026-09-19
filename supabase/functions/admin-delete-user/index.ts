import { corsHeaders } from "../_shared/cors.ts";
import { jsonError, requireAdmin } from "../_shared/admin-auth.ts";

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
    return jsonError("Method not allowed", 405, cors);
  }

  try {
    const body: DeleteUserBody = await req.json();
    const targetUserId = body.user_id?.trim();

    if (!targetUserId) {
      return jsonError("user_id es obligatorio", 400, cors);
    }

    if (!UUID_RE.test(targetUserId)) {
      return jsonError("user_id debe ser un UUID válido", 400, cors);
    }

    const auth = await requireAdmin(req, cors, "Solo los administradores pueden eliminar usuarios");
    if (!auth.ok) return auth.response;
    const { userClient, callerUser } = auth;

    if (targetUserId === callerUser.id) {
      return jsonError("No puedes eliminar tu propia cuenta", 400, cors);
    }

    const { error: deleteError } = await userClient.rpc("admin_delete_user", {
      p_user_id: targetUserId,
    });

    if (deleteError) {
      return jsonError(deleteError.message, 400, cors);
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
