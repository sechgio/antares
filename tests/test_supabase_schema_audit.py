"""Static audit of the cumulative Supabase schema defined by migrations.

Replays ``supabase/migrations/*.sql`` in order at the statement level and
asserts on the *final* effective state (grants, RLS, policies, triggers),
not on file contents. This is the regression guard for findings from the
Supabase audit: it fails if a future migration forgets to revoke PUBLIC
EXECUTE on a new function, drops a guard trigger, adds a tautological
policy, or widens the client-callable RPC surface.

It does not replace replaying against a real Postgres (``supabase db
reset``); it verifies the declared intent of the migration files.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"
CONFIG_TOML = REPO_ROOT / "supabase" / "config.toml"

# RPCs invoked by the renderer (supabase.rpc / functions.invoke handlers) or by
# Edge Functions via the caller's JWT. Anything beyond this set exposed to
# `authenticated` is surface area that needs an explicit reason to exist.
EXPECTED_PUBLIC_AUTHENTICATED_RPCS = {
    "is_active_user",
    "is_admin",
    "admin_list_users",
    "admin_set_admin",
    "admin_toggle_disabled",
    "admin_delete_user",
    "canvas_append_document_version",
    "canvas_push_document_lww",
    "canvas_push_document_lww_v2",
    "canvas_delete_document_lww_v2",
    "seed_default_board_columns",
    "team_list_members",
}

EXPECTED_PRIVATE_AUTHENTICATED_FNS = {
    "is_active_user",
    "is_admin",
    "admin_list_users",
    "admin_set_admin",
    "admin_toggle_disabled",
    "admin_delete_user",
    "canvas_append_document_version",
    "canvas_push_document_lww",
    "canvas_push_document_lww_v2",
    "canvas_delete_document_lww_v2",
    "seed_default_board_columns",
    "team_list_members",
}

EXPECTED_SERVICE_ROLE_ONLY_RPCS = {
    "canvas_reconcile_storage_usage",
    "canvas_maintenance",
    "canvas_validate_legacy_storage_batch",
}

EXPECTED_PUBLICATION_TABLES = {
    "espacios",
    "proyectos",
    "tareas",
    "board_columns",
    "user_profiles",
}

EXPECTED_CANVAS_DOCUMENT_TRIGGERS = {
    "canvas_documents_lww_trigger",
    "canvas_documents_snapshot_trigger",
    "canvas_documents_preserve_created_by",
    "canvas_documents_content_hash_trigger",
    "canvas_documents_storage_guard_trigger",
}


def _split_statements(sql: str) -> list[str]:
    """Split on top-level semicolons, respecting $$ dollar-quoted bodies and
    -- line comments."""
    statements: list[str] = []
    buf: list[str] = []
    in_dollar = False
    in_comment = False
    i = 0
    while i < len(sql):
        if in_comment:
            if sql[i] == "\n":
                in_comment = False
            i += 1
            continue
        if not in_dollar and sql.startswith("--", i):
            in_comment = True
            i += 2
            continue
        if sql.startswith("$$", i):
            in_dollar = not in_dollar
            buf.append("$$")
            i += 2
            continue
        if sql[i] == ";" and not in_dollar:
            statements.append("".join(buf))
            buf = []
        else:
            buf.append(sql[i])
        i += 1
    tail = "".join(buf).strip()
    if tail:
        statements.append(tail)
    return statements


def _normalize_signature(args: str) -> tuple[str, ...]:
    """Reduce an argument list to its type list so that
    ``(p_user_id uuid, p_is_admin boolean)`` and ``(uuid, boolean)`` key alike."""
    types: list[str] = []
    for raw in args.split(","):
        part = raw.strip()
        if not part:
            continue
        part = re.sub(r"\s+DEFAULT\s+.*$", "", part, flags=re.IGNORECASE | re.DOTALL).strip()
        part = re.sub(r"^(?:INOUT|IN|OUT|VARIADIC)\s+", "", part, flags=re.IGNORECASE).strip()
        types.append(part.split()[-1].lower())
    return tuple(types)


def _split_roles(role_list: str) -> set[str]:
    return {r.strip().lower() for r in role_list.split(",") if r.strip()}


def _split_objects(obj_list: str) -> list[str]:
    out = []
    for raw in obj_list.split(","):
        item = raw.strip()
        if item:
            out.append(item.lower())
    return out


@dataclass
class Policy:
    base: str = ""
    expr: str = ""


@dataclass
class SchemaState:
    tables: set[str] = field(default_factory=set)
    dropped_tables: set[str] = field(default_factory=set)
    rls_enabled: set[str] = field(default_factory=set)
    # table -> role -> set of privileges ('select','insert','update','delete','all')
    table_grants: dict[str, dict[str, set[str]]] = field(default_factory=dict)
    # (schema, name, sig) -> definition text
    functions: dict[tuple[str, str, tuple[str, ...]], str] = field(default_factory=dict)
    # (schema, name, sig) -> roles with EXECUTE
    func_execute: dict[tuple[str, str, tuple[str, ...]], set[str]] = field(default_factory=dict)
    # (table, policy_name) -> Policy
    policies: dict[tuple[str, str], Policy] = field(default_factory=dict)
    # (table, trigger_name)
    triggers: set[tuple[str, str]] = field(default_factory=set)
    # schema -> roles with USAGE
    schema_usage: dict[str, set[str]] = field(default_factory=dict)
    publication: set[str] = field(default_factory=set)
    statements: list[str] = field(default_factory=list)

    def function_names(self, schema: str, role: str) -> set[str]:
        return {
            name
            for (sch, name, _sig), roles in self.func_execute.items()
            if sch == schema and role in roles
        }


def _apply_statement(state: SchemaState, stmt: str) -> None:
    s = stmt.strip()
    if not s:
        return
    low = s.lower()

    # Realtime publication membership also lives inside DO $$ ... $$ blocks;
    # scan the raw text (idempotent guards in the SQL make order safe).
    for m in re.finditer(
        r"alter\s+publication\s+supabase_realtime\s+(add|drop)\s+table\s+(?:public\.)?(\w+)",
        low,
    ):
        if m.group(1) == "add":
            state.publication.add(m.group(2))
        else:
            state.publication.discard(m.group(2))

    m = re.match(r"create\s+schema\s+(?:if\s+not\s+exists\s+)?(\w+)", low)
    if m:
        schema = m.group(1)
        # New schemas default to USAGE granted to PUBLIC.
        state.schema_usage.setdefault(schema, {"public"})
        return

    m = re.match(r"create\s+table\s+(?:if\s+not\s+exists\s+)?(\w+\.\w+)", low)
    if m:
        table = m.group(1)
        state.tables.add(table)
        state.dropped_tables.discard(table)
        state.table_grants.setdefault(table, {})
        return

    m = re.match(r"drop\s+table\s+(?:if\s+exists\s+)?(.+?)(?:\s+cascade)?$", low, re.DOTALL)
    if m:
        for table in _split_objects(m.group(1)):
            state.tables.discard(table)
            state.dropped_tables.add(table)
            state.table_grants.pop(table, None)
            state.rls_enabled.discard(table)
            for key in [k for k in state.policies if k[0] == table]:
                del state.policies[key]
            state.triggers = {t for t in state.triggers if t[0] != table}
        return

    m = re.match(r"alter\s+table\s+(\w+\.\w+)\s+(enable|disable)\s+row\s+level\s+security", low)
    if m:
        if m.group(2) == "enable":
            state.rls_enabled.add(m.group(1))
        else:
            state.rls_enabled.discard(m.group(1))
        return

    m = re.match(r"create\s+(?:or\s+replace\s+)?function\s+(\w+)\.(\w+)\s*\(([^)]*)\)", low)
    if m:
        key = (m.group(1), m.group(2), _normalize_signature(m.group(3)))
        is_replace = bool(re.match(r"create\s+or\s+replace", low))
        if key not in state.functions or not is_replace:
            # Fresh function: Postgres grants EXECUTE to PUBLIC by default.
            state.func_execute[key] = {"public"}
        state.functions[key] = s
        return

    m = re.match(r"drop\s+function\s+(?:if\s+exists\s+)?(\w+)\.(\w+)\s*\(([^)]*)\)", low)
    if m:
        key = (m.group(1), m.group(2), _normalize_signature(m.group(3)))
        state.functions.pop(key, None)
        state.func_execute.pop(key, None)
        return

    m = re.match(
        r"grant\s+(.+?)\s+on\s+function\s+(\w+)\.(\w+)\s*\(([^)]*)\)\s+to\s+(.+)",
        low,
        re.DOTALL,
    )
    if m:
        privs, schema, name, args, roles = m.groups()
        key = (schema, name, _normalize_signature(args))
        if re.search(r"\b(execute|all)\b", privs):
            state.func_execute.setdefault(key, set()).update(_split_roles(roles))
        return

    m = re.match(
        r"revoke\s+(.+?)\s+on\s+function\s+(\w+)\.(\w+)\s*\(([^)]*)\)\s+from\s+(.+)",
        low,
        re.DOTALL,
    )
    if m:
        privs, schema, name, args, roles = m.groups()
        key = (schema, name, _normalize_signature(args))
        if re.search(r"\b(execute|all)\b", privs):
            state.func_execute.setdefault(key, set()).difference_update(_split_roles(roles))
        return

    m = re.match(r"grant\s+(.+?)\s+on\s+schema\s+(\w+)\s+to\s+(.+)", low, re.DOTALL)
    if m:
        privs, schema, roles = m.groups()
        if re.search(r"\b(usage|all)\b", privs):
            state.schema_usage.setdefault(schema, set()).update(_split_roles(roles))
        return

    m = re.match(r"revoke\s+(.+?)\s+on\s+schema\s+(\w+)\s+from\s+(.+)", low, re.DOTALL)
    if m:
        privs, schema, roles = m.groups()
        if re.search(r"\b(usage|all)\b", privs):
            state.schema_usage.setdefault(schema, set()).difference_update(_split_roles(roles))
        return

    m = re.match(r"grant\s+(.+?)\s+on\s+(?:table\s+)?(.+?)\s+to\s+(.+)", low, re.DOTALL)
    if m and "on function" not in low and "on schema" not in low:
        privs, obj_list, roles = m.groups()
        priv_set = {"all"} if re.search(r"\ball\b", privs) else set(_split_objects(privs))
        for table in _split_objects(obj_list):
            grants = state.table_grants.setdefault(table, {})
            for role in _split_roles(roles):
                grants.setdefault(role, set()).update(priv_set)
        return

    m = re.match(r"revoke\s+(.+?)\s+on\s+(?:table\s+)?(.+?)\s+from\s+(.+)", low, re.DOTALL)
    if m and "on function" not in low and "on schema" not in low:
        privs, obj_list, roles = m.groups()
        all_privs = bool(re.search(r"\ball\b", privs))
        priv_set = set() if all_privs else set(_split_objects(privs))
        for table in _split_objects(obj_list):
            grants = state.table_grants.setdefault(table, {})
            for role in _split_roles(roles):
                if all_privs:
                    grants[role] = set()
                else:
                    grants.setdefault(role, set()).difference_update(priv_set)
        return

    m = re.match(
        r"create\s+policy\s+\"([^\"]+)\"\s+on\s+(\w+\.\w+)",
        low,
    )
    if m:
        expr_at = re.search(r"\b(?:using|with\s+check)\s*\(", low)
        state.policies[(m.group(2), m.group(1))] = Policy(
            base=low,
            expr=low[expr_at.start() :] if expr_at else "",
        )
        return

    m = re.match(r"alter\s+policy\s+\"([^\"]+)\"\s+on\s+(\w+\.\w+)", low)
    if m:
        key = (m.group(2), m.group(1))
        existing = state.policies.get(key, Policy())
        expr_at = re.search(r"\b(?:using|with\s+check)\s*\(", low)
        state.policies[key] = Policy(
            base=existing.base or low,
            expr=low[expr_at.start() :] if expr_at else existing.expr,
        )
        return

    m = re.match(r"drop\s+policy\s+(?:if\s+exists\s+)?\"([^\"]+)\"\s+on\s+(\w+\.\w+)", low)
    if m:
        state.policies.pop((m.group(2), m.group(1)), None)
        return

    m = re.match(r"create\s+trigger\s+(\w+).+?\bon\s+(\w+\.\w+)", low, re.DOTALL)
    if m:
        state.triggers.add((m.group(2), m.group(1)))
        return

    m = re.match(r"drop\s+trigger\s+(?:if\s+exists\s+)?(\w+)\s+on\s+(\w+\.\w+)", low)
    if m:
        state.triggers.discard((m.group(2), m.group(1)))
        return


def build_state() -> SchemaState:
    state = SchemaState()
    files = sorted(MIGRATIONS_DIR.glob("*.sql"), key=lambda p: p.name)
    assert files, "no migration files found"
    for path in files:
        for stmt in _split_statements(path.read_text(encoding="utf-8")):
            state.statements.append(stmt)
            _apply_statement(state, stmt)
    return state


STATE = build_state()


def test_every_public_table_has_rls_enabled() -> None:
    public_tables = {t for t in STATE.tables if t.startswith("public.")}
    missing = public_tables - STATE.rls_enabled
    assert not missing, f"tablas public.* sin RLS: {sorted(missing)}"


def test_no_execute_for_public_or_anon_on_any_function() -> None:
    offenders = {
        f"{sch}.{name}({','.join(sig)})"
        for (sch, name, sig), roles in STATE.func_execute.items()
        if roles & {"public", "anon"}
    }
    assert not offenders, f"funciones ejecutables por PUBLIC/anon: {sorted(offenders)}"


def test_no_table_privileges_for_public_or_anon() -> None:
    offenders = {
        f"{table}:{role}"
        for table, grants in STATE.table_grants.items()
        for role, privs in grants.items()
        if role in {"public", "anon"} and privs
    }
    assert not offenders, f"privilegios de tabla para PUBLIC/anon: {sorted(offenders)}"


def test_authenticated_rpc_surface_is_exact() -> None:
    assert STATE.function_names("public", "authenticated") == EXPECTED_PUBLIC_AUTHENTICATED_RPCS
    assert STATE.function_names("private", "authenticated") == EXPECTED_PRIVATE_AUTHENTICATED_FNS


def test_service_role_surface_is_exact() -> None:
    expected = EXPECTED_PUBLIC_AUTHENTICATED_RPCS | EXPECTED_SERVICE_ROLE_ONLY_RPCS
    assert STATE.function_names("public", "service_role") == expected


def test_service_role_only_functions_gate_on_jwt_role() -> None:
    for (schema, name, _sig), text in STATE.functions.items():
        if schema != "public" or name not in EXPECTED_SERVICE_ROLE_ONLY_RPCS:
            continue
        assert "request.jwt.claim.role" in text, (
            f"{name} debe verificar el claim service_role además del GRANT"
        )


def test_every_security_definer_function_sets_search_path() -> None:
    offenders = {
        f"{sch}.{name}({','.join(sig)})"
        for (sch, name, sig), text in STATE.functions.items()
        if "security definer" in text.lower() and "set search_path" not in text.lower()
    }
    assert not offenders, f"SECURITY DEFINER sin SET search_path: {sorted(offenders)}"


def test_client_rpc_names_exist_as_public_functions() -> None:
    public_names = {name for (sch, name, _sig) in STATE.functions if sch == "public"}
    missing = EXPECTED_PUBLIC_AUTHENTICATED_RPCS - public_names
    assert not missing, f"RPCs que el cliente invoca pero no existen: {sorted(missing)}"


def test_no_tautological_policies() -> None:
    offenders = {
        f"{table}:{name}"
        for (table, name), pol in STATE.policies.items()
        if re.search(r"using\s*\(\s*true\s*\)", pol.expr)
        or re.search(r"with\s+check\s*\(\s*true\s*\)", pol.expr)
    }
    assert not offenders, f"políticas USING/CHECK (true): {sorted(offenders)}"


def test_policies_do_not_depend_on_public_auth_helpers() -> None:
    offenders = {
        f"{table}:{name}"
        for (table, name), pol in STATE.policies.items()
        if "public.is_active_user()" in pol.expr or "public.is_admin()" in pol.expr
    }
    assert not offenders, (
        f"políticas que dependen de helpers públicos en vez de private.*: {sorted(offenders)}"
    )


def test_user_profiles_has_no_insert_or_delete_policy() -> None:
    offenders = set()
    for (table, name), pol in STATE.policies.items():
        if table != "public.user_profiles":
            continue
        if re.search(r"for\s+(insert|delete|all)\b", pol.base):
            offenders.add(name)
    assert not offenders, f"políticas de escritura indebidas en user_profiles: {sorted(offenders)}"


def test_canvas_documents_has_no_client_delete() -> None:
    for (table, name), pol in STATE.policies.items():
        if table != "public.canvas_documents":
            continue
        assert not re.search(r"for\s+(delete|all)\b", pol.base), (
            f"política {name} permite DELETE en canvas_documents"
        )
    grants = STATE.table_grants.get("public.canvas_documents", {})
    assert "delete" not in grants.get("authenticated", set()) and "all" not in grants.get(
        "authenticated", set()
    ), "authenticated no debe tener DELETE en canvas_documents"


def test_canvas_document_versions_not_writable_by_clients() -> None:
    grants = STATE.table_grants.get("public.canvas_document_versions", {})
    client_privs = grants.get("authenticated", set())
    assert not (client_privs & {"insert", "update", "delete", "all"}), (
        "authenticated solo puede SELECT en canvas_document_versions"
    )


def test_realtime_policies_stay_scoped_to_canvas_topics() -> None:
    rt = [(name, pol.expr) for (table, name), pol in STATE.policies.items() if table == "realtime.messages"]
    assert rt, "faltan políticas de autorización en realtime.messages"
    for name, text in rt:
        assert "canvas-document:%" in text, f"{name} no limita el topic canvas-document:*"
        assert "'broadcast'" in text and "'presence'" in text, f"{name} no limita extension"


def test_realtime_publication_membership_is_exact() -> None:
    assert STATE.publication == EXPECTED_PUBLICATION_TABLES


def test_canvas_guard_triggers_exist() -> None:
    doc_triggers = {name for (table, name) in STATE.triggers if table == "public.canvas_documents"}
    missing = EXPECTED_CANVAS_DOCUMENT_TRIGGERS - doc_triggers
    assert not missing, f"triggers de guarda ausentes en canvas_documents: {sorted(missing)}"


def test_user_profiles_privilege_guard_trigger_exists() -> None:
    assert ("public.user_profiles", "user_profiles_guard_privilege_columns") in STATE.triggers


def test_board_columns_system_delete_guard_exists() -> None:
    assert ("public.board_columns", "board_columns_prevent_system_delete") in STATE.triggers


def test_private_schema_usage_is_not_public() -> None:
    usage = STATE.schema_usage.get("private", set())
    assert "public" not in usage and "anon" not in usage, (
        "el schema private no debe ser usable por PUBLIC/anon"
    )


def test_config_toml_exposes_only_public_schema() -> None:
    config = CONFIG_TOML.read_text(encoding="utf-8")
    m = re.search(r"(?m)^\s*schemas\s*=\s*\[(.*?)\]", config)
    assert m, "config.toml debe fijar [api].schemas"
    exposed = {s.strip().strip('"').strip("'") for s in m.group(1).split(",") if s.strip()}
    assert exposed == {"public"}, f"schemas expuestos por PostgREST: {sorted(exposed)}"
