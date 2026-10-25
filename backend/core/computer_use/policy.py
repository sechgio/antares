from __future__ import annotations

import re

READ_ONLY = "read_only"
ACT = "act"
ALWAYS_CONFIRM = "always_confirm"
HANDOFF = "handoff"

ACTIONS = frozenset({"click", "type_text", "press_key", "scroll", "drag", "set_value"})
PASSWORD_INPUT_ACTIONS = frozenset({"type_text", "set_value"})

_TOKEN_RE = re.compile(r"^[a-z0-9]+$")
_MAX_KEYS = 80
_MAX_COMBOS = 8
_MAX_COMBO_TOKENS = 4


class DriverRefused(ValueError):
    """La política de computer-use rechaza la acción; requiere intervención humana."""


def classify_action(action: str, *, target_password: bool = False, window_elevated: bool = False) -> dict:
    if action not in ACTIONS:
        raise ValueError(f"Acción no válida: {action}")
    if window_elevated:
        return {"category": HANDOFF, "reason": "La ventana pertenece a un proceso elevado; Windows bloquea la entrada simulada (UIPI). Pide al usuario que ejecute la acción."}
    if target_password and action in PASSWORD_INPUT_ACTIONS:
        return {"category": HANDOFF, "reason": "El objetivo es un campo de contraseña; escribir en él automatizadamente está prohibido. Pide al usuario que la ingrese."}
    return {"category": ACT, "reason": ""}


def classify_launch() -> dict:
    return {"category": ALWAYS_CONFIRM, "reason": "Abrir aplicaciones ejecuta código en la máquina; requiere confirmación explícita."}


def parse_keys(keys: object) -> list[list[str]]:
    text = keys if isinstance(keys, str) else ""
    text = text.strip().lower()
    if not text or len(text) > _MAX_KEYS:
        raise ValueError("Indica las teclas, por ejemplo «ctrl+s» o «enter»")
    combos: list[list[str]] = []
    for combo in text.split():
        tokens = [t for t in combo.split("+") if t]
        if not tokens or len(tokens) > _MAX_COMBO_TOKENS or any(not _TOKEN_RE.match(t) for t in tokens):
            raise ValueError(f"Combinación de teclas no válida: {combo}")
        combos.append(tokens)
    if len(combos) > _MAX_COMBOS:
        raise ValueError(f"Máximo {_MAX_COMBOS} combinaciones por llamada")
    return combos
