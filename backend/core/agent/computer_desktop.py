from __future__ import annotations

import ctypes
import json
import os
import subprocess
import sys
import threading
import time
from ctypes import wintypes
from functools import lru_cache
from pathlib import Path
from typing import Any

from backend.core.agent import computer_files
from backend.core.integrations.types import JsonObject

_SHOT_WIDTH = 1280
_SETTLE_S = 0.8
_MAX_WINDOWS = 20
_MAX_ELEMENTS = 160
_OBSERVATION_BUDGET = 5_000
_KEEP_SCREENS = 12
_UIA_TIMEOUT_S = 12

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

_ULONG_PTR = ctypes.c_size_t


class _MouseInput(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", _ULONG_PTR)]


class _KeybdInput(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", _ULONG_PTR)]


class _HardwareInput(ctypes.Structure):
    _fields_ = [("uMsg", wintypes.DWORD), ("wParamL", wintypes.WORD), ("wParamH", wintypes.WORD)]


class _InputUnion(ctypes.Union):
    _fields_ = [("mi", _MouseInput), ("ki", _KeybdInput), ("hi", _HardwareInput)]


class _Input(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("u", _InputUnion)]


_INPUT_MOUSE, _INPUT_KEYBOARD = 0, 1
_KEYUP, _UNICODE = 0x0002, 0x0004
_MOUSE_FLAGS = {"left": (0x0002, 0x0004), "right": (0x0008, 0x0010), "middle": (0x0020, 0x0040)}
_WHEEL = 0x0800
_VK = {
    "ctrl": 0x11, "control": 0x11, "shift": 0x10, "alt": 0x12, "win": 0x5B, "windows": 0x5B,
    "enter": 0x0D, "return": 0x0D, "tab": 0x09, "esc": 0x1B, "escape": 0x1B, "space": 0x20,
    "backspace": 0x08, "delete": 0x2E, "del": 0x2E, "insert": 0x2D, "home": 0x24, "end": 0x23,
    "pageup": 0x21, "pagedown": 0x22, "up": 0x26, "down": 0x28, "left": 0x25, "right": 0x27,
    "printscreen": 0x2C, "capslock": 0x14, "menu": 0x5D,
    **{f"f{n}": 0x6F + n for n in range(1, 13)},
}
_EXTENDED = {0x2E, 0x2D, 0x24, 0x23, 0x21, 0x22, 0x26, 0x28, 0x25, 0x27, 0x5B, 0x5D}
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


def _mouse(flags: int, data: int = 0) -> _Input:
    return _Input(type=_INPUT_MOUSE, u=_InputUnion(mi=_MouseInput(0, 0, data, flags, 0, 0)))


def _key(vk: int, up: bool = False) -> _Input:
    flags = (_KEYUP if up else 0) | (0x0001 if vk in _EXTENDED else 0)
    return _Input(type=_INPUT_KEYBOARD, u=_InputUnion(ki=_KeybdInput(vk, 0, flags, 0, 0)))


def _unicode(unit: int, up: bool = False) -> _Input:
    return _Input(type=_INPUT_KEYBOARD, u=_InputUnion(ki=_KeybdInput(0, unit, _UNICODE | (_KEYUP if up else 0), 0, 0)))


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


_UIA_SCRIPT = r"""
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]__HWND__)
$walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker
$out=New-Object System.Collections.ArrayList
$queue=New-Object System.Collections.Queue
$queue.Enqueue(@($root,0))
while($queue.Count -gt 0 -and $out.Count -lt __MAX__){
  $pair=$queue.Dequeue();$el=$pair[0];$depth=$pair[1]
  try{$c=$el.Current}catch{continue}
  $r=$c.BoundingRectangle
  if(-not $c.IsOffscreen -and $r.Width -gt 2 -and $r.Height -gt 2 -and -not [double]::IsInfinity($r.X)){
    $value=$null
    try{$vp=$el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern);$value=$vp.Current.Value}catch{}
    if($c.Name -or $value -or $c.ControlType.ProgrammaticName -match 'Edit|Button|MenuItem|ListItem|TabItem|CheckBox|ComboBox|Hyperlink|Document'){
      [void]$out.Add([ordered]@{n=$c.Name;t=$c.ControlType.ProgrammaticName.Replace('ControlType.','');x=[int]$r.X;y=[int]$r.Y;w=[int]$r.Width;h=[int]$r.Height;e=$c.IsEnabled;v=$value})
    }
  }
  if($depth -lt 14){
    $child=$walker.GetFirstChild($el)
    while($child -ne $null){$queue.Enqueue(@($child,($depth+1)));$child=$walker.GetNextSibling($child)}
  }
}
$rr=$root.Current.BoundingRectangle
ConvertTo-Json -InputObject ([ordered]@{root=[ordered]@{x=[int]$rr.X;y=[int]$rr.Y;w=[int]$rr.Width};items=@($out)}) -Depth 4 -Compress
"""


def _elements(window: JsonObject) -> list[JsonObject]:
    script = _UIA_SCRIPT.replace("__HWND__", str(int(window["_hwnd"]))).replace("__MAX__", str(_MAX_ELEMENTS))
    try:
        completed = subprocess.run(
            ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
            capture_output=True, timeout=_UIA_TIMEOUT_S, check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        raw = json.loads(completed.stdout.decode("utf-8", errors="replace") or "{}")
    except (subprocess.TimeoutExpired, ValueError, OSError):
        return []
    if not isinstance(raw, dict) or not isinstance(raw.get("root"), dict):
        return []
    root = raw["root"]
    scale = _scale()
    # UI Automation devuelve coordenadas lógicas cuando PowerShell no declara DPI;
    # el rectángulo de la ventana en ambos sistemas da la conversión a la captura.
    ratio = window["width"] * scale / max(1, int(root.get("w") or 0)) if root.get("w") else 1.0
    origin_x, origin_y = int(root.get("x") or 0), int(root.get("y") or 0)
    elements: list[JsonObject] = []
    for item in raw.get("items") or []:
        if not isinstance(item, dict):
            continue
        x, y, w, h = (int(item.get(k) or 0) for k in ("x", "y", "w", "h"))
        cx = window["x"] + ((x - origin_x) + w / 2) * ratio / scale
        cy = window["y"] + ((y - origin_y) + h / 2) * ratio / scale
        entry: JsonObject = {"name": str(item.get("n") or "")[:80], "type": str(item.get("t") or ""),
                             "center_x": int(cx), "center_y": int(cy)}
        if item.get("v"):
            entry["value"] = str(item["v"])[:200]
        if item.get("e") is False:
            entry["enabled"] = False
        elements.append(entry)
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


def type_text(params: JsonObject, root: Path) -> JsonObject:
    text = params.get("text")
    if not isinstance(text, str) or not text:
        raise ValueError("Indica el texto")
    if len(text) > 5_000:
        raise ValueError("El texto excede 5000 caracteres")
    for char in text.replace("\r\n", "\n"):
        if char == "\n":
            _send(_key(0x0D), _key(0x0D, up=True))
        elif char == "\t":
            _send(_key(0x09), _key(0x09, up=True))
        else:
            encoded = char.encode("utf-16-le")
            units = [int.from_bytes(encoded[i:i + 2], "little") for i in range(0, len(encoded), 2)]
            _send(*[_unicode(unit) for unit in units], *[_unicode(unit, up=True) for unit in units])
        time.sleep(0.004)
    return _settled(root, {"typed": len(text)})


def press(params: JsonObject, root: Path) -> JsonObject:
    keys = str(params.get("keys") or "").strip()
    if not keys:
        raise ValueError("Indica las teclas")
    for combo in keys.split():
        codes = [_vk_for(part) for part in combo.split("+") if part]
        _send(*[_key(code) for code in codes], *[_key(code, up=True) for code in reversed(codes)])
        time.sleep(0.12)
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


def run(name: str, params: JsonObject, root: Path) -> JsonObject:
    if name == "desktop_observe":
        return observe(root, params.get("elements") is not False)
    if name == "desktop_click":
        return click(params, root)
    if name == "desktop_type":
        return type_text(params, root)
    if name == "desktop_key":
        return press(params, root)
    if name == "desktop_scroll":
        return scroll(params, root)
    if name == "desktop_launch":
        return launch(params, root)
    if name == "desktop_focus":
        return focus(params, root)
    raise ValueError(f"Herramienta no disponible para el agente: {name}")
