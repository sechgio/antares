from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any, Generic, TypeVar

T = TypeVar("T")


class LazySingleton(Generic[T]):
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
        with self._lock:
            self._instance = None
