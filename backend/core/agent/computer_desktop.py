from __future__ import annotations

import ctypes
import os
import sys
import threading
import time
from ctypes import wintypes
from functools import lru_cache
from pathlib import Path
from typing import Any

from backend.core.agent import computer_files
from backend.core.agent.cancel import RunCancelled, _CancelEvent
from backend.core.computer_use import driver, policy
from backend.core.computer_use import win32_input as _wxi
from backend.core.integrations.types import JsonObject

_SHOT_WIDTH = 1280
_SETTLE_S = 0.8
_MAX_WINDOWS = 20
_MAX_ELEMENTS = 160
_OBSERVATION_BUDGET = 5_000
_KEEP_SCREENS = 12
_UIA_TIMEOUT_S = 12
_DESKTOP_LOCK = threading.Lock()

_POINT = {"type": "integer", "description": "Coordenada en píxeles de la última captura de desktop_observe"}
TOOL_SPECS: list[JsonObject] = [
    {
        "name": "desktop_observe",
        "gated": True,
        "module": "computer",
        "description": (
            "Equipo · desktop_observe (efecto: requiere aprobación del usuario): captura la pantalla principal y "
            "devuelve las ventanas abiertas y los controles de la ventana activa con sus coordenadas"
        ),
        "inputSchema": {"type": "object", "properties": {
            "elements": {"type": "boolean", "description": "Incluir los controles de la ventana activa (por defecto sí)"},
        }},
    },
    {
        "name": "desktop_click",
        "gated": True,
        "module": "computer",
        "description": (
            "Equipo · desktop_click (efecto: requiere aprobación del usuario): hace clic en un punto de la pantalla "
            "y devuelve una captura nueva"
        ),
        "inputSchema": {"type": "object", "properties": {
            "x": _POINT, "y": _POINT,
            "button": {"type": "string", "enum": ["left", "right", "middle"]},
            "double": {"type": "boolean", "description": "Doble clic"},
        }, "required": ["x", "y"]},
    },
    {
        "name": "desktop_type",
        "gated": True,
        "module": "computer",
        "description": (
            "Equipo · desktop_type (efecto: requiere aprobación del usuario): escribe texto en el control con foco "
            "y devuelve una captura nueva"
        ),
        "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
    },
    {
        "name": "desktop_key",
        "gated": True,
        "module": "computer",
        "description": (
            "Equipo · desktop_key (efecto: requiere aprobación del usuario): pulsa teclas o atajos separados por "
            "espacios, p. ej. «ctrl+s», «enter», «alt+f4 tab»"
        ),
        "inputSchema": {"type": "object", "properties": {"keys": {"type": "string"}}, "required": ["keys"]},
    },
    {
        "name": "desktop_scroll",
        "gated": True,
        "module": "computer",
        "description": (
            "Equipo · desktop_scroll (efecto: requiere aprobación del usuario): desplaza la rueda en un punto; "
            "amount positivo sube y negativo baja"
        ),
        "inputSchema": {"type": "object", "properties": {
            "x": _POINT, "y": _POINT, "amount": {"type": "integer", "minimum": -20, "maximum": 20},
        }, "required": ["x", "y", "amount"]},
    },
    {
        "name": "desktop_launch",
        "gated": True,
        "module": "computer",
        "description": (
            "Equipo · desktop_launch (efecto: requiere aprobación del usuario): abre una aplicación de Windows, un "
            "archivo autorizado o una carpeta (p. ej. notepad, calc, explorer) y devuelve una captura"
        ),
        "inputSchema": {"type": "object", "properties": {
            "target": {"type": "string", "description": "Programa, archivo o carpeta"},
            "args": {"type": "string", "description": "Argumentos de la línea de comandos"},
        }, "required": ["target"]},
    },
    {
        "name": "desktop_focus",
        "gated": True,
        "module": "computer",
        "description": (
            "Equipo · desktop_focus (efecto: requiere aprobación del usuario): trae al frente la ventana cuyo "
            "título contiene el texto indicado y devuelve una captura"
        ),
        "inputSchema": {"type": "object", "properties": {"title": {"type": "string"}}, "required": ["title"]},
    },
]

_Input = _wxi.Input
_InputUnion = _wxi.InputUnion
_INPUT_MOUSE, _INPUT_KEYBOARD = _wxi.INPUT_MOUSE, _wxi.INPUT_KEYBOARD
_KEYUP, _UNICODE = _wxi.KEYUP, _wxi.UNICODE
_MOUSE_FLAGS = _wxi.MOUSE_FLAGS
_WHEEL = _wxi.WHEEL
_VK = _wxi.VK
_EXTENDED = _wxi.EXTENDED
_mouse = _wxi.mouse
_key = _wxi.key
_unicode = _wxi.unicode_input
_dpi_lock = threading.Lock()
_dpi_ready = False


@lru_cache(maxsize=1)
def _user32() -> Any:
    if sys.platform != "win32":
        raise ValueError("El control del escritorio solo está disponible en Windows")
    return ctypes.WinDLL("user32", use_last_error=True)


def _ensure_dpi() -> None:
    global _dpi_ready
    with _dpi_lock:
        if _dpi_ready:
            return
        try:
            ctypes.WinDLL("shcore").SetProcessDpiAwareness(2)
        except (OSError, AttributeError):
            _user32().SetProcessDPIAware()
        _dpi_ready = True


def _screen() -> tuple[int, int]:
    _ensure_dpi()
    user32 = _user32()
    return int(user32.GetSystemMetrics(0)), int(user32.GetSystemMetrics(1))


def _scale() -> float:
    width, _ = _screen()
    return max(1.0, width / _SHOT_WIDTH)


def _physical(value: object, label: str) -> int:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"Indica la coordenada {label}")
    return round(float(value) * _scale())


def _send(*inputs: _Input) -> None:
    array = (_Input * len(inputs))(*inputs)
    if _user32().SendInput(len(inputs), array, ctypes.sizeof(_Input)) != len(inputs):
        raise ValueError("Windows bloqueó la entrada simulada (¿hay una ventana de administrador en primer plano?)")


def _vk_for(name: str) -> int:
    key = name.strip().lower()
    if key in _VK:
        return _VK[key]
    if len(key) == 1 and (key.isalnum()):
        return ord(key.upper())
    raise ValueError(f"Tecla desconocida: {name}")


def _window_title(user32: Any, hwnd: int) -> str:
    length = user32.GetWindowTextLengthW(hwnd)
    buffer = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buffer, length + 1)
    return buffer.value


def _windows() -> list[JsonObject]:
    user32 = _user32()
    scale = _scale()
    foreground = user32.GetForegroundWindow()
    found: list[JsonObject] = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def visit(hwnd: int, _param: int) -> bool:
        if not user32.IsWindowVisible(hwnd):
            return True
        title = _window_title(user32, hwnd)
        rect = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        if not title or rect.right - rect.left < 40 or rect.bottom - rect.top < 30:
            return True
        found.append({"title": title[:120], "minimized": bool(user32.IsIconic(hwnd)), "active": hwnd == foreground,
                      "x": int(rect.left / scale), "y": int(rect.top / scale),
                      "width": int((rect.right - rect.left) / scale), "height": int((rect.bottom - rect.top) / scale),
                      "_hwnd": int(hwnd)})
        return len(found) < _MAX_WINDOWS

    user32.EnumWindows(visit, 0)
    return found


_INTERACTIVE_TOKENS = ("edit", "button", "menuitem", "listitem", "tabitem", "checkbox", "combobox", "hyperlink", "document")


def _elements(window: JsonObject) -> list[JsonObject]:
    """Controles de la ventana activa leídos en proceso con UIA cacheado.

    Antes se lanzaba un powershell.exe por observación (cientos de ms en el mejor
    caso, varios segundos en ventanas complejas); el recorrido cacheado en el
    worker del driver devuelve el mismo resultado en una fracción del tiempo.
    """
    hwnd = int(window["_hwnd"])

    def walk() -> tuple[list[JsonObject], dict[str, str]]:
        from pywinauto.uia_defines import IUIA

        elements, _raws, _truncated = driver._walk_elements(hwnd, driver._MAX_ELEMENTS_CAP, _UIA_TIMEOUT_S, control_view=True)
        canonical = {str(control_type).lower(): str(control_type) for control_type in IUIA().known_control_type_ids.values()}
        return elements, canonical

    try:
        entries, canonical = driver._run_on_worker(walk, _UIA_TIMEOUT_S)
    except Exception:
        return []
    scale = _scale()
    elements: list[JsonObject] = []
    for entry in entries:
        left, top, width, height = (int(v) for v in entry["rect"])
        role = str(entry.get("role") or "")
        value = str(entry["value"])[:200] if entry.get("value") else ""
        name = str(entry.get("name") or "")[:80]
        if not name and not value and not any(token in role for token in _INTERACTIVE_TOKENS):
            continue
        item: JsonObject = {
            "name": name,
            "type": canonical.get(role, role),
            "center_x": int((left + width / 2) / scale),
            "center_y": int((top + height / 2) / scale),
        }
        if value:
            item["value"] = value
        if entry.get("enabled") is False:
            item["enabled"] = False
        elements.append(item)
        if len(elements) >= _MAX_ELEMENTS:
            break
    return elements


def _screens_dir(root: Path) -> Path:
    folder = root.parent / f"{root.name}.screens"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _capture(root: Path) -> JsonObject:
    from PIL import ImageGrab

    _ensure_dpi()
    image = ImageGrab.grab(all_screens=False)
    width, height = image.size
    scale = max(1.0, width / _SHOT_WIDTH)
    shot = image.convert("RGB").resize((int(width / scale), int(height / scale))) if scale > 1 else image.convert("RGB")
    folder = _screens_dir(root)
    target = folder / f"{time.time_ns()}.jpg"
    shot.save(target, "JPEG", quality=70, optimize=True)
    for old in sorted(folder.glob("*.jpg"))[:-_KEEP_SCREENS]:
        old.unlink(missing_ok=True)
    return {"path": str(target), "mime": "image/jpeg", "width": shot.width, "height": shot.height}


def observe(root: Path, elements: bool = True) -> JsonObject:
    windows = _windows()
    active = next((w for w in windows if w["active"]), None)
    shot = _capture(root)
    result: JsonObject = {
        "screen": {"width": shot["width"], "height": shot["height"]},
        "image": {"path": shot["path"], "mime": shot["mime"]},
        "active_window": active["title"] if active else None,
        "windows": [f"{w['title']}{' (minimizada)' if w['minimized'] else ''}" for w in windows],
        "note": "Coordenadas en píxeles de la captura adjunta; úsalas tal cual en desktop_click/desktop_scroll.",
    }
    if elements and active:
        result["controls_summary"] = "\n".join(
            f"{c['type']} «{c['name']}» ({c['center_x']},{c['center_y']})" + (f" = {c['value']}" if c.get("value") else "")
            for c in _elements(active)
        )
    return computer_files.fit(result, _OBSERVATION_BUDGET)


def _settled(root: Path, action: JsonObject) -> JsonObject:
    time.sleep(_SETTLE_S)
    return {**action, "observation": observe(root)}


def click(params: JsonObject, root: Path) -> JsonObject:
    x, y = _physical(params.get("x"), "x"), _physical(params.get("y"), "y")
    button = str(params.get("button") or "left")
    if button not in _MOUSE_FLAGS:
        raise ValueError("Botón no válido")
    down, up = _MOUSE_FLAGS[button]
    _ensure_dpi()
    _user32().SetCursorPos(x, y)
    time.sleep(0.05)
    for _ in range(2 if params.get("double") is True else 1):
        _send(_mouse(down), _mouse(up))
        time.sleep(0.06)
    return _settled(root, {"clicked": {"x": params["x"], "y": params["y"], "button": button}})


def type_text(params: JsonObject, root: Path, token: _CancelEvent | None = None) -> JsonObject:
    text = params.get("text")
    if not isinstance(text, str) or not text:
        raise ValueError("Indica el texto")
    if len(text) > 5_000:
        raise ValueError("El texto excede 5000 caracteres")
    if driver.focused_is_password():
        raise policy.DriverRefused(policy.classify_action("type_text", target_password=True)["reason"])
    for char in text.replace("\r\n", "\n"):
        if token is not None and token.cancelled:
            raise RunCancelled()
        if char == "\n":
            _send(_key(0x0D), _key(0x0D, up=True))
        elif char == "\t":
            _send(_key(0x09), _key(0x09, up=True))
        else:
            encoded = char.encode("utf-16-le")
            units = [int.from_bytes(encoded[i:i + 2], "little") for i in range(0, len(encoded), 2)]
            _send(*[_unicode(unit) for unit in units], *[_unicode(unit, up=True) for unit in units])
        time.sleep(0.004)
    if token is not None and token.cancelled:
        raise RunCancelled()
    return _settled(root, {"typed": len(text)})


def press(params: JsonObject, root: Path, token: _CancelEvent | None = None) -> JsonObject:
    keys = str(params.get("keys") or "").strip()
    if not keys:
        raise ValueError("Indica las teclas")
    shortcuts = [[_vk_for(part) for part in combo.split("+") if part] for combo in keys.split()]
    if any(not codes for codes in shortcuts):
        raise ValueError("Indica las teclas")
    for codes in shortcuts:
        if token is not None and token.cancelled:
            raise RunCancelled()
        _send(*[_key(code) for code in codes], *[_key(code, up=True) for code in reversed(codes)])
        time.sleep(0.12)
    if token is not None and token.cancelled:
        raise RunCancelled()
    return _settled(root, {"pressed": keys})


def scroll(params: JsonObject, root: Path) -> JsonObject:
    x, y = _physical(params.get("x"), "x"), _physical(params.get("y"), "y")
    amount = params.get("amount")
    if not isinstance(amount, int) or isinstance(amount, bool) or not amount:
        raise ValueError("Indica cuánto desplazar")
    _user32().SetCursorPos(x, y)
    _send(_mouse(_WHEEL, ctypes.c_uint32(max(-20, min(20, amount)) * 120).value))
    return _settled(root, {"scrolled": amount})


def launch(params: JsonObject, root: Path) -> JsonObject:
    target = params.get("target")
    if not isinstance(target, str) or not target.strip() or "\x00" in target:
        raise ValueError("Indica qué abrir")
    args = params.get("args")
    if args is not None and not isinstance(args, str):
        raise ValueError("Los argumentos deben ser un texto")
    if not hasattr(os, "startfile"):
        raise ValueError("Abrir aplicaciones solo está disponible en Windows")
    os.startfile(target.strip(), arguments=args or "", cwd=str(root))
    time.sleep(1.2)
    return _settled(root, {"launched": target.strip()})


def focus(params: JsonObject, root: Path) -> JsonObject:
    wanted = str(params.get("title") or "").strip().casefold()
    if not wanted:
        raise ValueError("Indica el título de la ventana")
    match = next((w for w in _windows() if wanted in str(w["title"]).casefold()), None)
    if match is None:
        raise ValueError("No hay ninguna ventana visible con ese título")
    user32 = _user32()
    hwnd = int(match["_hwnd"])
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, 9)
    _send(_key(0x12), _key(0x12, up=True))
    user32.SetForegroundWindow(hwnd)
    return _settled(root, {"focused": match["title"]})


def run(name: str, params: JsonObject, root: Path, token: _CancelEvent | None = None) -> JsonObject:
    while not _DESKTOP_LOCK.acquire(timeout=0.1):
        if token is not None and token.cancelled:
            raise RunCancelled()
    try:
        if token is not None and token.cancelled:
            raise RunCancelled()
        if name == "desktop_observe":
            return observe(root, params.get("elements") is not False)
        if name == "desktop_click":
            return click(params, root)
        if name == "desktop_type":
            return type_text(params, root, token)
        if name == "desktop_key":
            return press(params, root, token)
        if name == "desktop_scroll":
            return scroll(params, root)
        if name == "desktop_launch":
            return launch(params, root)
        if name == "desktop_focus":
            return focus(params, root)
        raise ValueError(f"Herramienta no disponible para el agente: {name}")
    finally:
        _DESKTOP_LOCK.release()
