"""Resolución de expresiones ``=...`` contra la memoria del run.

Una cadena que empieza por ``=`` se evalúa con una sintaxis estilo jq
reducida: raíces ``item``, ``items``, ``run`` y ``nodes.<id>`` seguidas de
segmentos ``.campo`` o ``[índice]``. Ejemplo: ``=nodes.n1.json.rows[0]``.
"""

from __future__ import annotations

import json
import re
from typing import Any

from backend.core.flows.types import JsonObject

_EXPR_PREFIX = "="
_SEGMENT_RE = re.compile(r"\.([A-Za-z_][A-Za-z0-9_]*)|\[(\d+|\"[^\"]*\"|'[^']*')\]")

ROOT_NODES = "nodes"


def is_expression(value: Any) -> bool:
    return isinstance(value, str) and value.startswith(_EXPR_PREFIX)


def _lookup(path: str, memory: JsonObject) -> Any:
    """Resuelve una ruta ``raíz.seg[i]`` dentro de la memoria del run."""
    if path.startswith(ROOT_NODES + "."):
        # ``nodes.<id>`` usa la primera parte tras 'nodes' como id de nodo
        rest = path[len(ROOT_NODES) + 1 :]
        node_id, sep, remainder = rest.partition(".")
        bracket = node_id.find("[")
        if bracket >= 0:
            remainder = node_id[bracket:] + (sep + remainder if sep else "")
            node_id = node_id[:bracket]
        elif sep:
            remainder = sep + remainder
        value: Any = (memory.get("nodes") or {}).get(node_id)
        if value is None:
            raise ValueError(f"Nodo sin salida en la memoria: {node_id}")
        path = remainder
    else:
        root, sep, remainder = path.partition(".")
        root = root.strip()
        if root.startswith("item["):
            bracket = root.find("[")
            remainder = root[bracket:] + (sep + remainder if sep else "")
            root = "item"
        elif sep:
            remainder = sep + remainder
        if root not in ("item", "items", "run"):
            raise ValueError(f"Raíz de expresión desconocida: {root}")
        value = memory.get(root)
        path = remainder

    while path:
        match = _SEGMENT_RE.match(path)
        if not match:
            raise ValueError(f"Expresión mal formada cerca de: {path!r}")
        field, index = match.groups()
        if field is not None:
            key: Any = field
        else:
            key = index[1:-1] if index.startswith(('"', "'")) else int(index)
        value = _get(value, key, path)
        path = path[match.end() :]
    return value


def _get(value: Any, key: Any, context: str) -> Any:
    if isinstance(key, int):
        if isinstance(value, list) and 0 <= key < len(value):
            return value[key]
        raise ValueError(f"Índice fuera de rango en expresión: {key} ({context!r})")
    if isinstance(value, dict):
        if key not in value:
            raise ValueError(f"Campo inexistente en expresión: {key} ({context!r})")
        return value[key]
    raise ValueError(f"No se puede acceder a {key} sobre un valor no objeto ({context!r})")


def eval_expression(expr: str, memory: JsonObject) -> Any:
    return _lookup(expr[len(_EXPR_PREFIX) :], memory)


def resolve(value: Any, memory: JsonObject) -> Any:
    """Resuelve expresiones recursivamente en cadenas, listas y dicts."""
    if is_expression(value):
        return eval_expression(value, memory)
    if isinstance(value, list):
        return [resolve(item, memory) for item in value]
    if isinstance(value, dict):
        return {key: resolve(item, memory) for key, item in value.items()}
    return value


_INTERPOLATE_RE = re.compile(r"\{\{\s*(=.*?)\s*\}\}")


def interpolate_text(text: str, memory: JsonObject) -> str:
    """Sustituye ``{{ =expresión }}`` dentro de textos largos (prompts del nodo agent)."""

    def sub(match: re.Match[str]) -> str:
        try:
            out = resolve(match.group(1).strip(), memory)
        except ValueError:
            return match.group(0)
        if isinstance(out, str):
            return out
        return json.dumps(out, ensure_ascii=False)

    return _INTERPOLATE_RE.sub(sub, text)
