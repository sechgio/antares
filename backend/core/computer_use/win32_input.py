"""Estructuras y constantes de entrada Win32 compartidas.

Fuente única de las definiciones ctypes que `computer_use.driver` y
`agent.computer_desktop` inyectan por SendInput. La carga de user32, el
espaciado DPI y las políticas de guardia/seguridad siguen siendo
responsabilidad de cada consumidor.
"""
from __future__ import annotations

import ctypes
from ctypes import wintypes

ULONG_PTR = ctypes.c_size_t


class MouseInput(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class KeybdInput(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class HardwareInput(ctypes.Structure):
    _fields_ = [("uMsg", wintypes.DWORD), ("wParamL", wintypes.WORD), ("wParamH", wintypes.WORD)]


class InputUnion(ctypes.Union):
    _fields_ = [("mi", MouseInput), ("ki", KeybdInput), ("hi", HardwareInput)]


class Input(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("u", InputUnion)]


INPUT_MOUSE, INPUT_KEYBOARD = 0, 1
KEYUP, UNICODE = 0x0002, 0x0004
MOUSE_DOWN, MOUSE_UP = 0x0002, 0x0004
MOUSE_FLAGS = {"left": (MOUSE_DOWN, MOUSE_UP), "right": (0x0008, 0x0010), "middle": (0x0020, 0x0040)}
WHEEL = 0x0800
VK = {
    "ctrl": 0x11, "control": 0x11, "shift": 0x10, "alt": 0x12, "win": 0x5B, "windows": 0x5B,
    "enter": 0x0D, "return": 0x0D, "tab": 0x09, "esc": 0x1B, "escape": 0x1B, "space": 0x20,
    "backspace": 0x08, "delete": 0x2E, "del": 0x2E, "insert": 0x2D, "home": 0x24, "end": 0x23,
    "pageup": 0x21, "pagedown": 0x22, "up": 0x26, "down": 0x28, "left": 0x25, "right": 0x27,
    "printscreen": 0x2C, "capslock": 0x14, "menu": 0x5D,
    **{f"f{n}": 0x6F + n for n in range(1, 13)},
}
EXTENDED = {0x2E, 0x2D, 0x24, 0x23, 0x21, 0x22, 0x26, 0x28, 0x25, 0x27, 0x5B, 0x5D}


def mouse(flags: int, data: int = 0) -> Input:
    return Input(type=INPUT_MOUSE, u=InputUnion(mi=MouseInput(0, 0, data, flags, 0, 0)))


def key(vk: int, up: bool = False) -> Input:
    flags = (KEYUP if up else 0) | (0x0001 if vk in EXTENDED else 0)
    return Input(type=INPUT_KEYBOARD, u=InputUnion(ki=KeybdInput(vk, 0, flags, 0, 0)))


def unicode_input(unit: int, up: bool = False) -> Input:
    return Input(type=INPUT_KEYBOARD, u=InputUnion(ki=KeybdInput(0, unit, UNICODE | (KEYUP if up else 0), 0, 0)))
