from __future__ import annotations

import threading
from typing import Any

from backend.core.integrations.types import JsonObject

UNKNOWN_WINDOW = "UNKNOWN_WINDOW"
UNKNOWN_ELEMENT = "UNKNOWN_ELEMENT"
STALE_WINDOW = "STALE_WINDOW"
STALE_ELEMENT = "STALE_ELEMENT"


class DriverError(ValueError):
    pass


class TargetCache:
    def __init__(self) -> None:
        self._generation = 0
        self._windows: dict[str, JsonObject] = {}
        self._elements: dict[tuple[str, int], dict[str, JsonObject]] = {}
        self._raws: dict[tuple[str, int], dict[str, Any]] = {}  # allowlist
        self._lock = threading.RLock()

    @property
    def generation(self) -> int:
        with self._lock:
            return self._generation

    def remember_windows(self, windows: list[JsonObject]) -> int:
        with self._lock:
            self._generation += 1
            self._windows = {str(w["window_id"]): dict(w) for w in windows}
            self._elements = {
                key: elements
                for key, elements in self._elements.items()
                if key[1] == self._generation and key[0] in self._windows
            }
            self._raws = {
                key: raws
                for key, raws in self._raws.items()
                if key[1] == self._generation and key[0] in self._windows
            }
            return self._generation

    def remember_elements(
        self, window_id: str, generation: int, elements: list[JsonObject],
        raws: dict[str, Any] | None = None,  # allowlist
    ) -> None:
        with self._lock:
            if generation != self._generation or window_id not in self._windows:
                raise DriverError("La enumeración cambió; vuelve a llamar computer_use_enumerate")
            key = (str(window_id), generation)
            self._elements[key] = {str(e["element_id"]): dict(e) for e in elements}
            if raws is not None:
                self._raws[key] = dict(raws)

    def raw_element(self, window_id: str, element_id: str) -> Any | None:
        with self._lock:
            elements = self._elements.get((str(window_id), self._generation))
            raws = self._raws.get((str(window_id), self._generation))
        if not elements or not raws:
            return None
        entry = elements.get(str(element_id))
        if entry is None:
            return None
        return raws.get(str(entry["runtime_id"]))

    def window(self, window_id: str) -> JsonObject:
        with self._lock:
            entry = self._windows.get(str(window_id))
        if entry is None:
            raise DriverError(f"Ventana desconocida: {window_id}. Vuelve a llamar computer_use_enumerate.")
        return entry

    def element(self, window_id: str, element_id: str) -> JsonObject:
        with self._lock:
            elements = self._elements.get((str(window_id), self._generation))
        if elements is None:
            window = self.window(window_id)
            raise DriverError(f"Sin árbol de la ventana «{window.get('title')}». Llama computer_use_window_state.")
        entry = elements.get(str(element_id))
        if entry is None:
            raise DriverError(f"Elemento desconocido: {element_id}. Vuelve a llamar computer_use_window_state.")
        return entry

    def check_window(self, window_id: str, *, alive: bool) -> JsonObject:
        window = self.window(window_id)
        if not alive:
            raise DriverError(f"La ventana «{window.get('title')}» ya no existe. Vuelve a llamar computer_use_enumerate.")
        return window

    def check_element(self, window_id: str, element_id: str, runtime_ids_now: dict[str, JsonObject]) -> JsonObject:
        cached = self.element(window_id, element_id)
        current = runtime_ids_now.get(str(cached["runtime_id"]))
        if current is None:
            raise DriverError(
                "El elemento cambió desde la última observación (árbol obsoleto). Vuelve a llamar computer_use_window_state."
            )
        return current
