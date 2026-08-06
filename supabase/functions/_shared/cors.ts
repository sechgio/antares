export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  const envUrl = Deno.env.get("SUPABASE_URL") || "";
  const extra = (Deno.env.get("SUPABASE_ALLOWED_ORIGINS") || "").split(",").map(s=>s.trim()).filter(Boolean);
  const allowed = new Set(["http://localhost:5173", ...(envUrl ? [envUrl] : []), ...extra]);
  const isElectronNull = origin === "null";
  const allow = !origin ? false : isElectronNull || allowed.has(origin);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
  if (allow && origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
