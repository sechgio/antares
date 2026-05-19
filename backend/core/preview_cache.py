"""Backend preview cache with TTL and LRU eviction."""
from __future__ import annotations

import time
import threading
from collections import OrderedDict
from typing import Any

class PreviewCache:
    """Thread-safe LRU cache for image previews with TTL."""
    
    def __init__(self, max_size: int = 100, ttl_seconds: int = 300) -> None:
        self.max_size = max_size
        self.ttl = ttl_seconds
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
        """Add item to cache, evicting oldest if necessary."""
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

_preview_cache = PreviewCache(max_size=200, ttl_seconds=600)

def get_preview_cache() -> PreviewCache:
    """Return the global preview cache singleton."""
    return _preview_cache
