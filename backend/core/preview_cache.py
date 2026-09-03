from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Any

_MAX_ENTRY_BYTES = 512 * 1024


class PreviewCache:

    def __init__(
        self,
        max_size: int = 100,
        ttl_seconds: int = 300,
        max_entry_bytes: int = _MAX_ENTRY_BYTES,
    ) -> None:
        self.max_size = max_size
        self.ttl = ttl_seconds
        self.max_entry_bytes = max_entry_bytes
        self._cache: OrderedDict[str, tuple[Any, float]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> Any | None:
        with self._lock:
            if key not in self._cache:
                return None

            value, timestamp = self._cache[key]
            if time.time() - timestamp > self.ttl:
                del self._cache[key]
                return None

            self._cache.move_to_end(key)
            return value

    def set(self, key: str, value: Any) -> None:
        size = 0
        if isinstance(value, (str, bytes)):
            size = len(value)
            if isinstance(value, str) and value.startswith("data:"):
                return
        elif isinstance(value, dict):
            preview = value.get("preview")
            if isinstance(preview, str) and preview.startswith("data:"):
                return
            if isinstance(preview, (str, bytes)):
                size = len(preview)
        if size > self.max_entry_bytes:
            return
        with self._lock:
            if key in self._cache:
                del self._cache[key]

            self._cache[key] = (value, time.time())
            if len(self._cache) > self.max_size:
                self._cache.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()

_preview_cache = PreviewCache(max_size=75, ttl_seconds=180)


def get_preview_cache() -> PreviewCache:
    return _preview_cache
