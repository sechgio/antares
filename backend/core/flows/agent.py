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

import json
import logging
import threading
import time
import uuid
from collections.abc import Callable
from pathlib import Path

from backend.core.flows.agent_chat import chat
from backend.core.flows.types import JsonObject
from backend.core.ipc_catalog import ORCHESTRATABLE_METHODS
from backend.utils.atomic_write import atomic_write_json
from backend.utils.paths import user_data_path

logger = logging.getLogger(__name__)

_MAX_TOOL_STEPS = 12
_MAX_TOOL_RESULT_CHARS = 6_000
_MAX_SESSIONS = 50


def _now_ms() -> float:
    return time.time() * 1000


class AgentStore:
    """Persistencia JSON de sesiones, mensajes y aprobaciones del agente."""

    def __init__(self, base_dir: Path | None = None) -> None:
        base = base_dir or user_data_path("ai-agent")
        base.mkdir(parents=True, exist_ok=True)
        self._sessions_path = base / "sessions.json"
        self._approvals_path = base / "approvals.json"
        self._messages_dir = base / "messages"
        self._messages_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._sessions: dict[str, JsonObject] = self._read(self._sessions_path)
        self._approvals: dict[str, JsonObject] = self._read(self._approvals_path)

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
            self._messages_path(session_id).unlink(missing_ok=True)
        return removed

    # ---- mensajes ----

    def messages(self, session_id: str) -> list[JsonObject]:
        with self._lock:
            return [dict(m) for m in self._read_messages(session_id)]

    def append_message(self, session_id: str, message: JsonObject) -> None:
        with self._lock:
            messages = self._read_messages(session_id)
            messages.append({**message, "ts": _now_ms()})
            self._write_messages(session_id, messages)
            session = self._sessions.get(session_id)
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

    def create_approval(self, session_id: str, call: JsonObject) -> JsonObject:
        approval = {
            "id": uuid.uuid4().hex[:12],
            "session_id": session_id,
            "call_id": call["id"],
            "method": call["name"],
            "params": call.get("params") or {},
            "status": "pending",
            "created_at": _now_ms(),
            "decided_at": None,
        }
        with self._lock:
            self._approvals[approval["id"]] = approval
            self._write_approvals()
        return approval

    def pending_approvals(self, session_id: str | None = None) -> list[JsonObject]:
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
        with self._lock:
            approval = self._approvals.get(approval_id)
            if approval is None or approval.get("status") != "pending":
                return None
            approval["status"] = "approved" if approved else "denied"
            approval["decided_at"] = _now_ms()
            self._write_approvals()
            return dict(approval)


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
        self._lock = threading.RLock()

    def is_running(self, session_id: str) -> bool:
        with self._lock:
            thread = self._running.get(session_id)
            return bool(thread and thread.is_alive())

    def _spawn(self, session_id: str, name: str) -> None:
        if self.is_running(session_id):
            return
        thread = threading.Thread(target=self._turn_main, args=(session_id,), name=name, daemon=True)
        self._running[session_id] = thread
        thread.start()

    def start_turn(self, session_id: str, content: str) -> None:
        with self._lock:
            if self.is_running(session_id):
                raise ValueError("Ya hay un turno en curso en esta conversación")
            self._store.append_message(session_id, {"role": "user", "content": content})
            self._spawn(session_id, f"agent-turn-{session_id}")

    def decide(self, approval_id: str, approved: bool) -> JsonObject:
        """Aplica la decisión del usuario, ejecuta la tool aprobada y reanuda."""
        approval = self._store.decide_approval(approval_id, approved)
        if approval is None:
            raise ValueError("Aprobación inexistente o ya decidida")
        session_id = str(approval["session_id"])
        call_id = str(approval["call_id"])
        if approved:
            result = self._execute({"name": approval["method"], "params": approval.get("params") or {}})
            self._store.update_tool_call(session_id, call_id, "done", result)
            self._store.append_message(
                session_id,
                {
                    "role": "tool_result",
                    "tool_use_id": call_id,
                    "name": approval["method"],
                    "content": result,
                },
            )
        else:
            denied = json.dumps({"error": "El usuario rechazó esta acción"}, ensure_ascii=False)
            self._store.update_tool_call(session_id, call_id, "denied", denied)
            self._store.append_message(
                session_id,
                {
                    "role": "tool_result",
                    "tool_use_id": call_id,
                    "name": approval["method"],
                    "content": denied,
                },
            )
        if not self._store.pending_approvals(session_id):
            with self._lock:
                self._spawn(session_id, f"agent-resume-{session_id}")
        return approval

    def _turn_main(self, session_id: str) -> None:
        try:
            self._run_loop(session_id)
        except Exception as err:
            logger.exception("agent turn failed")
            self._store.touch_session(session_id, error=str(err)[:300])
            self._store.append_message(
                session_id,
                {"role": "assistant", "content": f"⚠ Error del agente: {str(err)[:300]}"},
            )

    def _execute(self, call: JsonObject) -> str:
        name = str(call.get("name") or "")
        fn = self._handler_getter(name)
        if fn is None:
            return json.dumps({"error": f"Método desconocido: {name}"})
        params = call.get("params")
        try:
            result = fn(dict(params) if isinstance(params, dict) else {})
            return json.dumps(result, ensure_ascii=False, default=str)[:_MAX_TOOL_RESULT_CHARS]
        except Exception as err:  # el error vuelve al modelo como resultado de la tool
            return json.dumps({"error": str(err)[:500]}, ensure_ascii=False)

    def _run_loop(self, session_id: str) -> None:
        session = self._store.get_session(session_id)
        if session is None:
            raise ValueError("Sesión de agente no encontrada")
        for _ in range(_MAX_TOOL_STEPS):
            if self._store.pending_approvals(session_id):
                return  # pausa hasta decisión del usuario
            reply = chat(str(session["provider"]), str(session["model"]), self._store.messages(session_id))
            calls = reply.get("calls") or []
            text = str(reply.get("text") or "")
            if calls:
                for call in calls:
                    call["gated"] = call["name"] not in ORCHESTRATABLE_METHODS
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
                call_id = str(call["id"])
                if call.get("gated"):
                    self._store.create_approval(session_id, call)
                    self._store.update_tool_call(session_id, call_id, "pending", "")
                    continue  # se reanuda desde decide()
                result = self._execute(call)
                self._store.update_tool_call(session_id, call_id, "done", result)
                self._store.append_message(
                    session_id,
                    {
                        "role": "tool_result",
                        "tool_use_id": call_id,
                        "name": call["name"],
                        "content": result,
                    },
                )
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
            from backend.handlers import HANDLERS as _REGISTRY

            _runner_singleton = AgentRunner(get_agent_store(), _REGISTRY.get)
        return _runner_singleton
