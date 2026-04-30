"""Format registry for extensible image format support."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

FormatEncoder = Callable[[Any, Path, str, dict[str, Any]], None]


class FormatRegistry:
    """Registry of supported image formats."""

    def __init__(self) -> None:
        self._formats: dict[str, dict[str, Any]] = {}

    def add_format(
        self,
        name: str,
        ext: str,
        modes: tuple[str, ...],
        encoder: FormatEncoder | None = None,
    ) -> None:
        """Register a new image format.

        Custom encoders receive the prepared PIL image, destination path,
        registered format name, and save options.
        """
        self._formats[name.upper()] = {
            "ext": ext,
            "modes": modes,
            "encoder": encoder,
        }

    def get(self, name: str) -> dict[str, Any] | None:
        """Get format info by name."""
        return self._formats.get(name.upper())

    def list_formats(self) -> list[str]:
        """List all registered format names."""
        return list(self._formats.keys())

    def __contains__(self, name: str) -> bool:
        return name.upper() in self._formats

    def __getitem__(self, name: str) -> dict[str, Any]:
        return self._formats[name.upper()]

    def keys(self) -> list[str]:
        """Return all registered format names (backward compatibility)."""
        return list(self._formats.keys())

    def values(self) -> list[dict[str, Any]]:
        """Return all registered format info dicts (backward compatibility)."""
        return list(self._formats.values())


# Global registry instance initialized with defaults
_registry = FormatRegistry()


def get_registry() -> FormatRegistry:
    """Return the global format registry."""
    return _registry
