from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import threading
import time
from contextlib import suppress

# Clasificación validada con spike de hooks (Temp/rea-audit/phase0/probe_fase3_hooks.py):
# SendInput marca cada evento inyectado con el flag INJECTED (0x10 teclado, 0x1 ratón),
# y el movimiento puro del ratón es actividad ambiental constante (~192 eventos en unos
# segundos con el usuario delante), así que solo teclas, clics y rueda físicos rompen el lease.
WH_KEYBOARD_LL = 13
WH_MOUSE_LL = 14
WM_KEYDOWN = 0x0100
WM_SYSKEYDOWN = 0x0104
WM_MOUSEMOVE = 0x0200
LLKHF_INJECTED = 0x10
LLMHF_INJECTED = 0x1

LEASE_MESSAGE = (
    "El usuario tomó el control con entrada física durante la operación; "
    "detente, informa de lo hecho hasta ahora y espera instrucciones."
)


def key_breaks_lease(wparam: int, flags: int) -> bool:
    if flags & LLKHF_INJECTED:
        return False
    return wparam in (WM_KEYDOWN, WM_SYSKEYDOWN)


def mouse_breaks_lease(wparam: int, flags: int) -> bool:
    if flags & LLMHF_INJECTED:
        return False
    return wparam != WM_MOUSEMOVE


_PUL = ctypes.POINTER(ctypes.c_ulong)


class _KbdHookStruct(ctypes.Structure):
    _fields_ = [("vkCode", wt.DWORD), ("scanCode", wt.DWORD), ("flags", wt.DWORD),
                ("time", wt.DWORD), ("dwExtraInfo", _PUL)]


class _MouseHookStruct(ctypes.Structure):
    _fields_ = [("pt", wt.POINT), ("mouseData", wt.DWORD), ("flags", wt.DWORD),
                ("time", wt.DWORD), ("dwExtraInfo", _PUL)]


if hasattr(ctypes, "WINFUNCTYPE"):  # solo Windows
    _KbdProc = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_int, wt.WPARAM, ctypes.POINTER(_KbdHookStruct))
    _MouseProc = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_int, wt.WPARAM, ctypes.POINTER(_MouseHookStruct))
else:  # pragma: no cover
    _KbdProc = None
    _MouseProc = None

_win_dll: ctypes.WinDLL | None = None


def _user32() -> ctypes.WinDLL | None:
    global _win_dll
    if not hasattr(ctypes, "WINFUNCTYPE"):  # pragma: no cover
        return None
    if _win_dll is None:
        _win_dll = ctypes.WinDLL("user32", use_last_error=True)
    return _win_dll


class InputGuard:
    """Lease humano: durante una operación del agente, la entrada física deliberada
    (teclas, clics o rueda) rompe el lease y la acción en curso se aborta."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._broken = False
        self._thread: threading.Thread | None = None
        self._stop: threading.Event | None = None

    @property
    def broken(self) -> bool:
        with self._lock:
            return self._broken

    def reset(self) -> None:
        with self._lock:
            self._broken = False

    def begin(self) -> None:
        self.reset()
        self._stop = threading.Event()
        ready = threading.Event()
        self._thread = threading.Thread(target=self._pump, args=(ready, self._stop), daemon=True)
        self._thread.start()
        ready.wait(2.0)

    def end(self) -> None:
        if self._stop is not None:
            self._stop.set()
        if self._thread is not None:
            self._thread.join(2.0)
        self._thread = None
        self._stop = None

    def _mark(self) -> None:
        with self._lock:
            self._broken = True

    def _pump(self, ready: threading.Event, stop: threading.Event) -> None:
        user32 = _user32()
        if user32 is None or _KbdProc is None or _MouseProc is None:  # pragma: no cover
            ready.set()
            return

        def on_key(code: int, wparam: int, lparam: ctypes.POINTER(_KbdHookStruct)) -> int:
            info = lparam[0]
            if key_breaks_lease(int(wparam), int(info.flags)):
                self._mark()
            return user32.CallNextHookEx(None, code, wparam, lparam)

        def on_mouse(code: int, wparam: int, lparam: ctypes.POINTER(_MouseHookStruct)) -> int:
            info = lparam[0]
            if mouse_breaks_lease(int(wparam), int(info.flags)):
                self._mark()
            return user32.CallNextHookEx(None, code, wparam, lparam)

        kbd_cb = _KbdProc(on_key)
        mouse_cb = _MouseProc(on_mouse)
        hhk_k = user32.SetWindowsHookExW(WH_KEYBOARD_LL, kbd_cb, None, 0)
        hhk_m = user32.SetWindowsHookExW(WH_MOUSE_LL, mouse_cb, None, 0)
        ready.set()
        msg = wt.MSG()
        while not stop.is_set():
            while user32.PeekMessageW(ctypes.byref(msg), None, 0, 0, 1):
                user32.TranslateMessage(ctypes.byref(msg))
                user32.DispatchMessageW(ctypes.byref(msg))
            time.sleep(0.01)
        with suppress(Exception):
            if hhk_k:
                user32.UnhookWindowsHookEx(hhk_k)
            if hhk_m:
                user32.UnhookWindowsHookEx(hhk_m)
