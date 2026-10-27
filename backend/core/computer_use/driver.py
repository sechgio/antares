from __future__ import annotations

import base64
import ctypes
import io
import os
import queue
import sys
import threading
import time
from collections.abc import Callable
from contextlib import suppress
from ctypes import wintypes
from typing import Any, cast

from backend.core.computer_use import input_guard, policy, targets
from backend.core.computer_use.policy import DriverRefused
from backend.core.computer_use.targets import DriverError
from backend.core.integrations.types import JsonObject

_MAX_ELEMENTS_DEFAULT = 300
_MAX_ELEMENTS_CAP = 800
_WALK_BUDGET_S = 8.0
_WALK_BUDGET_ACTION_S = 6.0
_MAX_TEXT = 5_000
# Por debajo de ~32 ms entre caracteres, el sistema coalesce los VK_PACKET de
# inyección unicode como repetición de una misma tecla y corrompe el texto en
# apps TSF (Notepad de Win11); 48 ms se validó perfecto en barrido empírico.
_TYPE_CHAR_DELAY_S = 0.048
_RawElements = dict[str, Any]  # allowlist
_ActionContext = dict[str, Any]  # allowlist
_SHOT_WIDTH = 1280
_JPEG_QUALITY = 70

UIA_ISPASSWORD = 30019
UIA_VALUEVALUE = 30045

_KNOWN_ALIASES: dict[str, str] = {
    "notepad": "notepad.exe",
    "calc": "calc.exe",
    "calculator": "calc.exe",
    "mspaint": "mspaint.exe",
    "paint": "mspaint.exe",
    "explorer": "explorer.exe",
    "cmd": "cmd.exe",
    "powershell": "powershell.exe",
    "control": "control.exe",
    "taskmgr": "taskmgr.exe",
}

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


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG), ("biHeight", wintypes.LONG),
        ("biPlanes", wintypes.WORD), ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
        ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", wintypes.LONG), ("biYPelsPerMeter", wintypes.LONG),
        ("biClrUsed", wintypes.DWORD), ("biClrImportant", wintypes.DWORD),
    ]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", wintypes.DWORD * 3)]


_INPUT_MOUSE, _INPUT_KEYBOARD = 0, 1
_KEYUP, _UNICODE = 0x0002, 0x0004
_MOUSE_DOWN, _MOUSE_UP = 0x0002, 0x0004
_MOUSE_FLAGS = {"left": (_MOUSE_DOWN, _MOUSE_UP), "right": (0x0008, 0x0010), "middle": (0x0020, 0x0040)}
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
_PW_RENDERFULLCONTENT = 0x00000002
_SW_RESTORE = 9

_CACHE = targets.TargetCache()
_GUARD = input_guard.InputGuard()
_ACTION_LEASE_LOCK = threading.Lock()
_worker_context = threading.local()


def _user32() -> Any:
    if sys.platform != "win32":
        raise DriverError("computer-use solo está disponible en Windows")
    return ctypes.WinDLL("user32", use_last_error=True)


def _ensure_dpi() -> None:
    global _dpi_ready
    with _dpi_lock:
        if _dpi_ready:
            return
        with suppress(OSError, AttributeError):
            ctypes.WinDLL("shcore").SetProcessDpiAwareness(2)
        if not _user32().IsProcessDPIAware():
            with suppress(OSError, AttributeError):
                _user32().SetProcessDPIAware()
        _dpi_ready = True


def _check_worker_active() -> None:
    cancelled = getattr(_worker_context, "cancelled", None)
    if cancelled is not None and cancelled.is_set():
        raise DriverError("computer-use: la operación excedió el tiempo límite")


def _check_action_active() -> None:
    _check_worker_active()
    if _GUARD.broken:
        raise DriverRefused(input_guard.LEASE_MESSAGE)


def _send(*inputs: _Input, _release: bool = False) -> None:
    if not _release:
        _check_action_active()
    array = (_Input * len(inputs))(*inputs)
    if _user32().SendInput(len(inputs), array, ctypes.sizeof(_Input)) != len(inputs):
        raise DriverError("Windows bloqueó la entrada simulada (¿hay una ventana de administrador en primer plano?)")


def _mouse(flags: int, data: int = 0) -> _Input:
    return _Input(type=_INPUT_MOUSE, u=_InputUnion(mi=_MouseInput(0, 0, data, flags, 0, 0)))


def _key(vk: int, up: bool = False) -> _Input:
    flags = (_KEYUP if up else 0) | (0x0001 if vk in _EXTENDED else 0)
    return _Input(type=_INPUT_KEYBOARD, u=_InputUnion(ki=_KeybdInput(vk, 0, flags, 0, 0)))


def _unicode(unit: int, up: bool = False) -> _Input:
    return _Input(type=_INPUT_KEYBOARD, u=_InputUnion(ki=_KeybdInput(0, unit, _UNICODE | (_KEYUP if up else 0), 0, 0)))


def _vk_for(name: str) -> int:
    if name in _VK:
        return _VK[name]
    if len(name) == 1 and name.isalnum():
        return ord(name.upper())
    raise ValueError(f"Tecla desconocida: {name}")


_worker_lock = threading.Lock()
_worker_thread: threading.Thread | None = None
_worker_queue: queue.Queue = queue.Queue()


def _worker_loop() -> None:
    try:
        import comtypes

        comtypes.CoInitialize()
    except Exception:
        pass
    while True:
        fn, box = _worker_queue.get()
        try:
            _worker_context.cancelled = box["cancelled"]
            if box["cancelled"].is_set():
                raise DriverError("computer-use: la operación excedió el tiempo límite")
            box["result"] = fn()
        except BaseException as exc:
            box["error"] = exc
        finally:
            del _worker_context.cancelled
            box["done"].set()


def _run_on_worker(fn: Callable[[], Any], timeout: float) -> Any:
    global _worker_thread
    with _worker_lock:
        if _worker_thread is None or not _worker_thread.is_alive():
            _worker_thread = threading.Thread(target=_worker_loop, name="computer-use-driver", daemon=True)
            _worker_thread.start()
    box: dict[str, Any] = {"done": threading.Event(), "cancelled": threading.Event(), "result": None, "error": None}  # allowlist
    _worker_queue.put((fn, box))
    if not box["done"].wait(timeout):
        box["cancelled"].set()
        raise DriverError("computer-use: la operación excedió el tiempo límite")
    if box["error"] is not None:
        raise box["error"]
    return box["result"]


def _process_name(pid: int) -> str:
    k32 = ctypes.windll.kernel32
    h = k32.OpenProcess(0x1000, False, pid)
    if not h:
        return "?"
    try:
        size = ctypes.c_ulong(260)
        buf = ctypes.create_unicode_buffer(260)
        if not k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
            return "?"
        return buf.value.replace("\\", "/").rsplit("/", 1)[-1].lower()
    finally:
        k32.CloseHandle(h)


def _process_elevated(pid: int) -> bool:
    k32 = ctypes.windll.kernel32
    h = k32.OpenProcess(0x0400, False, pid)
    if not h:
        return True
    k32.CloseHandle(h)
    return False


def _window_title(hwnd: int) -> str:
    user32 = _user32()
    length = user32.GetWindowTextLengthW(hwnd)
    buffer = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buffer, length + 1)
    return buffer.value


def _window_rect(hwnd: int) -> list[int]:
    rect = wintypes.RECT()
    if not _user32().GetWindowRect(hwnd, ctypes.byref(rect)):
        raise DriverError("No se pudo leer el rectángulo de la ventana")
    return [int(rect.left), int(rect.top), int(rect.right - rect.left), int(rect.bottom - rect.top)]


def _enumerate_on_worker() -> list[JsonObject]:
    _ensure_dpi()
    user32 = _user32()
    foreground = user32.GetForegroundWindow()
    hwnds: list[int] = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def visit(hwnd: int, _param: int) -> bool:
        if not user32.IsWindowVisible(hwnd):
            return True
        if not _window_title(hwnd):
            return True
        rect = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        if rect.right - rect.left < 40 or rect.bottom - rect.top < 30:
            return True
        if user32.GetWindowLongW(hwnd, -8) != 0:
            return True
        hwnds.append(int(hwnd))
        return len(hwnds) < 40

    user32.EnumWindows(visit, 0)
    windows: list[JsonObject] = []
    for hwnd in hwnds:
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        pid_value = int(pid.value)
        windows.append({
            "window_id": f"w{hwnd:x}",
            "title": _window_title(hwnd)[:120],
            "pid": pid_value,
            "process": _process_name(pid_value),
            "rect": _window_rect(hwnd),
            "minimized": bool(user32.IsIconic(hwnd)),
            "active": hwnd == foreground,
            "elevated": _process_elevated(pid_value),
        })
    return windows


def enumerate_windows() -> JsonObject:
    windows = cast(list[JsonObject], _run_on_worker(_enumerate_on_worker, 15.0))
    generation = _CACHE.remember_windows(windows)
    return {"generation": generation, "windows": windows}


def _entry_from_info(info: Any) -> JsonObject | None:
    try:
        rect = info.rectangle
        rt = info.runtime_id
    except Exception:
        return None
    if not rt:
        return None
    raw = info._element
    try:
        is_password = bool(raw.GetCurrentPropertyValue(UIA_ISPASSWORD))
    except Exception:
        is_password = False
    try:
        raw_value = raw.GetCurrentPropertyValue(UIA_VALUEVALUE)
    except Exception:
        raw_value = None
    left, top = int(rect.left), int(rect.top)
    width, height = int(rect.right) - left, int(rect.bottom) - top
    entry: JsonObject = {
        "runtime_id": ",".join(str(v) for v in rt),
        "role": str(info.control_type or "").lower() or "unknown",
        "name": str(info.name or "")[:80],
        "automation_id": str(info.automation_id or "")[:120] or None,
        "rect": [left, top, width, height],
        "center": [left + width // 2, top + height // 2],
        "enabled": info.enabled is not False,
        "is_password": is_password,
    }
    if raw_value is not None and not isinstance(raw_value, bool):
        entry["value"] = str(raw_value)[:200]
    return entry


def _walk_elements(hwnd: int, max_nodes: int, budget_s: float) -> tuple[list[JsonObject], _RawElements, bool]:
    from pywinauto.uia_element_info import UIAElementInfo

    out: list[JsonObject] = []
    raws: _RawElements = {}
    pending = [UIAElementInfo(int(hwnd))]
    deadline = time.monotonic() + budget_s
    while pending and len(out) < max_nodes and time.monotonic() < deadline:
        info = pending.pop(0)
        entry = _entry_from_info(info)
        if entry is None:
            continue
        raws[entry["runtime_id"]] = info._element
        out.append(entry)
        try:
            pending.extend(info.children())
        except Exception:
            continue
    truncated = bool(pending) or len(out) >= max_nodes
    for index, entry in enumerate(out):
        entry["element_id"] = f"e{index}"
    return out, raws, truncated


def _screenshot_on_worker(hwnd: int) -> JsonObject | None:
    _ensure_dpi()
    user32 = _user32()
    gdi32 = ctypes.windll.gdi32
    width, height = (lambda r: (r[2], r[3]))(_window_rect(hwnd))
    if width <= 0 or height <= 0:
        return None
    hdc_win = user32.GetWindowDC(hwnd)
    hdc_mem = gdi32.CreateCompatibleDC(hdc_win)
    hbmp = gdi32.CreateCompatibleBitmap(hdc_win, width, height)
    gdi32.SelectObject(hdc_mem, hbmp)
    try:
        if not user32.PrintWindow(hwnd, hdc_mem, _PW_RENDERFULLCONTENT):
            return None
        bmi = BITMAPINFO()
        bmi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        bmi.bmiHeader.biWidth = width
        bmi.bmiHeader.biHeight = -height
        bmi.bmiHeader.biPlanes = 1
        bmi.bmiHeader.biBitCount = 32
        buf = ctypes.create_string_buffer(width * height * 4)
        gdi32.GetDIBits(hdc_mem, hbmp, 0, height, buf, ctypes.byref(bmi), 0)
        from PIL import Image

        image = Image.frombuffer("RGB", (width, height), buf.raw, "raw", "BGRX", 0, 1)
    finally:
        gdi32.DeleteObject(hbmp)
        gdi32.DeleteDC(hdc_mem)
        user32.ReleaseDC(hwnd, hdc_win)
    if image.width > _SHOT_WIDTH:
        ratio = _SHOT_WIDTH / image.width
        image = image.resize((_SHOT_WIDTH, max(1, round(image.height * ratio))))
    shot = io.BytesIO()
    image.convert("RGB").save(shot, "JPEG", quality=_JPEG_QUALITY, optimize=True)
    return {"image_b64": base64.b64encode(shot.getvalue()).decode("ascii"), "mime": "image/jpeg",
            "width": image.width, "height": image.height}


def _window_alive(hwnd: int) -> bool:
    return bool(_user32().IsWindow(wintypes.HWND(hwnd)))


def _ensure_foreground(hwnd: int) -> None:
    _check_action_active()
    user32 = _user32()
    if user32.GetForegroundWindow() == hwnd:
        return
    _send(_key(0x12), _key(0x12, up=True))  # Alt: habilita robar el foco desde un proceso de fondo
    _check_action_active()
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.08)


def _prepare_window(window: JsonObject) -> int:
    _ensure_dpi()
    user32 = _user32()
    hwnd = int(str(window["window_id"])[1:], 16)
    if not _window_alive(hwnd):
        raise DriverError(f"La ventana «{window.get('title')}» ya no existe. Vuelve a llamar computer_use_enumerate.")
    if user32.IsIconic(hwnd):
        _check_action_active()
        user32.ShowWindow(hwnd, _SW_RESTORE)
        time.sleep(0.4)
    return hwnd


def _set_focus(raw: Any) -> None:
    _check_action_active()
    try:
        raw.SetFocus()
        time.sleep(0.08)
    except Exception as exc:
        raise DriverError(f"No se pudo enfocar el elemento: {exc}") from exc


def _ensure_element_focus(ctx: _ActionContext, target: JsonObject) -> None:
    _check_action_active()
    raw = ctx["raws"].get(str(target["runtime_id"]))
    if raw is None:
        raise DriverError("Elemento obsoleto; reintenta la observación")
    try:
        from pywinauto.uia_defines import IUIA

        focused = IUIA().iuia.GetFocusedElement()
        if focused is not None and tuple(int(v) for v in focused.GetRuntimeId()) == tuple(
            int(v) for v in raw.GetRuntimeId()
        ):
            return  # ya enfocado: re-enfocar resetea el contexto TSF y corrompe la entrada
    except Exception:
        pass
    _set_focus(raw)


def focused_is_password() -> bool:
    """Si el control con el foco del teclado es un campo de contraseña; desktop_type escribe ahí sin elemento."""
    def run() -> bool:
        try:
            from pywinauto.uia_defines import IUIA

            focused = IUIA().iuia.GetFocusedElement()
            return focused is not None and bool(focused.GetCurrentPropertyValue(UIA_ISPASSWORD))
        except Exception:
            return False

    return bool(_run_on_worker(run, 5.0))


def perform_action(window_id: str, action: str, element_id: str | None, params: JsonObject) -> JsonObject:
    if action not in policy.ACTIONS:
        raise ValueError(f"Acción no válida: {action}")
    window = _CACHE.window(window_id)
    cached_password = bool(_CACHE.element(window_id, element_id).get("is_password")) if element_id else False
    classification = policy.classify_action(
        action, target_password=cached_password, window_elevated=bool(window.get("elevated"))
    )
    if classification["category"] == policy.HANDOFF:
        raise DriverRefused(classification["reason"])

    def run() -> JsonObject:
        _check_action_active()
        hwnd = _prepare_window(window)
        elements, raws, _ = _walk_elements(hwnd, _MAX_ELEMENTS_CAP, _WALK_BUDGET_ACTION_S)
        by_runtime = {str(e["runtime_id"]): e for e in elements}
        target = _CACHE.check_element(window_id, element_id, by_runtime) if element_id else None
        current_policy = policy.classify_action(
            action, target_password=bool(target and target.get("is_password")), window_elevated=bool(window.get("elevated"))
        )
        if current_policy["category"] == policy.HANDOFF:
            raise DriverRefused(current_policy["reason"])
        ctx = {"window_id": window_id, "by_runtime": by_runtime, "raws": raws, "window_rect": _window_rect(hwnd)}
        _check_action_active()
        result = _ACTION_IMPL[action](hwnd, target, element_id, params, ctx)
        return {"action": action, "performed": True, "policy": current_policy, "window_rect": ctx["window_rect"], **result}

    with _ACTION_LEASE_LOCK:
        _GUARD.begin()
        try:
            outcome = cast(JsonObject, _run_on_worker(run, 25.0))
        finally:
            _GUARD.end()
    if _GUARD.broken:
        raise DriverRefused(input_guard.LEASE_MESSAGE)
    return outcome


def _center(entry: JsonObject, window_rect: list[int]) -> tuple[int, int]:
    cx, cy = int(entry["center"][0]), int(entry["center"][1])
    wx, wy, ww, wh = window_rect
    if not (wx <= cx < wx + ww and wy <= cy < wy + wh):
        raise DriverError("El elemento está fuera del área visible de la ventana")
    return cx, cy


def _act_click(hwnd: int, target: JsonObject | None, element_id: str | None, params: JsonObject, ctx: _ActionContext) -> JsonObject:
    if target is None:
        raise ValueError("Indica el elemento a cliquear")
    button = str(params.get("button") or "left")
    if button not in _MOUSE_FLAGS:
        raise ValueError("Botón no válido")
    down, up = _MOUSE_FLAGS[button]
    cx, cy = _center(target, ctx["window_rect"])
    _ensure_foreground(hwnd)
    _check_action_active()
    _user32().SetCursorPos(cx, cy)
    time.sleep(0.05)
    for _ in range(2 if params.get("double") is True else 1):
        _send(_mouse(down), _mouse(up))
        time.sleep(0.06)
    return {"clicked": {"x": cx, "y": cy, "button": button}}


def _act_type_text(hwnd: int, target: JsonObject | None, element_id: str | None, params: JsonObject, ctx: _ActionContext) -> JsonObject:
    text = params.get("text")
    if not isinstance(text, str) or not text:
        raise ValueError("Indica el texto")
    if len(text) > _MAX_TEXT:
        raise ValueError(f"El texto excede {_MAX_TEXT} caracteres")
    if target is None:
        raise ValueError("Indica el elemento destino del texto")
    _ensure_element_focus(ctx, target)
    sent = 0
    for char in text.replace("\r\n", "\n"):
        _check_action_active()
        if char == "\n":
            _send(_key(0x0D), _key(0x0D, up=True))
        elif char == "\t":
            _send(_key(0x09), _key(0x09, up=True))
        else:
            encoded = char.encode("utf-16-le")
            units = [int.from_bytes(encoded[i:i + 2], "little") for i in range(0, len(encoded), 2)]
            _send(*[_unicode(unit) for unit in units], *[_unicode(unit, up=True) for unit in units])
        sent += 1
        time.sleep(_TYPE_CHAR_DELAY_S)
    return {"typed": sent}


def _act_press_key(hwnd: int, target: JsonObject | None, element_id: str | None, params: JsonObject, ctx: _ActionContext) -> JsonObject:
    combos = policy.parse_keys(params.get("keys"))
    if target is not None:
        _ensure_element_focus(ctx, target)
    else:
        _ensure_foreground(hwnd)
    for combo in combos:
        _check_action_active()
        codes = [_vk_for(t) for t in combo]
        _send(*[_key(c) for c in codes], *[_key(c, up=True) for c in reversed(codes)])
        time.sleep(0.12)
    return {"pressed": " ".join("+".join(c) for c in combos)}


def _act_scroll(hwnd: int, target: JsonObject | None, element_id: str | None, params: JsonObject, ctx: _ActionContext) -> JsonObject:
    amount = params.get("amount")
    if not isinstance(amount, int) or isinstance(amount, bool) or not amount:
        raise ValueError("Indica cuánto desplazar")
    amount = max(-20, min(20, amount))
    if target is not None:
        cx, cy = _center(target, ctx["window_rect"])
    else:
        wx, wy, ww, wh = ctx["window_rect"]
        cx, cy = wx + ww // 2, wy + wh // 2
    _ensure_foreground(hwnd)
    _check_action_active()
    _user32().SetCursorPos(cx, cy)
    time.sleep(0.05)
    _send(_mouse(_WHEEL, ctypes.c_uint32(amount * 120).value))
    return {"scrolled": amount}


def _act_drag(hwnd: int, target: JsonObject | None, element_id: str | None, params: JsonObject, ctx: _ActionContext) -> JsonObject:
    if target is None:
        raise ValueError("Indica el elemento origen del arrastre")
    to_element = params.get("to_element_id")
    to_x, to_y = params.get("to_x"), params.get("to_y")
    if to_element is not None:
        destination = ctx["by_runtime"].get(str(_CACHE.element(ctx["window_id"], str(to_element))["runtime_id"]))
        if destination is None:
            raise DriverError("El elemento destino está obsoleto; reintenta la observación")
        dx, dy = _center(destination, ctx["window_rect"])
    elif isinstance(to_x, (int, float)) and isinstance(to_y, (int, float)) and not isinstance(to_x, bool):
        dx, dy = int(to_x), int(to_y)
    else:
        raise ValueError("Indica to_element_id o to_x/to_y")
    sx, sy = _center(target, ctx["window_rect"])
    _ensure_foreground(hwnd)
    _check_action_active()
    _user32().SetCursorPos(sx, sy)
    time.sleep(0.05)
    _send(_mouse(_MOUSE_DOWN))
    steps = 12
    try:
        for step in range(1, steps + 1):
            _check_action_active()
            _user32().SetCursorPos(sx + (dx - sx) * step // steps, sy + (dy - sy) * step // steps)
            time.sleep(0.015)
    finally:
        _send(_mouse(_MOUSE_UP), _release=True)
    return {"dragged": {"from": [sx, sy], "to": [dx, dy]}}


def _act_set_value(hwnd: int, target: JsonObject | None, element_id: str | None, params: JsonObject, ctx: _ActionContext) -> JsonObject:
    _check_action_active()
    value = params.get("value")
    if not isinstance(value, str):
        raise ValueError("Indica el valor de texto a establecer")
    if target is None:
        raise ValueError("Indica el elemento destino")
    if len(value) > _MAX_TEXT:
        raise ValueError(f"El valor excede {_MAX_TEXT} caracteres")
    raw = ctx["raws"].get(str(target["runtime_id"]))
    if raw is None:
        raise DriverError("Elemento obsoleto; reintenta la observación")
    import comtypes.gen.UIAutomationClient as uia_client

    pattern = raw.GetCurrentPattern(uia_client.UIA_ValuePatternId)
    if not pattern:
        raise DriverError("El elemento no admite el patrón Value; usa click + type_text")
    value_pattern = pattern.QueryInterface(uia_client.IUIAutomationValuePattern)
    _check_action_active()
    value_pattern.SetValue(value)
    return {"set_value": len(value)}


_ACTION_IMPL = {
    "click": _act_click,
    "type_text": _act_type_text,
    "press_key": _act_press_key,
    "scroll": _act_scroll,
    "drag": _act_drag,
    "set_value": _act_set_value,
}


def window_state(window_id: str, screenshot: bool = False, max_elements: int = _MAX_ELEMENTS_DEFAULT) -> JsonObject:
    window = _CACHE.window(window_id)
    hwnd = int(str(window["window_id"])[1:], 16)
    if not _window_alive(hwnd):
        raise DriverError(f"La ventana «{window.get('title')}» ya no existe. Vuelve a llamar computer_use_enumerate.")
    max_elements = max(1, min(int(max_elements), _MAX_ELEMENTS_CAP))

    def run() -> JsonObject:
        _ensure_dpi()
        user32 = _user32()
        was_minimized = bool(user32.IsIconic(hwnd))
        if was_minimized:
            user32.ShowWindow(hwnd, _SW_RESTORE)
            time.sleep(0.4)
        elements, _raws, truncated = _walk_elements(hwnd, max_elements, _WALK_BUDGET_S)
        _CACHE.remember_elements(window_id, _CACHE.generation, elements)
        result: JsonObject = {
            "window": {**window, "minimized": False, "was_minimized": was_minimized},
            "generation": _CACHE.generation,
            "elements": elements,
            "truncated": truncated,
            "note": "Usa element_id en computer_use_action; tras cualquier acción vuelve a observar. "
                    "Si el árbol viene vacío y el proceso es Chromium/Electron, la ventana no expuso accesibilidad "
                    "(relánzala con --force-renderer-accessibility).",
        }
        if screenshot:
            result["screenshot"] = _screenshot_on_worker(hwnd)
        return result

    return cast(JsonObject, _run_on_worker(run, 25.0))


def normalize_app(name: str) -> str:
    lowered = str(name or "").strip().lower()
    return _KNOWN_ALIASES.get(lowered, lowered)


def approval_context(params: JsonObject) -> JsonObject:
    info: JsonObject = {}
    app = params.get("app")
    if isinstance(app, str) and app:
        info["app"] = _KNOWN_ALIASES.get(app.strip().lower(), app)
    window_id = params.get("window_id")
    if isinstance(window_id, str) and window_id:
        try:
            window = _CACHE.window(window_id)
        except DriverError:
            window = None
        if window is not None:
            info["app"] = window.get("process")
            info["window"] = window.get("title")
        element_id = params.get("element_id")
        if isinstance(element_id, str) and element_id:
            try:
                element = _CACHE.element(window_id, element_id)
            except DriverError:
                element = None
            if element is not None:
                role = str(element.get("role") or "")
                name = str(element.get("name") or "")
                info["element"] = f"{role} «{name}»" if name else role
    return info


def launch_app(app: str, args: str | None = None) -> JsonObject:
    raw = str(app or "").strip()
    name = raw.lower()
    if not name or "\x00" in name or len(name) > 260:
        raise ValueError("Nombre de aplicación no válido")
    # Fuera de los alias se intenta el nombre tal cual: ShellExecute resuelve
    # PATH y App Paths (firefox, chrome…); la aprobación del usuario sigue siendo obligatoria.
    target = _KNOWN_ALIASES.get(name, raw)
    if args is not None and (not isinstance(args, str) or "\x00" in args or len(args) > 500):
        raise ValueError("Argumentos no válidos")
    classification = policy.classify_launch()

    def run() -> JsonObject:
        _ensure_dpi()
        if not hasattr(os, "startfile"):
            raise DriverError("Abrir aplicaciones solo está disponible en Windows")
        _check_worker_active()
        try:
            os.startfile(target, arguments=args or "")
        except FileNotFoundError as exc:
            quoted = target.replace("'", "''")
            raise DriverError(
                f"No se encontró el ejecutable «{raw}». Prueba abrirla vía shell con: Start-Process '{quoted}'"
            ) from exc
        time.sleep(1.2)
        return {"launched": name, "policy": classification}

    return cast(JsonObject, _run_on_worker(run, 15.0))
