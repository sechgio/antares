
from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

FormatEncoder = Callable[[Any, Path, str, dict[str, Any]], None]


class FormatRegistry:

    def __init__(self) -> None:
        self._formats: dict[str, dict[str, Any]] = {}

    def add_format(
        self,
        name: str,
        ext: str,
        modes: tuple[str, ...],
        encoder: FormatEncoder | None = None,
    ) -> None:
        self._formats[name.upper()] = {
            "ext": ext,
            "modes": modes,
            "encoder": encoder,
        }

    def list_formats(self) -> list[str]:
        return list(self._formats.keys())

    def __contains__(self, name: str) -> bool:
        return name.upper() in self._formats

    def __getitem__(self, name: str) -> dict[str, Any]:
        return self._formats[name.upper()]


_registry = FormatRegistry()


def get_registry() -> FormatRegistry:
    return _registry
