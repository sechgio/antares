from __future__ import annotations

from typing import Any


def box_css(x: str, y: str, width: str, height: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "--width": width,
        "--height": height,
        "--translate-x": x,
        "--translate-y": y,
        **(extra or {}),
    }


def canvas_layer(
    layer_id: str,
    kind: str,
    name: str,
    css_vars: dict[str, Any],
    *,
    value: Any = "",
    **extra: Any,
) -> dict[str, Any]:
    return {"id": layer_id, "type": kind, "name": name, "value": value, "cssVars": css_vars, **extra}
