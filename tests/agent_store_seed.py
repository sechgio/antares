"""Semilla de sesiones legacy para tests de AgentStore.

La capa CRUD de sesiones se eliminó de ``AgentStore``; los tests que necesitan
una sesión la escriben directamente en ``store._sessions`` y en ``messages/``.
"""
from __future__ import annotations

import time
import uuid


def seed_session(
    store,
    session_id: str | None = None,
    *,
    provider: str = "ollama",
    model: str = "llama3.1",
    title: str = "Conversación",
    **extra,
) -> dict:
    """Crea una sesión legacy en ``store`` y la persiste en sessions.json."""
    sid = session_id or uuid.uuid4().hex[:12]
    store._sessions[sid] = {
        "id": sid,
        "title": title or "Conversación",
        "provider": provider,
        "model": model,
        "created_at": time.time() * 1000,
        "updated_at": time.time() * 1000,
        "last_error": None,
        **extra,
    }
    store._write_sessions()
    return dict(store._sessions[sid])


def seed_message(store, session_id: str, role: str, content: str = "", **extra) -> dict:
    """Añade un mensaje al archivo de la sesión (como hacía ``append_message``)."""
    message: dict = {"role": role, "content": content, "ts": time.time() * 1000, **extra}
    messages = store._read_messages(session_id)
    messages.append(message)
    store._write_messages(session_id, messages)
    return dict(message)


def read_messages(store, session_id: str) -> list[dict]:
    """Lee los mensajes persistidos de la sesión (sustituye a ``AgentStore.messages``)."""
    return [dict(m) for m in store._read_messages(session_id)]
