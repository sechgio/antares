"""Disciplina CORS de las Edge Functions (supabase-data-006).

El endurecimiento ya vive en `supabase/functions/_shared/cors.ts`: allowlist
de orígenes (localhost de dev, SUPABASE_URL y extras por entorno) sin
comodines, con el origen "null" reservado al renderer file:// de Electron;
los admin además pasan por `requireAdmin` (auth.getUser + RLS) antes de
cualquier efecto. Estos tests fijan ese modelo y evitan regresar a un
comodín o a CORS ad-hoc por función.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FUNCTIONS_DIR = REPO_ROOT / "supabase" / "functions"

ADMIN_ENDPOINTS = ("admin-create-user", "admin-delete-user")


def _cors_source() -> str:
    return (FUNCTIONS_DIR / "_shared" / "cors.ts").read_text(encoding="utf-8")


def test_shared_cors_never_answers_with_a_wildcard_origin() -> None:
    source = _cors_source()
    assert "*" not in source.split("Access-Control-Allow-Methods")[0], "sin comodines antes del allowlist"
    assert '"Access-Control-Allow-Origin": "*"' not in source, "el comodín Allow-Origin ya no existe"
    assert "isElectronNull" in source, "el origen null queda reservado al renderer file:// de Electron"
    assert "SUPABASE_ALLOWED_ORIGINS" in source, "la extensión de orígenes sigue viniendo del entorno"
    assert "http://localhost:5173" in source, "el origen de dev sigue en la allowlist"


def test_every_function_with_cors_uses_the_shared_allowlist() -> None:
    for fn_dir in FUNCTIONS_DIR.iterdir():
        if not fn_dir.is_dir() or fn_dir.name.startswith("_"):
            continue
        index = fn_dir / "index.ts"
        if not index.exists():
            continue
        source = index.read_text(encoding="utf-8")
        ad_hoc = [line for line in source.splitlines() if "Access-Control-Allow-Origin" in line]
        assert not ad_hoc, f"{index} escribe Allow-Origin ad-hoc: {ad_hoc}"
        if "corsHeaders" in source:
            assert "_shared/cors" in source, f"{index} usa CORS sin el helper compartido"


def test_admin_endpoints_gate_on_the_shared_admin_check() -> None:
    for name in ADMIN_ENDPOINTS:
        source = (FUNCTIONS_DIR / name / "index.ts").read_text(encoding="utf-8")
        assert "requireAdmin" in source, f"{name} debe pasar por requireAdmin"
        cors_pos = source.find("corsHeaders(req)")
        admin_pos = source.find("requireAdmin(")
        assert cors_pos >= 0, f"{name}: calcula los headers CORS para OPTIONS"
        assert cors_pos < admin_pos, f"{name}: requireAdmin gatea cualquier efecto"
