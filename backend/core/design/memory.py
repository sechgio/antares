
from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.core.design.types import Memory, Note
from backend.utils.atomic_write import atomic_write_json
from backend.utils.paths import user_data_path

logger = logging.getLogger(__name__)

MEMORY_VERSION = 1
MAX_NOTES = 40
MAX_NOTE_CHARS = 600

_ulock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _clean(text: Any) -> str:
    if not isinstance(text, str):
        return ""
    return " ".join(text.split())[:MAX_NOTE_CHARS]


def default_memory() -> Memory:
    return {"version": MEMORY_VERSION, "notes": []}


def normalize_memory(raw: Any) -> Memory:
    raw = raw if isinstance(raw, dict) else {}
    raw_notes = raw.get("notes")
    notes: list[Note] = []
    if isinstance(raw_notes, list):
        seen: set[str] = set()
        for item in raw_notes[:MAX_NOTES]:
            if not isinstance(item, dict):
                continue
            text = _clean(item.get("text"))
            key = text.lower()
            if not text or key in seen:
                continue
            seen.add(key)
            note_id = item.get("id")
            notes.append(
                {
                    "id": note_id.strip()[:64] if isinstance(note_id, str) and note_id.strip() else str(uuid.uuid4()),
                    "text": text,
                    "createdAt": item.get("createdAt") if isinstance(item.get("createdAt"), str) else _now(),
                }
            )
    return {"version": MEMORY_VERSION, "notes": notes}


class DesignMemory:
    """Fichero único de preferencias, con lectura tolerante a corrupción."""

    def __init__(self, path: Path | None = None) -> None:
        self._path = path or user_data_path("design/memory.json")
        self._lock = threading.RLock()

    @property
    def path(self) -> Path:
        return self._path

    def load(self) -> Memory:
        with self._lock:
            try:
                data = self._path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                return default_memory()
            try:
                parsed = json.loads(data)
            except json.JSONDecodeError:
                logger.warning("[designMemory] fichero corrupto, se ignora: %s", self._path.name)
                return default_memory()
            return normalize_memory(parsed)

    def save(self, memory: Memory) -> Memory:
        normalized = normalize_memory(memory)
        with self._lock:
            atomic_write_json(self._path, normalized)
        return normalized

    def add(self, text: str) -> Memory:
        note = _clean(text)
        if not note:
            raise ValueError("La nota está vacía")
        current = self.load()
        if any(str(existing.get("text") or "").strip().lower() == note.lower() for existing in current["notes"]):
            return current
        current["notes"].append({"id": str(uuid.uuid4()), "text": note, "createdAt": _now()})
        return self.save(current)

    def update(self, note_id: str, text: str) -> Memory:
        note = _clean(text)
        if not note:
            raise ValueError("La nota está vacía")
        current = self.load()
        for existing in current["notes"]:
            if str(existing.get("id")) == note_id:
                existing["text"] = note
                return self.save(current)
        raise LookupError(f"No existe la nota: {note_id}")

    def delete(self, note_id: str) -> Memory:
        current = self.load()
        kept = [n for n in current["notes"] if str(n.get("id")) != note_id]
        if len(kept) == len(current["notes"]):
            raise LookupError(f"No existe la nota: {note_id}")
        current["notes"] = kept
        return self.save(current)

    def clear(self) -> Memory:
        return self.save(default_memory())


_memory_lock = threading.Lock()
_memory: DesignMemory | None = None


def get_design_memory() -> DesignMemory:
    global _memory
    with _memory_lock:
        if _memory is None:
            _memory = DesignMemory()
        return _memory


def render_block(memory: Memory) -> str:
    """Texto que se inyecta en el prompt del sistema.

    **Sin escape HTML**: esto lo lee el modelo en el prompt, no un navegador.
    Escaparlo aquí corrompería el texto ("&amp;").
    """
    notes = [str(n.get("text") or "").strip() for n in memory.get("notes") or []]
    notes = [n for n in notes if n]
    if not notes:
        return ""
    lines = "\n".join(f"- {n}" for n in notes)
    return (
        "\n\n## Decisiones de diseño del usuario\n\n"
        "El usuario ha fijado estas preferencias para todas sus presentaciones. "
        "Respétalas siempre que no contradigan la petición concreta, y no las "
        "vuelvas a preguntar:\n\n" + lines + "\n"
    )
