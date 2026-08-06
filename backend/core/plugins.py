"""Dynamic plugin loader for format extensions.

Security model
--------------
Plugins are loaded only from ``user_data_path("plugins")`` and must expose a
``register()`` entry point.  Source is validated with an AST whitelist before
``exec_module`` runs, but plugins still execute in the same Python process as
the backend.  Treat third-party plugins as *use at your own risk*.
Opt-in via ``ANTARES_ENABLE_PLUGINS=1``. Approved plugins must be allowlisted
by SHA-256 hash in ``user_data_path("plugins/allowlist.json")``; others are
rejected. The AST allowlist is not a sandbox.
"""

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
_BLOCKED_NAMES = {"eval", "exec", "compile", "__import__", "open", "globals", "locals", "vars", "getattr", "setattr", "delattr", "type", "super", "__build_class__", "breakpoint", "memoryview", "input"}
_BLOCKED_ATTRS = {"__class__", "__bases__", "__subclasses__", "__mro__", "__globals__", "__code__", "__func__", "__self__", "__dict__", "__weakref__", "__subclasshook__"}

# Dunder attributes/names are a primary sandbox-escape vector (e.g.
# ``__builtins__``, ``__getattribute__``, ``__reduce__``, ``__init_subclass__``).
# Rather than enumerate every dangerous dunder, block ALL dunder access and only
# permit a tiny allowlist that legitimate plugins may need at module scope.
_ALLOWED_DUNDERS = {"__name__", "__doc__", "__module__", "__file__", "__qualname__", "__init__"}

_PLUGIN_ALLOWED_ATTRS = {"register", "add_format", "__name__", "__doc__", "__module__", "__file__"}


def _is_dangerous_dunder(identifier: str) -> bool:
    return (
        identifier.startswith("__")
        and identifier.endswith("__")
        and identifier not in _ALLOWED_DUNDERS
    )


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
        if isinstance(node, ast.Attribute) and (node.attr in _BLOCKED_ATTRS or _is_dangerous_dunder(node.attr)):
            return False
        if isinstance(node, ast.Name) and (node.id in _BLOCKED_NAMES or _is_dangerous_dunder(node.id)):
            return False
        # Block metaclass / class-keyword hooks (e.g. ``class X(metaclass=...)``)
        # which can run arbitrary code at class-creation time, bypassing the
        # name/attribute filters above.
        if isinstance(node, ast.ClassDef) and node.keywords:
            return False
    return has_register


def _load_allowlist(plugins_dir: Path) -> dict[str, str] | None:
    p = plugins_dir / "allowlist.json"
    if not p.exists():
        return None
    try:
        import json as _json
        data = _json.loads(p.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return {str(k): str(v) for k, v in data.items()}
    except Exception:
        logger.warning("allowlist.json inválido en %s", plugins_dir)
    return None


def load_plugins_from_dir(plugins_dir: Path | None = None) -> None:
    """Load all .py plugins from the plugins directory."""
    if plugins_dir is None:
        plugins_dir = user_data_path("plugins")
    plugins_dir.mkdir(parents=True, exist_ok=True)

    allowlist = _load_allowlist(plugins_dir)

    for file_path in plugins_dir.glob("*.py"):
        if file_path.name.startswith("_"):
            continue
        try:
            source = file_path.read_text(encoding="utf-8")
            if allowlist is not None:
                import hashlib as _hl
                h = _hl.sha256(source.encode("utf-8")).hexdigest()
                expected = allowlist.get(file_path.name)
                if expected is None or h != expected:
                    logger.warning("Plugin %s rechazado: no está en allowlist o hash no coincide", file_path.name)
                    continue
            elif file_path.name != "example.py":
                # Without an allowlist, only the example is allowed as a placeholder; others need explicit allowlist
                logger.warning("Plugin %s rechazado: sin allowlist.json no se cargan plugins (excepto example.py)", file_path.name)
                continue
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
