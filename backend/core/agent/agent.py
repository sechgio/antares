"""Agente IA: conversación con tool-calling sobre los métodos del backend.

Herramientas seguras (métodos ``orchestratable`` del catálogo IPC, todas de
solo lectura) se ejecutan directamente. Cualquier otro método ``backend:*``
queda como herramienta con aprobación: el modelo la pide, el turno se pausa
y la UI muestra una tarjeta Aprobar/Rechazar antes de ejecutarla. Los métodos
``native:*`` (Electron) quedan fuera: el agente no puede invocarlos.

Las API keys salen del vault (``ai_providers``); nunca llegan al renderer.
Mensajes y aprobaciones se persisten en ``<datos>/ai-agent/``.
El cliente LLM y las specs de herramientas viven en ``agent_chat``.
"""

from __future__ import annotations

import hashlib
import json
import logging
import ntpath
import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import TimeoutError as FutureTimeoutError
from pathlib import Path

from backend.core.agent import drafts, resource_grants
from backend.core.agent.agent_chat import chat, gated_methods, readonly_methods, scrub_secrets
from backend.core.agent.cancel import RunCancelled, _CancelEvent, await_or_cancel
from backend.core.integrations import mcp_servers
from backend.core.integrations.types import JsonObject
from backend.core.ipc_catalog import (
    allows_raw_output_path,
    file_tokens_for,
    lane_for,
    timeout_ms_for,
    write_path_keys_for,
)
from backend.core.scheduler import get_scheduler
from backend.utils.atomic_write import atomic_write_json
from backend.utils.paths import user_data_path

logger = logging.getLogger(__name__)


def _schema_values(value: object, segments: tuple[str, ...]) -> list[object]:
    if not segments:
        return [value]
    if segments[0] == "*":
        children = value.values() if isinstance(value, dict) else value if isinstance(value, list) else []
        return [item for child in children for item in _schema_values(child, segments[1:])]
    return _schema_values(value[segments[0]], segments[1:]) if isinstance(value, dict) and segments[0] in value else []


def read_resources(
    method: str, args: JsonObject, grants: dict[str, JsonObject], drafts_root: Path | None = None,
) -> list[JsonObject]:
    """Revisión de cada archivo de lectura del método: archivos concedidos por el
    humano o borradores de la propia conversación."""
    revisions: list[JsonObject] = []
    for schema in file_tokens_for(method):
        for value in _schema_values(args, schema):
            if not value or (isinstance(value, str) and value.startswith(("data:", "canvas-asset:"))):
                continue
            if not isinstance(value, str):
                raise ValueError("El archivo del paso no está autorizado; elígelo o usa la entrada de imágenes")
            draft = drafts.inside(drafts_root, value) if drafts_root is not None else None
            if draft is not None and draft.is_file():
                stat = draft.stat()
                revisions.append({"path": str(draft), "size": stat.st_size, "mtime_ns": stat.st_mtime_ns, "value": value})
                continue
            revisions.append({**resource_grants.check(value, grants), "value": value})
    return sorted(revisions, key=lambda r: str(r["path"]))


def _write_keys(method: str) -> frozenset[str]:
    keys = write_path_keys_for(method) | {"outputPath", "output_path", "output_dir", "outputDir", "output_folder", "destino"}
    return keys | {"path"} if allows_raw_output_path(method) else keys


def _validate_action_paths(
    method: str, args: JsonObject, grants: dict[str, JsonObject] | None = None, drafts_root: Path | None = None,
) -> None:
    """Lecturas de archivos concedidos o borradores; salidas solo dentro de los borradores."""
    read_resources(method, args, grants or {}, drafts_root)
    for key in ("_resolved_file_token_path", "_resolved_output_path"):
        if args.get(key):
            raise ValueError("El agente no puede concederse permisos de archivos")
    for key in _write_keys(method):
        value = args.get(key)
        if not value:
            continue
        if not isinstance(value, str) or drafts_root is None or drafts.inside(drafts_root, value) is None:
            raise ValueError("El destino del paso no está autorizado; el agente escribe en sus borradores")

_MAX_TOOL_STEPS = 12
_MAX_TOOL_RESULT_CHARS = 6_000
_MAX_RECEIPT_CHARS = 2 * 1024 * 1024
_MAX_SESSIONS = 50
_APPROVAL_TTL_MS = 24 * 3600 * 1000
_INTERRUPTED_RESULT = json.dumps(
    {"error": "Acción interrumpida: el resultado puede ser incierto. Compruébalo antes de repetirla."},
    ensure_ascii=False,
)


def _now_ms() -> float:
    return time.time() * 1000


def fingerprint(method: str, params: object) -> str:
    """Huella determinista de la intención: método y parámetros normalizados."""
    canonical = json.dumps({"method": method, "params": params}, sort_keys=True, ensure_ascii=False,
                           separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def dispatch_key(session_id: str, call_id: str) -> str:
    """El ``call_id`` del proveedor solo es único dentro de su conversación."""
    return f"{session_id}:{call_id}"


def summarize_result(full: str) -> str:
    """Resumen para el modelo: el comprobante completo se guarda aparte."""
    if len(full) <= _MAX_TOOL_RESULT_CHARS:
        return full
    preview = full[: _MAX_TOOL_RESULT_CHARS - 200]
    return json.dumps({"truncated": True, "total_chars": len(full), "preview": preview}, ensure_ascii=False)


def result_failed(full: str) -> bool:
    try:
        data = json.loads(full)
    except json.JSONDecodeError:
        return False
    return isinstance(data, dict) and ("error" in data or data.get("isError") is True)


class AgentStore:
    """Persistencia JSON de sesiones, mensajes y aprobaciones del agente."""

    def __init__(self, base_dir: Path | None = None) -> None:
        base = base_dir or user_data_path("ai-agent")
        base.mkdir(parents=True, exist_ok=True)
        self._sessions_path = base / "sessions.json"
        self._approvals_path = base / "approvals.json"
        self._grants_path = base / "grants.json"
        self._drafts_root = base / "drafts"
        self._dispatches_path = base / "dispatches.json"
        self._messages_dir = base / "messages"
        self._messages_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._sessions: dict[str, JsonObject] = self._read(self._sessions_path)
        self._approvals: dict[str, JsonObject] = self._read(self._approvals_path)
        self._grants: dict[str, JsonObject] = self._read(self._grants_path)
        loaded = self._read(self._dispatches_path)
        # Registros antiguos indexados solo por call_id: se reindexan por sesión.
        self._dispatches: dict[str, JsonObject] = {
            (key if ":" in key or not isinstance(rec, dict) or not rec.get("session_id")
             else dispatch_key(str(rec["session_id"]), str(rec.get("call_id") or key))): rec
            for key, rec in loaded.items()
        }
        # Un dispatch "running" al cargar quedó interrumpido: su resultado es
        # incierto y no debe reejecutarse ni servirse como éxito.
        dirty = self._dispatches.keys() != loaded.keys()
        for record in self._dispatches.values():
            if record.get("status") == "running":
                record["status"] = "uncertain"
                record["result"] = _INTERRUPTED_RESULT
                record["summary"] = _INTERRUPTED_RESULT
                dirty = True
        if dirty:
            self._write_dispatches()
        # La reserva es la fuente de verdad del consumo de una aprobación: si el
        # proceso cayó entre ambas escrituras, se completa aquí.
        consumed = False
        for record in self._dispatches.values():
            approval = self._approvals.get(str(record.get("approval_id") or ""))
            if approval is not None and not approval.get("consumed_by"):
                approval["consumed_by"] = record.get("op_id") or record.get("call_id")
                consumed = True
        if consumed:
            self._write_approvals()

    @staticmethod
    def _read(path: Path) -> dict[str, JsonObject]:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return dict(data) if isinstance(data, dict) else {}

    def _write_sessions(self) -> None:
        atomic_write_json(self._sessions_path, self._sessions)

    def _write_approvals(self) -> None:
        atomic_write_json(self._approvals_path, self._approvals)

    def _write_grants(self) -> None:
        atomic_write_json(self._grants_path, self._grants)

    def _write_dispatches(self) -> None:
        atomic_write_json(self._dispatches_path, self._dispatches)

    def _messages_path(self, session_id: str) -> Path:
        safe = "".join(ch for ch in session_id if ch.isalnum() or ch in "-_")[:64]
        return self._messages_dir / f"{safe}.json"

    def _read_messages(self, session_id: str) -> list[JsonObject]:
        try:
            data = json.loads(self._messages_path(session_id).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        return list(data) if isinstance(data, list) else []

    def _write_messages(self, session_id: str, messages: list[JsonObject]) -> None:
        atomic_write_json(self._messages_path(session_id), messages)

    # ---- sesiones ----

    def create_session(self, provider: str, model: str, title: str) -> JsonObject:
        session: JsonObject = {
            "id": uuid.uuid4().hex[:12],
            "title": title or "Conversación",
            "provider": provider,
            "model": model,
            "created_at": _now_ms(),
            "updated_at": _now_ms(),
            "last_error": None,
        }
        with self._lock:
            self._sessions[session["id"]] = session
            if len(self._sessions) > _MAX_SESSIONS:
                oldest = sorted(self._sessions.values(), key=lambda s: s.get("created_at") or 0)
                for old in oldest[: len(self._sessions) - _MAX_SESSIONS]:
                    self._sessions.pop(str(old["id"]), None)
            self._write_sessions()
        return session

    def get_session(self, session_id: str) -> JsonObject | None:
        with self._lock:
            session = self._sessions.get(session_id)
            return dict(session) if isinstance(session, dict) else None

    def list_sessions(self) -> list[JsonObject]:
        with self._lock:
            return sorted(
                (dict(s) for s in self._sessions.values()),
                key=lambda s: s.get("updated_at") or 0,
                reverse=True,
            )

    def touch_session(self, session_id: str, error: str | None = None) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return
            session["updated_at"] = _now_ms()
            session["last_error"] = error
            self._write_sessions()

    def delete_session(self, session_id: str) -> bool:
        with self._lock:
            removed = self._sessions.pop(session_id, None) is not None
            if removed:
                self._write_sessions()
            self._approvals = {k: a for k, a in self._approvals.items() if a.get("session_id") != session_id}
            self._write_approvals()
            self.revoke_grants(session_id)
            self._messages_path(session_id).unlink(missing_ok=True)
        return removed

    # ---- mensajes ----

    def messages(self, session_id: str) -> list[JsonObject]:
        with self._lock:
            return [dict(m) for m in self._read_messages(session_id)]

    def mark_interrupted_turns(self) -> int:
        """Recupera progreso sin volver a ejecutar herramientas ni decisiones."""
        marked = 0
        with self._lock:
            for session_id in list(self._sessions):
                pending = {a["call_id"] for a in self.pending_approvals(session_id)}
                messages = self._read_messages(session_id)
                changed = False
                for msg in messages:
                    for call in msg.get("tool_calls") or []:
                        if call.get("status") in ("queued", "running", "pending") and call["id"] not in pending:
                            call.update(status="interrupted", result=_INTERRUPTED_RESULT)
                            changed = True
                partial = self._sessions[session_id].pop("_partial_text", "")
                if (
                    partial and messages and messages[-1].get("role") == "assistant"
                    and not messages[-1].get("tool_calls")
                    and str(messages[-1].get("content") or "").startswith(partial)
                ):
                    partial = ""  # la respuesta ya se escribió antes de limpiar el checkpoint
                interrupted = bool(messages and (
                    messages[-1].get("role") in ("user", "tool_result")
                    or messages[-1].get("tool_calls")
                ))
                if not pending and (partial or interrupted):
                    messages.append({
                        "role": "assistant",
                        "content": (f"{partial}\n\n" if partial else "") + (
                            "⚠ El turno anterior quedó interrumpido al cerrar la aplicación. "
                            "Comprueba las acciones antes de continuar; no se han repetido automáticamente."
                        ),
                        "ts": _now_ms(),
                    })
                    marked += 1
                    changed = True
                if changed:
                    self._write_messages(session_id, messages)
            self._write_sessions()
        return marked

    def save_partial(self, session_id: str, text: str) -> None:
        with self._lock:
            if session_id in self._sessions:
                self._sessions[session_id]["_partial_text"] = text
                self._write_sessions()

    def append_message(self, session_id: str, message: JsonObject) -> None:
        with self._lock:
            if session_id not in self._sessions:
                return  # sesión borrada con el turno en curso: no recrear el archivo
            messages = self._read_messages(session_id)
            messages.append({**message, "ts": _now_ms()})
            self._write_messages(session_id, messages)
            session = self._sessions.get(session_id)
            if session is not None and message.get("role") == "assistant":
                session.pop("_partial_text", None)
            if (
                message.get("role") == "user"
                and session is not None
                and session.get("title") == "Conversación"
                and message.get("content")
            ):
                session["title"] = str(message["content"]).strip()[:60] or "Conversación"
            self.touch_session(session_id)

    def update_tool_call(self, session_id: str, call_id: str, status: str, result: str) -> None:
        with self._lock:
            messages = self._read_messages(session_id)
            for msg in reversed(messages):
                for call in msg.get("tool_calls") or []:
                    if call.get("id") == call_id:
                        call["status"] = status
                        call["result"] = result[:_MAX_TOOL_RESULT_CHARS]
                        self._write_messages(session_id, messages)
                        return

    # ---- aprobaciones ----

    # ---- archivos concedidos por el humano ----

    def add_grants(self, session_id: str, records: list[JsonObject]) -> None:
        with self._lock:
            session_grants = self._grants.setdefault(session_id, {})
            for record in records:
                session_grants[resource_grants.grant_key(record)] = record
            self._write_grants()

    def drafts_dir(self, session_id: str) -> Path:
        safe = "".join(ch for ch in session_id if ch.isalnum() or ch in "-_")[:64]
        if not safe:
            raise ValueError("Sesión de agente no válida")
        return self._drafts_root / safe

    def grants_for(self, session_id: str) -> dict[str, JsonObject]:
        with self._lock:
            return {key: dict(value) for key, value in (self._grants.get(session_id) or {}).items()}

    def revoke_grants(self, session_id: str) -> int:
        with self._lock:
            removed = self._grants.pop(session_id, None)
            if removed is not None:
                self._write_grants()
            return len(removed or {})

    def create_approval(self, session_id: str, call: JsonObject) -> JsonObject:
        approval = {
            "id": uuid.uuid4().hex[:12],
            "session_id": session_id,
            "call_id": call["id"],
            "method": call["name"],
            "params": call.get("params") or {},
            "fingerprint": call.get("fingerprint") or fingerprint(str(call["name"]), call.get("params") or {}),
            "status": "pending",
            "created_at": _now_ms(),
            "decided_at": None,
        }
        with self._lock:
            self._approvals[approval["id"]] = approval
            self._write_approvals()
        return approval

    def _expire_stale_approvals(self) -> None:
        """Las aprobaciones ``pending`` más viejas que el TTL dejan de ser
        decidibles: una decisión tardía no debe disparar una acción antigua."""
        with self._lock:
            now = _now_ms()
            stale = [
                a for a in self._approvals.values()
                if a.get("status") == "pending"
                and now - float(a.get("created_at") or now) > _APPROVAL_TTL_MS
            ]
            if not stale:
                return
            for approval in stale:
                approval["status"] = "expired"
                approval["decided_at"] = now
            self._write_approvals()

    def pending_approvals(self, session_id: str | None = None) -> list[JsonObject]:
        self._expire_stale_approvals()
        with self._lock:
            out = [
                dict(a)
                for a in self._approvals.values()
                if a.get("status") == "pending" and (session_id is None or a.get("session_id") == session_id)
            ]
            return sorted(out, key=lambda a: a.get("created_at") or 0)

    def get_approval(self, approval_id: str) -> JsonObject | None:
        with self._lock:
            approval = self._approvals.get(approval_id)
            return dict(approval) if isinstance(approval, dict) else None

    def decide_approval(self, approval_id: str, approved: bool) -> JsonObject | None:
        self._expire_stale_approvals()
        with self._lock:
            approval = self._approvals.get(approval_id)
            if approval is None or approval.get("status") != "pending":
                return None
            approval["status"] = "approved" if approved else "denied"
            approval["decided_at"] = _now_ms()
            self._write_approvals()
            return dict(approval)

    def approval_for_call(self, session_id: str, call_id: str) -> JsonObject | None:
        """Aprobación existente para una llamada; permite reanudar la espera tras
        un reinicio sin crear duplicados ni redecidir."""
        self._expire_stale_approvals()
        with self._lock:
            for approval in self._approvals.values():
                if approval.get("session_id") == session_id and approval.get("call_id") == call_id:
                    return dict(approval)
            return None

    def deny_pending_approvals(self, session_id: str) -> list[str]:
        self._expire_stale_approvals()
        with self._lock:
            denied: list[str] = []
            for approval in self._approvals.values():
                if approval.get("session_id") == session_id and approval.get("status") == "pending":
                    approval["status"] = "denied"
                    approval["decided_at"] = _now_ms()
                    denied.append(str(approval["id"]))
            if denied:
                self._write_approvals()
            return denied

    # ---- ejecuciones deduplicadas (replay unsafe) ----

    def get_dispatch(self, session_id: str, call_id: str) -> JsonObject | None:
        with self._lock:
            record = self._dispatches.get(dispatch_key(session_id, call_id))
            return dict(record) if isinstance(record, dict) else None

    def dispatch_claim(
        self, session_id: str, call_id: str, method: str, params: JsonObject, approval_id: str | None,
    ) -> tuple[str, JsonObject]:
        """Reserva atómica de una operación.

        Devuelve ``("new", registro)`` solo al ganador, que debe iniciar el
        worker; ``("existing", registro)`` a quien repite la misma intención y
        ``("conflict", registro)`` si el ``call_id`` ya se usó con otra intención
        en esta conversación. Con ``approval_id`` la reserva exige una aprobación
        aprobada, vinculada a la llamada, con la misma huella y sin consumir, y la
        consume en la misma operación (``("rejected", {"error": ...})`` si no)."""
        intent = fingerprint(method, params)
        key = dispatch_key(session_id, call_id)
        with self._lock:
            existing = self._dispatches.get(key)
            if isinstance(existing, dict):
                same = existing.get("method") == method and existing.get("fingerprint") in (None, intent)
                return ("existing" if same else "conflict"), dict(existing)
            approval = None
            if approval_id is not None:
                self._expire_stale_approvals()
                approval = self._approvals.get(approval_id)
                error = None
                if (approval is None or approval.get("status") != "approved"
                        or approval.get("session_id") != session_id or approval.get("call_id") != call_id
                        or approval.get("method") != method):
                    error = "La herramienta requiere una aprobación aprobada para esta llamada"
                elif (approval.get("fingerprint")
                      or fingerprint(str(approval.get("method")), approval.get("params") or {})) != intent:
                    error = "Los parámetros no coinciden con los aprobados; vuelve a pedir aprobación"
                elif approval.get("consumed_by"):
                    error = "Esta aprobación ya se usó en otra ejecución"
                if error:
                    return "rejected", {"error": error}
            record: JsonObject = {
                "op_id": uuid.uuid4().hex,
                "call_id": call_id,
                "session_id": session_id,
                "method": method,
                "fingerprint": intent,
                "approval_id": approval_id,
                "status": "running",
                "started_at": _now_ms(),
                "result": None,
                "summary": None,
            }
            self._dispatches[key] = record
            # Primero la reserva (journal) y después el consumo: al reabrir, el
            # store completa el consumo a partir de las reservas.
            self._write_dispatches()
            if approval is not None:
                approval["consumed_by"] = record["op_id"]
                self._write_approvals()
            return "new", dict(record)

    def dispatch_finish(self, session_id: str, call_id: str, op_id: str, status: str, result: str) -> None:
        with self._lock:
            record = self._dispatches.get(dispatch_key(session_id, call_id))
            if record is None or record.get("status") != "running" or record.get("op_id") != op_id:
                return
            record["status"] = status
            record["result"] = result[:_MAX_RECEIPT_CHARS]
            record["summary"] = summarize_result(result)
            record["finished_at"] = _now_ms()
            self._write_dispatches()


class AgentRunner:
    """Ejecuta turnos del agente en hilos daemon, con pausa por aprobaciones."""

    def __init__(
        self,
        store: AgentStore,
        handler_getter: Callable[[str], Callable[[JsonObject], JsonObject] | None],
    ) -> None:
        self._store = store
        self._handler_getter = handler_getter
        self._running: dict[str, threading.Thread] = {}
        self._decisions: dict[str, list[JsonObject]] = {}
        self._cancel: dict[str, _CancelEvent] = {}
        self._partial: dict[str, str] = {}
        self._partial_saved_at: dict[str, float] = {}
        self._lock = threading.RLock()
        self._store.mark_interrupted_turns()

    def is_running(self, session_id: str) -> bool:
        with self._lock:
            thread = self._running.get(session_id)
            return bool(thread and thread.is_alive())

    def _spawn(self, session_id: str, name: str) -> None:
        if self.is_running(session_id):
            return
        token = self._cancel.get(session_id)
        if token is None or token.cancelled:
            self._cancel[session_id] = _CancelEvent()
        thread = threading.Thread(target=self._turn_main, args=(session_id,), name=name, daemon=True)
        self._running[session_id] = thread
        thread.start()

    def cancel_turn(self, session_id: str) -> bool:
        """Detiene el turno en curso de forma cooperativa (la llamada al
        proveedor en vuelo se abandona vía ``await_or_cancel``)."""
        with self._lock:
            if not self.is_running(session_id) and self._store.pending_approvals(session_id):
                self._spawn(session_id, f"agent-cancel-{session_id}")
            token = self._cancel.get(session_id)
            if token is None or not self.is_running(session_id):
                return False
            token.cancel()
            return True

    def _set_partial(self, session_id: str, text: str, token: _CancelEvent | None = None) -> None:
        with self._lock:
            if token is not None and (token.cancelled or self._cancel.get(session_id) is not token):
                return
            self._partial[session_id] = text
            now = time.monotonic()
            if now - self._partial_saved_at.get(session_id, float("-inf")) >= 1:
                self._store.save_partial(session_id, text)
                self._partial_saved_at[session_id] = now

    def partial_text(self, session_id: str) -> str | None:
        """Texto en vivo; el último checkpoint permite recuperarlo tras reiniciar."""
        with self._lock:
            return self._partial.get(session_id) or None

    def start_turn(self, session_id: str, content: str) -> None:
        with self._lock:
            if self.is_running(session_id):
                raise ValueError("Ya hay un turno en curso en esta conversación")
            if self._store.pending_approvals(session_id):
                raise ValueError("Resuelve primero las aprobaciones pendientes de esta conversación")
            self._partial.pop(session_id, None)
            self._partial_saved_at.pop(session_id, None)
            self._store.append_message(session_id, {"role": "user", "content": content})
            self._spawn(session_id, f"agent-turn-{session_id}")

    def decide(self, approval_id: str, approved: bool) -> JsonObject:
        """Acepta la decisión y encola su ejecución, en orden por conversación."""
        with self._lock:
            prior = self._store.get_approval(approval_id)
            token = self._cancel.get(str(prior["session_id"])) if prior else None
            if prior is not None and token is not None and token.cancelled and self.is_running(str(prior["session_id"])):
                raise ValueError("El turno se está deteniendo; espera antes de decidir")
            approval = self._store.decide_approval(approval_id, approved)
            if approval is None:
                prior = self._store.get_approval(approval_id)
                if prior and prior.get("status") == "expired":
                    raise ValueError("La aprobación expiró; vuelve a pedírselo al agente")
                raise ValueError("Aprobación inexistente o ya decidida")
            session_id = str(approval["session_id"])
            self._decisions.setdefault(session_id, []).append(approval)
            self._spawn(session_id, f"agent-resume-{session_id}")
            return approval

    def _append_tool_result(self, session_id: str, call_id: str, name: str, result: str) -> None:
        self._store.append_message(
            session_id,
            {"role": "tool_result", "tool_use_id": call_id, "name": name, "content": result},
        )

    def _apply_decision(self, approval: JsonObject) -> None:
        session_id = str(approval["session_id"])
        call_id = str(approval["call_id"])
        if approval["status"] == "approved":
            method = str(approval["method"])
            invocable = (
                mcp_servers.parse_agent_tool(method) is not None
                or method in gated_methods()
                or method in readonly_methods()
            )
            if invocable:
                result = self._execute_call(
                    session_id, {"id": call_id, "name": method, "params": approval.get("params") or {}}
                )
            else:
                result = json.dumps(
                    {"error": f"Herramienta no disponible para el agente: {method}"},
                    ensure_ascii=False,
                )
                self._store.update_tool_call(session_id, call_id, "denied", result)
        else:
            result = json.dumps({"error": "El usuario rechazó esta acción"}, ensure_ascii=False)
            self._store.update_tool_call(session_id, call_id, "denied", result)
        self._append_tool_result(session_id, call_id, approval["method"], result)

    def _turn_main(self, session_id: str) -> None:
        try:
            while True:
                with self._lock:
                    token = self._cancel.get(session_id)
                    if token is not None and token.cancelled:
                        raise RunCancelled()
                    decisions = self._decisions.get(session_id)
                    approval = decisions.pop(0) if decisions else None
                    if not decisions:
                        self._decisions.pop(session_id, None)
                if approval is not None:
                    self._apply_decision(approval)
                    continue
                self._run_loop(session_id)
                with self._lock:
                    if not self._decisions.get(session_id):
                        return
        except RunCancelled:
            with self._lock:
                self._decisions.pop(session_id, None)
            for message in self._store.messages(session_id):
                for call in message.get("tool_calls") or []:
                    if call.get("status") in ("queued", "running", "pending"):
                        self._store.update_tool_call(session_id, call["id"], "interrupted", _INTERRUPTED_RESULT)
            for approval in self._store.pending_approvals(session_id):
                self._store.decide_approval(approval["id"], False)
            self._store.touch_session(session_id)
            partial = self.partial_text(session_id)
            self._store.append_message(
                session_id,
                {"role": "assistant", "content": (f"{partial}\n\n" if partial else "") + (
                    "⏹ Turno detenido por el usuario. Una herramienta ya iniciada puede seguir ejecutándose; "
                    "comprueba su resultado antes de repetirla."
                )},
            )
        except Exception as err:
            logger.exception("agent turn failed")
            partial = self.partial_text(session_id)
            self._store.append_message(
                session_id,
                {"role": "assistant", "content": (f"{partial}\n\n" if partial else "")
                 + f"⚠ Error del agente: {str(err)[:300]}"},
            )
            self._store.touch_session(session_id, error=str(err)[:300])
        finally:
            with self._lock:
                self._partial.pop(session_id, None)
                self._partial_saved_at.pop(session_id, None)
                if self._running.get(session_id) is threading.current_thread():
                    self._running.pop(session_id, None)
                if self._decisions.get(session_id):
                    self._spawn(session_id, f"agent-resume-{session_id}")

    def _execute_call(self, session_id: str, call: JsonObject) -> str:
        token = self._cancel.get(session_id)
        if token is not None and token.cancelled:
            raise RunCancelled()
        self._store.update_tool_call(session_id, str(call["id"]), "running", "")
        try:
            result = await_or_cancel(lambda: self._execute(call, token), token)
        except RunCancelled:
            self._store.update_tool_call(session_id, str(call["id"]), "interrupted", _INTERRUPTED_RESULT)
            raise
        try:
            data = json.loads(result)
        except json.JSONDecodeError:
            data = None  # un resultado truncado sigue siendo visible
        failed = isinstance(data, dict) and ("error" in data or data.get("isError") is True)
        self._store.update_tool_call(session_id, str(call["id"]), "failed" if failed else "done", result)
        return str(result)

    def _execute(self, call: JsonObject, token: _CancelEvent | None = None) -> str:
        if token is not None and token.cancelled:
            raise RunCancelled()
        name = str(call.get("name") or "")
        mcp_ref = mcp_servers.parse_agent_tool(name)
        if mcp_ref is not None:
            params = call.get("params")
            try:
                result = mcp_servers.call_tool(mcp_ref[0], name, params if isinstance(params, dict) else {}, advertised=True)
                return json.dumps(result, ensure_ascii=False, default=str)
            except Exception as err:
                return json.dumps({"error": str(err)[:500]}, ensure_ascii=False)
        session_id = call.get("session_id")
        if name in drafts.READ_TOOLS | drafts.EFFECT_TOOLS:
            try:
                if not session_id:
                    raise ValueError("Los borradores requieren una conversación")
                root = self._store.drafts_dir(str(session_id))
                raw_params = call.get("params")
                draft_args: JsonObject = dict(raw_params) if isinstance(raw_params, dict) else {}
                result = drafts.list_drafts(root) if name == "drafts_list" else drafts.save_draft(root, draft_args)
                return json.dumps(result, ensure_ascii=False)
            except Exception as err:
                return json.dumps({"error": str(err)[:500]}, ensure_ascii=False)
        fn = self._handler_getter(name)
        if fn is None:
            return json.dumps({"error": f"Método desconocido: {name}"})
        params = call.get("params")
        try:
            args = dict(params) if isinstance(params, dict) else {}
            grants = self._store.grants_for(str(session_id)) if session_id else {}
            drafts_root = self._store.drafts_dir(str(session_id)) if session_id else None
            if drafts_root is not None:
                args = drafts.bind_outputs(args, _write_keys(name), drafts_root)
            granted = {str(r["value"]) for r in read_resources(name, args, grants, drafts_root)}
            granted |= {str(args[k]) for k in _write_keys(name) if isinstance(args.get(k), str) and args[k]}

            def check_paths(value: object) -> None:
                if isinstance(value, dict):
                    for key, child in value.items():
                        if key in ("_file_grants", "_flow_file_grants") or key.startswith("_resolved_"):
                            raise ValueError("El agente no puede concederse permisos de archivos")
                        check_paths(child)
                elif isinstance(value, list):
                    for child in value:
                        check_paths(child)
                elif isinstance(value, str) and ntpath.isabs(value) and value not in granted:
                    raise ValueError("Usa los diálogos de Antares para autorizar archivos; la aprobación no autoriza rutas")

            check_paths(args)
            _validate_action_paths(name, args, grants, drafts_root)
            lane = lane_for(name)
            if lane == "sync":
                result = fn(args)
            else:
                scheduler = get_scheduler()
                future = scheduler.submit_heavy(fn, args) if lane == "heavy" else scheduler.submit_light(fn, args)
                if future is None:
                    raise ValueError("No se pudo programar la herramienta")
                try:
                    result = await_or_cancel(lambda: future.result(timeout=timeout_ms_for(name) / 1000), token)
                except RunCancelled:
                    future.cancel()
                    raise
                except FutureTimeoutError:
                    future.cancel()
                    raise ValueError("La herramienta excedió su tiempo; puede seguir ejecutándose, comprueba el resultado antes de repetirla") from None
            return json.dumps(scrub_secrets(result), ensure_ascii=False, default=str)
        except RunCancelled:
            raise
        except Exception as err:  # el error vuelve al modelo como resultado de la tool
            return json.dumps({"error": str(err)[:500]}, ensure_ascii=False)

    def _run_loop(self, session_id: str) -> None:
        session = self._store.get_session(session_id)
        if session is None:
            raise ValueError("Sesión de agente no encontrada")
        token = self._cancel.get(session_id)
        gated = set(gated_methods())
        for _ in range(_MAX_TOOL_STEPS):
            if token is not None and token.cancelled:
                raise RunCancelled()
            with self._lock:
                if self._store.pending_approvals(session_id) or self._decisions.get(session_id):
                    return  # pausa hasta aplicar las decisiones del usuario
            reply = await_or_cancel(
                lambda: chat(str(session["provider"]), str(session["model"]), self._store.messages(session_id),
                             on_delta=lambda chunk: self._set_partial(session_id, chunk, token)),
                token,
            )
            if token is not None and token.cancelled:
                raise RunCancelled()
            with self._lock:
                self._partial.pop(session_id, None)  # el texto parcial ya va a persistirse
                self._partial_saved_at.pop(session_id, None)
            calls = reply.get("calls") or []
            text = str(reply.get("text") or "")
            if calls:
                for call in calls:
                    name = str(call.get("name") or "")
                    is_mcp = mcp_servers.parse_agent_tool(name) is not None
                    call["gated"] = is_mcp or name in gated
                    call["allowed"] = call["gated"] or name in readonly_methods()
                    call["status"] = "queued"
                    call["result"] = None
                self._store.append_message(
                    session_id,
                    {"role": "assistant", "content": text, "tool_calls": calls},
                )
            elif text:
                self._store.append_message(session_id, {"role": "assistant", "content": text})
                return
            else:
                return

            for call in calls:
                if token is not None and token.cancelled:
                    raise RunCancelled()
                call_id = str(call["id"])
                if not call.get("allowed"):
                    result = json.dumps(
                        {"error": f"Herramienta no disponible para el agente: {call.get('name')}"},
                        ensure_ascii=False,
                    )
                    self._store.update_tool_call(session_id, call_id, "denied", result)
                    self._append_tool_result(session_id, call_id, call["name"], result)
                    continue
                if call.get("gated"):
                    self._store.create_approval(session_id, call)
                    self._store.update_tool_call(session_id, call_id, "pending", "")
                    continue  # se reanuda desde decide()
                result = self._execute_call(session_id, call)
                self._append_tool_result(session_id, call_id, call["name"], result)
        self._store.append_message(
            session_id,
            {
                "role": "assistant",
                "content": "Alcancé el límite de pasos de herramienta para este turno.",
            },
        )


_store_lock = threading.RLock()
_store_singleton: AgentStore | None = None
_runner_singleton: AgentRunner | None = None


def get_agent_store() -> AgentStore:
    global _store_singleton
    with _store_lock:
        if _store_singleton is None:
            _store_singleton = AgentStore()
        return _store_singleton


def get_agent_runner() -> AgentRunner:
    global _runner_singleton
    with _store_lock:
        if _runner_singleton is None:
            from backend.handlers import HANDLERS

            _runner_singleton = AgentRunner(get_agent_store(), HANDLERS.get)
        return _runner_singleton
