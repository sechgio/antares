from __future__ import annotations

from typing import Any, Protocol

from backend.core.format_strategies.legacy_xobject import LegacyXObjectStrategy
from backend.core.format_strategies.visual_overlay import SimpleOverlayStrategy, VisualOverlayStrategy


class FormatStrategy(Protocol):
    def generate(self, template_bytes: bytes, desde: int, hasta: int, mapping: dict[str, Any] | None = None) -> bytes: ...


_strategies: dict[str, FormatStrategy] = {}


def register_strategy(name: str, strategy: FormatStrategy) -> None:
    _strategies[name] = strategy


def get_strategy(name: str) -> FormatStrategy:
    if name not in _strategies:
        msg = f"Unknown strategy: {name}"
        raise ValueError(msg)
    return _strategies[name]


register_strategy("legacy_xobject", LegacyXObjectStrategy())
register_strategy("visual_overlay", VisualOverlayStrategy())
register_strategy("simple_overlay", SimpleOverlayStrategy())
