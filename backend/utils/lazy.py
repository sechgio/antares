from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any, Generic, TypeVar

T = TypeVar("T")


class LazySingleton(Generic[T]):
    """Thread-safe singleton created by ``factory`` on first ``get()`` call.

    Arguments passed to ``get()`` are forwarded to the factory only when the
    instance is created; subsequent calls return the cached instance and ignore
    them, matching the module-global double-checked-locking pattern this class
    replaces.
    """

    def __init__(self, factory: Callable[..., T]) -> None:
        self._factory = factory
        self._lock = threading.Lock()
        self._instance: T | None = None

    def get(self, *args: Any, **kwargs: Any) -> T:
        instance = self._instance
        if instance is None:
            with self._lock:
                instance = self._instance
                if instance is None:
                    instance = self._factory(*args, **kwargs)
                    self._instance = instance
        return instance

    def reset(self) -> None:
        """Drop the cached instance so the next ``get()`` creates a new one."""
        with self._lock:
            self._instance = None
