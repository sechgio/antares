from __future__ import annotations

import threading
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

EnvironmentGetter = Callable[[], Environment]


def make_cached_jinja_environment(
    templates_dir: Callable[[], Path],
    template_name: str,
    *,
    global_values: Mapping[str, Any] | None = None,
    filters: Mapping[str, Callable[..., Any]] | None = None,
) -> EnvironmentGetter:
    state: tuple[tuple[Path, int], Environment] | None = None
    lock = threading.Lock()

    def cache_key() -> tuple[Path, int]:
        directory = templates_dir()
        template = directory / template_name
        mtime = template.stat().st_mtime_ns if template.exists() else 0
        return directory, mtime

    def get_environment() -> Environment:
        nonlocal state
        key = cache_key()
        if state is not None and state[0] == key:
            return state[1]
        with lock:
            key = cache_key()
            if state is not None and state[0] == key:
                return state[1]
            environment = Environment(
                loader=FileSystemLoader(str(key[0])),
                autoescape=select_autoescape(("html", "xml")),
                auto_reload=True,
            )
            if global_values is not None:
                environment.globals.update(global_values)
            if filters is not None:
                environment.filters.update(filters)
            state = key, environment
            return environment

    return get_environment
