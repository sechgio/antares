from __future__ import annotations

import time

from backend.core.integrations.types import JsonObject
from backend.ipc_protocol import send_notification

METHOD = "agent.progress"


def emit(session_id: str, source: str, event: str, **fields: object) -> None:
    if not session_id:
        return
    payload: JsonObject = {
        **fields,
        "session_id": session_id,
        "source": source,
        "event": event,
        "at": int(time.time() * 1000),
    }
    send_notification(METHOD, payload)
