"""Backend preview cache with TTL and LRU eviction."""
from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Any

# Skip caching oversized payloads (data-URI strings) to bound process memory.
_MAX_ENTRY_BYTES = 512 * 1024


class PreviewCache:
    """Thread-safe LRU cache for image previews with TTL."""

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
        """Get item from cache if not expired."""
        with self._lock:
            if key not in self._cache:
                return None

            value, timestamp = self._cache[key]
            if time.time() - timestamp > self.ttl:
                del self._cache[key]
                return None

            # Move to end (MRU)
            self._cache.move_to_end(key)
            return value

    def set(self, key: str, value: Any) -> None:
        """Add item to cache, evicting oldest if necessary. Skips oversized values."""
        size = 0
        if isinstance(value, (str, bytes)):
            size = len(value)
        elif isinstance(value, dict):
            preview = value.get("preview")
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
        """Clear all entries."""
        with self._lock:
            self._cache.clear()

_preview_cache = PreviewCache(max_size=75, ttl_seconds=180)


def get_preview_cache() -> PreviewCache:
    """Return the global preview cache singleton."""
    return _preview_cache
