"""Dynamic plugin loader for format extensions."""

from __future__ import annotations

import ast
import importlib.util
import logging
import sys
from typing import TYPE_CHECKING

from backend.core.format_registry import FormatRegistry, get_registry
from backend.utils.paths import user_data_path

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)

_BLOCKED_IMPORTS = {"os", "sys", "subprocess", "ctypes", "socket", "urllib", "http", "ftplib", "shlex", "pathlib", "signal", "multiprocessing", "threading", "importlib", "builtins", "code", "codeop", "runpy", "pdb", "xmlrpc"}
_BLOCKED_NAMES = {"eval", "exec", "compile", "__import__", "open", "globals", "locals", "vars", "getattr", "setattr", "delattr", "type", "super", "__build_class__"}
_BLOCKED_ATTRS = {"__class__", "__bases__", "__subclasses__", "__mro__", "__globals__", "__code__", "__func__", "__self__", "__dict__", "__weakref__", "__subclasshook__"}

_PLUGIN_ALLOWED_ATTRS = {"register", "add_format", "__name__", "__doc__", "__module__", "__file__"}


class PluginRegistry:
    """Registry exposed to plugins for registering formats."""

    def __init__(self, format_registry: FormatRegistry) -> None:
        self.formats = format_registry

    def add_format(self, name: str, ext: str, modes: tuple[str, ...], encoder=None) -> None:
        """Register a new image format via plugin."""
        self.formats.add_format(name, ext, modes, encoder)


def _is_safe_plugin(source: str) -> bool:
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return False

    has_register = False
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "register":
            has_register = True
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".")[0] in _BLOCKED_IMPORTS:
                    return False
        if isinstance(node, ast.ImportFrom):
            module = (node.module or "").split(".")[0]
            if module in _BLOCKED_IMPORTS:
                return False
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _BLOCKED_NAMES:
            return False
        if isinstance(node, ast.Attribute) and node.attr in _BLOCKED_ATTRS:
            return False
        if isinstance(node, ast.Name) and node.id in _BLOCKED_NAMES:
            return False
    return has_register


def load_plugins_from_dir(plugins_dir: Path | None = None) -> None:
    """Load all .py plugins from the plugins directory."""
    if plugins_dir is None:
        plugins_dir = user_data_path("plugins")
    plugins_dir.mkdir(parents=True, exist_ok=True)

    for file_path in plugins_dir.glob("*.py"):
        if file_path.name.startswith("_"):
            continue
        try:
            source = file_path.read_text(encoding="utf-8")
            if not _is_safe_plugin(source):
                logger.warning("Plugin %s bloqueado por uso de APIs no permitidas", file_path.name)
                continue
            spec = importlib.util.spec_from_file_location(file_path.stem, file_path)
            if spec is None or spec.loader is None:
                continue
            module = importlib.util.module_from_spec(spec)
            # Use a unique module name to avoid collisions
            module_name = f"_plugin_{file_path.stem}"
            try:
                spec.loader.exec_module(module)
            except Exception:
                # Remove partial module from sys.modules on load failure
                sys.modules.pop(module_name, None)
                raise
            sys.modules[module_name] = module
            if hasattr(module, "register"):
                registry = PluginRegistry(get_registry())
                module.register(registry)
                logger.info("Plugin cargado: %s", file_path.name)
            else:
                logger.warning("Plugin %s no tiene función register()", file_path.name)
        except Exception as exc:
            logger.exception("Error cargando plugin %s: %s", file_path.name, exc)
