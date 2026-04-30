"""Dynamic plugin loader for format extensions."""

from __future__ import annotations

import importlib.util
import logging
import sys
from pathlib import Path

from backend.core.format_registry import FormatRegistry, get_registry
from backend.utils.paths import user_data_path

logger = logging.getLogger(__name__)


class PluginRegistry:
    """Registry exposed to plugins for registering formats."""

    def __init__(self, format_registry: FormatRegistry) -> None:
        self.formats = format_registry

    def add_format(self, name: str, ext: str, modes: tuple[str, ...], encoder=None) -> None:
        """Register a new image format via plugin."""
        self.formats.add_format(name, ext, modes, encoder)


def load_plugins_from_dir(plugins_dir: Path | None = None) -> None:
    """Load all .py plugins from the plugins directory."""
    if plugins_dir is None:
        plugins_dir = user_data_path("plugins")
    plugins_dir.mkdir(parents=True, exist_ok=True)

    for file_path in plugins_dir.glob("*.py"):
        if file_path.name.startswith("_"):
            continue
        try:
            spec = importlib.util.spec_from_file_location(file_path.stem, file_path)
            if spec is None or spec.loader is None:
                continue
            module = importlib.util.module_from_spec(spec)
            # Use a unique module name to avoid collisions
            module_name = f"_plugin_{file_path.stem}"
            sys.modules[module_name] = module
            spec.loader.exec_module(module)
            if hasattr(module, "register"):
                registry = PluginRegistry(get_registry())
                module.register(registry)
                logger.info("Plugin cargado: %s", file_path.name)
            else:
                logger.warning("Plugin %s no tiene función register()", file_path.name)
        except Exception as exc:
            logger.error("Error cargando plugin %s: %s", file_path.name, exc)
