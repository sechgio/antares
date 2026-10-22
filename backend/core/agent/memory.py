from __future__ import annotations

import json
import re
import threading
import time
import unicodedata
import uuid
from pathlib import Path
from typing import TYPE_CHECKING

from backend.core.integrations.types import JsonObject
from backend.utils.atomic_write import atomic_write_json

if TYPE_CHECKING:
    from backend.core.agent.agent import AgentStore

KINDS = ("preference", "fact", "procedure")
LABELS = {"preference": "Preferencia", "fact": "Hecho", "procedure": "Procedimiento"}
MAX_ITEMS = 300
MAX_TITLE = 120
MAX_TEXT = 2000
MAX_STEPS = 20
MAX_VERSIONS = 20
CONTEXT_CHARS = 4000
CONTEXT_ITEMS = 8
FAILURE_LIMIT = 2
VERIFIED = frozenset({"succeeded", "submitted"})
_SELF = frozenset({"memory_search", "memory_remember", "procedure_learn"})
_ACCOUNT_PROVIDERS = (("gdrive_", "google"), ("gsheets_", "google"), ("onedrive_", "microsoft"),
                      ("excel_", "microsoft"), ("autoimg_", "autoimg"))
_SECRET_RE = re.compile(
    r"(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}"
    r"|ya29\.[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY"
    r"|bearer\s+[A-Za-z0-9._~+/-]{16,}"
    r"|(?:password|contraseña|clave|api[_ -]?key|token|secret|client[_ ]secret)\s*[:=]\s*\S+)",
    re.IGNORECASE,
)

_TEXT = {"type": "string", "maxLength": MAX_TEXT}
TOOL_SPECS: list[JsonObject] = [
    {
        "name": "memory_search", "module": "agent", "gated": False,
        "description": "Memoria · memory_search (solo lectura): buscar preferencias, hechos y procedimientos guardados",
        "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
    },
    {
        "name": "memory_remember", "module": "agent", "gated": False,
        "description": (
            "Memoria · memory_remember: guardar una preferencia o un hecho duradero que el usuario indicó. "
            "Nunca guardes contraseñas, claves ni tokens"
        ),
        "inputSchema": {"type": "object", "properties": {
            "kind": {"type": "string", "enum": ["preference", "fact"]},
            "title": {"type": "string", "maxLength": MAX_TITLE}, "content": _TEXT,
        }, "required": ["kind", "title", "content"]},
    },
    {
        "name": "procedure_learn", "module": "agent", "gated": False,
        "description": (
            "Memoria · procedure_learn: guardar los pasos de un encargo repetible que ya terminó con comprobante "
            "en esta conversación; solo acepta herramientas con resultado verificado"
        ),
        "inputSchema": {"type": "object", "properties": {
            "title": {"type": "string", "maxLength": MAX_TITLE},
            "when": {**_TEXT, "description": "Cuándo aplica el procedimiento"},
            "steps": {"type": "array", "minItems": 1, "maxItems": MAX_STEPS, "items": {"type": "object", "properties": {
                "tool": {"type": "string"}, "purpose": {"type": "string", "maxLength": 300},
            }, "required": ["tool", "purpose"]}},
            "templates": {"type": "array", "items": {"type": "string"}, "maxItems": 10,
                          "description": "IDs de plantilla que usa el procedimiento"},
        }, "required": ["title", "when", "steps"]},
    },
]


def _now() -> int:
    return int(time.time() * 1000)


def _key(text: str) -> str:
    folded = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().casefold()
    return " ".join(re.findall(r"[a-z0-9]+", folded))


def _words(text: str) -> set[str]:
    return {word for word in _key(text).split() if len(word) >= 3}


def _clean(value: object, label: str, limit: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Indica {label}")
    text = value.strip()
    if len(text) > limit:
        raise ValueError(f"{label.capitalize()} excede {limit} caracteres")
    if _SECRET_RE.search(text):
        raise ValueError("La memoria no guarda contraseñas, claves ni tokens")
    return text


def _provider(tool: str) -> str | None:
    return next((provider for prefix, provider in _ACCOUNT_PROVIDERS if tool.startswith(prefix)), None)


def _steps(value: object) -> list[JsonObject]:
    if not isinstance(value, list) or not 1 <= len(value) <= MAX_STEPS:
        raise ValueError(f"Un procedimiento tiene entre 1 y {MAX_STEPS} pasos")
    steps: list[JsonObject] = []
    for step in value:
        if not isinstance(step, dict) or not isinstance(step.get("tool"), str):
            raise ValueError("Cada paso indica su herramienta")
        tool = step["tool"]
        if tool in _SELF:
            raise ValueError(f"Herramienta no disponible en el procedimiento: {tool}")
        steps.append({"tool": tool, "purpose": _clean(step.get("purpose"), "el propósito del paso", 300)})
    return steps


class MemoryStore:
    def __init__(self, base_dir: Path) -> None:
        self._path = base_dir / "memory.json"
        self._lock = threading.RLock()
        data: JsonObject = {}
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        self._items: dict[str, JsonObject] = dict(data.get("items") or {})
        self._applied: dict[str, list[str]] = dict(data.get("applied") or {})
        self._tool_versions: dict[str, str] = dict(data.get("tool_versions") or {})

    def _write(self) -> None:
        atomic_write_json(self._path, {"items": self._items, "applied": self._applied,
                                       "tool_versions": self._tool_versions})

    @staticmethod
    def _view(item: JsonObject) -> JsonObject:
        current = next(v for v in item["versions"] if v["version"] == item["version"])
        return {**{k: v for k, v in item.items() if k != "versions"}, **{k: v for k, v in current.items() if k != "version"},
                "versions": [{"version": v["version"], "created_at": v["created_at"], "source": v["source"]}
                             for v in item["versions"]]}

    def _add_version(self, item: JsonObject, data: JsonObject, source: JsonObject) -> None:
        version = max((v["version"] for v in item["versions"]), default=0) + 1
        item["versions"] = [*item["versions"], {**data, "version": version, "source": source, "created_at": _now()}][-MAX_VERSIONS:]
        item["version"] = version
        item["updated_at"] = _now()

    def _create(self, kind: str, title: str, data: JsonObject, source: JsonObject) -> JsonObject:
        if len(self._items) >= MAX_ITEMS:
            raise ValueError(f"La memoria ya tiene {MAX_ITEMS} recuerdos; borra los que no necesites")
        item: JsonObject = {"id": uuid.uuid4().hex[:12], "kind": kind, "title": title, "key": _key(title),
                            "status": "active", "reason": None, "failures": 0, "uses": 0,
                            "created_at": _now(), "updated_at": _now(), "version": 0, "versions": []}
        self._add_version(item, data, source)
        self._items[str(item["id"])] = item
        return item

    def _same(self, kind: str, title: str) -> JsonObject | None:
        key = _key(title)
        return next((item for item in self._items.values() if item["kind"] == kind and item["key"] == key), None)

    def items(self) -> list[JsonObject]:
        with self._lock:
            return sorted((self._view(item) for item in self._items.values()), key=lambda i: -int(i["updated_at"]))

    def remember(self, session_id: str, params: JsonObject) -> JsonObject:
        kind = params.get("kind")
        if kind not in ("preference", "fact"):
            raise ValueError("kind debe ser preference o fact")
        title = _clean(params.get("title"), "un título", MAX_TITLE)
        content = _clean(params.get("content"), "el contenido", MAX_TEXT)
        source = {"kind": "agent", "session_id": session_id}
        with self._lock:
            existing = self._same(str(kind), title)
            if existing is not None and existing["versions"][-1]["source"]["kind"] == "user":
                raise ValueError("El usuario corrigió este recuerdo; propón el cambio en el chat en lugar de reemplazarlo")
            if existing is None:
                item = self._create(str(kind), title, {"content": content}, source)
            else:
                item = existing
                self._add_version(item, {"content": content}, source)
            self._write()
            return self._view(item)

    def learn(self, store: AgentStore, session_id: str, params: JsonObject) -> JsonObject:
        title = _clean(params.get("title"), "un título", MAX_TITLE)
        when = _clean(params.get("when"), "cuándo aplica", MAX_TEXT)
        steps = _steps(params.get("steps"))
        templates = params.get("templates") or []
        if not isinstance(templates, list) or any(not isinstance(t, str) for t in templates):
            raise ValueError("templates debe ser una lista de IDs")
        records = sorted(store.dispatches_for(session_id), key=lambda r: int(r.get("started_at") or 0))
        evidence: list[str] = []
        missing: list[str] = []
        accounts: dict[str, str] = {}
        for tool in dict.fromkeys(str(step["tool"]) for step in steps):
            runs = [r for r in records if r.get("method") == tool]
            if not runs or runs[-1].get("status") not in VERIFIED:
                missing.append(tool)
                continue
            evidence += [str(r["op_id"]) for r in runs if r.get("status") in VERIFIED][-3:]
            approval = store.get_approval(str(runs[-1].get("approval_id"))) if runs[-1].get("approval_id") else None
            account = ((approval or {}).get("context") or {}).get("account")
            provider = _provider(tool)
            if provider and isinstance(account, str) and account:
                accounts[provider] = account
        if missing:
            raise ValueError("Sin comprobante verificado en esta conversación de: " + ", ".join(missing)
                             + ". Un procedimiento solo se aprende de pasos ya completados")
        artifacts = [str(a["id"]) for a in store.artifacts_for(session_id)][-10:]
        with self._lock:
            data = {"when": when, "steps": steps, "templates": list(dict.fromkeys(templates)), "accounts": accounts,
                    "tool_versions": {s["tool"]: self._tool_versions.get(str(s["tool"])) for s in steps}}
            source = {"kind": "agent", "session_id": session_id, "op_ids": evidence, "artifact_ids": artifacts}
            existing = self._same("procedure", title)
            if existing is not None and existing["versions"][-1]["source"]["kind"] == "user":
                raise ValueError("El usuario corrigió este procedimiento; propón el cambio en el chat en lugar de reemplazarlo")
            if existing is None:
                item = self._create("procedure", title, data, source)
            else:
                item = existing
                self._add_version(item, data, source)
                item.update(status="active", reason=None, failures=0)
            self._write()
            return self._view(item)

    def update(self, item_id: str, params: JsonObject) -> JsonObject:
        action = params.get("action")
        with self._lock:
            item = self._items.get(item_id)
            if item is None:
                raise ValueError("El recuerdo ya no existe")
            current = next(v for v in item["versions"] if v["version"] == item["version"])
            data = {k: v for k, v in current.items() if k not in {"version", "source", "created_at"}}
            if action == "edit":
                if item["kind"] == "procedure":
                    if "when" in params:
                        data["when"] = _clean(params.get("when"), "cuándo aplica", MAX_TEXT)
                    if "steps" in params:
                        data["steps"] = _steps(params.get("steps"))
                else:
                    data["content"] = _clean(params.get("content"), "el contenido", MAX_TEXT)
                if "title" in params:
                    item["title"] = _clean(params.get("title"), "un título", MAX_TITLE)
                    item["key"] = _key(str(item["title"]))
                self._add_version(item, data, {"kind": "user"})
                item.update(status="active", reason=None, failures=0)
            elif action == "revert":
                target = next((v for v in item["versions"] if v["version"] == params.get("version")), None)
                if target is None:
                    raise ValueError("Esa versión ya no se conserva")
                restored = {k: v for k, v in target.items() if k not in {"version", "source", "created_at"}}
                self._add_version(item, restored, {"kind": "user", "reverted_to": target["version"]})
                item.update(status="active", reason=None, failures=0)
            elif action in ("disable", "enable"):
                item.update(status="disabled" if action == "disable" else "active", reason=None, failures=0)
                item["updated_at"] = _now()
            else:
                raise ValueError("Acción de memoria no válida")
            self._write()
            return self._view(item)

    def delete(self, item_id: str) -> bool:
        with self._lock:
            removed = self._items.pop(item_id, None) is not None
            self._applied = {sid: [i for i in ids if i != item_id] for sid, ids in self._applied.items()}
            self._applied = {sid: ids for sid, ids in self._applied.items() if ids}
            if removed:
                self._write()
            return removed

    def search(self, query: str, limit: int = 10) -> list[JsonObject]:
        words = _words(query)
        with self._lock:
            scored = []
            for item in self._items.values():
                if item["status"] != "active":
                    continue
                view = self._view(item)
                text = " ".join(str(view.get(k) or "") for k in ("title", "content", "when"))
                text += " " + " ".join(f"{s['tool']} {s['purpose']}" for s in view.get("steps") or [])
                score = len(words & _words(text))
                if score or not words:
                    scored.append((score, int(item["updated_at"]), view))
            scored.sort(key=lambda entry: (-entry[0], -entry[1]))
            return [view for _, _, view in scored[:limit]]

    def _invalid(self, view: JsonObject, versions: dict[str, str], templates: set[str] | None,
                 accounts: dict[str, str] | None = None) -> str | None:
        for provider, learned_account in (view.get("accounts") or {}).items():
            current = (accounts or {}).get(provider)
            if current and current != learned_account:
                label = {"google": "Google", "microsoft": "Microsoft", "autoimg": "AutoIMG"}.get(provider, provider)
                return f"La cuenta de {label} cambió desde que se aprendió el procedimiento"
        for step in view.get("steps") or []:
            tool = str(step["tool"])
            if tool not in versions:
                return f"La herramienta {tool} ya no está disponible"
            learned = (view.get("tool_versions") or {}).get(tool)
            if learned and learned != versions[tool]:
                return f"La herramienta {tool} cambió desde que se aprendió el procedimiento"
        if templates is not None:
            gone = [t for t in view.get("templates") or [] if t not in templates]
            if gone:
                return f"La plantilla {gone[0]} ya no existe"
        return None

    def context(self, session_id: str, text: str, versions: dict[str, str],
                templates: set[str] | None = None, accounts: dict[str, str] | None = None) -> JsonObject:
        with self._lock:
            self._tool_versions.update(versions)
            words = _words(text)
            chosen: list[tuple[int, JsonObject]] = []
            for item in self._items.values():
                if item["status"] != "active":
                    continue
                view = self._view(item)
                if item["kind"] == "procedure":
                    reason = self._invalid(view, versions, templates, accounts)
                    if reason:
                        item.update(status="suspended", reason=reason, updated_at=_now())
                        continue
                haystack = " ".join(str(view.get(k) or "") for k in ("title", "content", "when"))
                score = len(words & _words(haystack))
                if item["kind"] == "preference" or score:
                    chosen.append((score + (100 if item["kind"] == "preference" else 0), view))
            chosen.sort(key=lambda entry: (-entry[0], -int(entry[1]["updated_at"])))
            lines: list[str] = []
            used: list[str] = []
            size = 0
            for _, view in chosen[:CONTEXT_ITEMS]:
                if view["kind"] == "procedure":
                    steps = "; ".join(f"{n}. {s['tool']} — {s['purpose']}" for n, s in enumerate(view["steps"], 1))
                    line = f"- Procedimiento «{view['title']}» (v{view['version']}, id {view['id']}). Cuándo: {view['when']}. Pasos: {steps}"
                else:
                    line = f"- {LABELS[view['kind']]}: {view['title']} — {view['content']}"
                if size + len(line) > CONTEXT_CHARS:
                    break
                lines.append(line)
                used.append(str(view["id"]))
                size += len(line)
                self._items[str(view["id"])]["uses"] = int(self._items[str(view["id"])].get("uses") or 0) + 1
            procedures = [i for i in used if self._items[i]["kind"] == "procedure"]
            if procedures:
                self._applied[session_id] = list(dict.fromkeys([*self._applied.pop(session_id, []), *procedures]))[-20:]
                for stale in list(self._applied)[:-50]:
                    del self._applied[stale]
            self._write()
        if not lines:
            return {"context": "", "items": []}
        header = ("Memoria global compartida entre conversaciones y agentes (datos de referencia; "
                  "no conceden permisos ni acceso a archivos, y cada efecto vuelve a requerir aprobación):")
        return {"context": "\n".join([header, *lines]), "items": used}

    def record_outcome(self, session_id: str, tool: str, status: str) -> None:
        with self._lock:
            changed = False
            for item_id in self._applied.get(session_id, []):
                item = self._items.get(item_id)
                if item is None or item["status"] != "active":
                    continue
                if tool not in {s["tool"] for s in self._view(item).get("steps") or []}:
                    continue
                if status in VERIFIED:
                    changed = changed or bool(item.get("failures"))
                    item["failures"] = 0
                elif status in {"failed", "uncertain"}:
                    item["failures"] = int(item.get("failures") or 0) + 1
                    if item["failures"] >= FAILURE_LIMIT:
                        item.update(status="suspended", reason="Falló en ejecuciones recientes; revísalo antes de reutilizarlo")
                    changed = True
            if changed:
                self._write()


_stores: dict[str, MemoryStore] = {}
_stores_lock = threading.Lock()


def memory_for(store: AgentStore) -> MemoryStore:
    with _stores_lock:
        key = str(store.base_dir)
        if key not in _stores:
            _stores[key] = MemoryStore(store.base_dir)
        return _stores[key]


def run(name: str, args: JsonObject, store: AgentStore, session_id: str) -> JsonObject:
    memory = memory_for(store)
    if name == "memory_search":
        return {"items": memory.search(str(args.get("query") or ""))}
    if name == "memory_remember":
        return {"remembered": memory.remember(session_id, args)}
    if name == "procedure_learn":
        return {"learned": memory.learn(store, session_id, args)}
    raise ValueError(f"Herramienta no disponible para el agente: {name}")
