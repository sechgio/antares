"""Shared load/cache/save cycle for single-file JSON config stores.

Each config module keeps its own ``_config_file()`` seam (tests monkeypatch it)
and supplies ``parse``/``serialize`` callbacks for its payload shape; the store
owns the repeated path-keyed caching, read+fallback and atomic write cycle.
"""

from __future__ import annotations

import json
import logging
import threading
from collections.abc import Callable
from copy import deepcopy
from pathlib import Path
from typing import Any, Generic, TypeVar

from backend.utils.atomic_write import atomic_write_json

logger = logging.getLogger(__name__)

T = TypeVar("T")


class JsonConfigStore(Generic[T]):
    def __init__(
        self,
        path_fn: Callable[[], Path],
        *,
        default: Callable[[], T],
        parse: Callable[[Any], T | None],
        serialize: Callable[[T], Any],
        label: str,
        cached: bool = True,
    ) -> None:
        self._path_fn = path_fn
        self._default = default
        self._parse = parse
        self._serialize = serialize
        self._label = label
        self._cached = cached
        self._lock = threading.RLock()
        self._cache: tuple[Path, T] | None = None

    def _read(self, path: Path) -> T:
        if path.exists():
            try:
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
                parsed = self._parse(data)
                if parsed is not None:
                    return parsed
            except (json.JSONDecodeError, OSError, TypeError) as exc:
                logger.warning("Error leyendo %s, usando defaults: %s", self._label, exc)
        return self._default()

    def load(self) -> T:
        with self._lock:
            path = self._path_fn()
            if self._cached and self._cache is not None and self._cache[0] == path:
                return deepcopy(self._cache[1])
            value = self._read(path)
            if self._cached:
                self._cache = (path, value)
            return deepcopy(value)

    def save(self, value: T) -> T:
        with self._lock:
            path = self._path_fn()
            atomic_write_json(path, self._serialize(value))
            if self._cached:
                self._cache = (path, value)
            return value

    def invalidate(self) -> None:
        with self._lock:
            self._cache = None
