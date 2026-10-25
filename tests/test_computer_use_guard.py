from __future__ import annotations

import pytest

from backend.core.computer_use import driver, input_guard
from backend.core.computer_use.policy import DriverRefused

_WM_KEYDOWN, _WM_KEYUP, _WM_SYSKEYDOWN = 0x0100, 0x0101, 0x0104
_WM_MOUSEMOVE, _WM_LBUTTONDOWN, _WM_MOUSEWHEEL = 0x0200, 0x0201, 0x020A
_LLKHF_INJECTED, _LLMHF_INJECTED = 0x10, 0x1


def test_key_breaks_lease_solo_con_pulsacion_fisica():
    assert input_guard.key_breaks_lease(_WM_KEYDOWN, 0) is True
    assert input_guard.key_breaks_lease(_WM_SYSKEYDOWN, 0) is True
    assert input_guard.key_breaks_lease(_WM_KEYUP, 0) is False
    assert input_guard.key_breaks_lease(_WM_KEYDOWN, _LLKHF_INJECTED) is False


def test_mouse_breaks_lease_ignora_movimiento_e_inyectado():
    assert input_guard.mouse_breaks_lease(_WM_MOUSEMOVE, 0) is False
    assert input_guard.mouse_breaks_lease(_WM_LBUTTONDOWN, 0) is True
    assert input_guard.mouse_breaks_lease(_WM_MOUSEWHEEL, 0) is True
    assert input_guard.mouse_breaks_lease(_WM_LBUTTONDOWN, _LLMHF_INJECTED) is False


class _FakeUser32:
    def __init__(self, hooks_ok: bool = True):
        self.calls = {"hook": 0, "unhook": 0}
        self._hooks_ok = hooks_ok

    def SetWindowsHookExW(self, *_args):
        self.calls["hook"] += 1
        return 7 if self._hooks_ok else 0

    def UnhookWindowsHookEx(self, *_args):
        self.calls["unhook"] += 1
        return 1

    def CallNextHookEx(self, *_args):
        return 0

    def PeekMessageW(self, *_args):
        return 0


def test_guard_instala_y_desinstala_los_dos_hooks(monkeypatch):
    fake = _FakeUser32()
    monkeypatch.setattr(input_guard, "_user32", lambda: fake)
    guard = input_guard.InputGuard()
    guard.begin()
    try:
        assert guard.broken is False
    finally:
        guard.end()
    assert fake.calls == {"hook": 2, "unhook": 2}


def test_guard_degrada_sin_windows(monkeypatch):
    monkeypatch.setattr(input_guard, "_user32", lambda: None)
    guard = input_guard.InputGuard()
    guard.begin()
    try:
        assert guard.broken is False
    finally:
        guard.end()


class _StubCache:
    generation = 3

    def window(self, window_id):
        return {"window_id": window_id, "title": "Prueba", "elevated": False}

    def element(self, window_id, element_id):
        return {"is_password": False}

    def remember_elements(self, *_args):
        pass

    def check_element(self, *_args, **_kwargs):
        return {"runtime_id": "42"}


class _StubGuard:
    broken = False

    def __init__(self, order: list[str] | None = None):
        self._order = order

    def begin(self):
        if self._order is not None:
            self._order.append("begin")

    def end(self):
        if self._order is not None:
            self._order.append("end")


def _preparar_entorno(monkeypatch, order, elevated: bool = False):
    cache = _StubCache()
    if elevated:
        cache.window = lambda window_id: {"window_id": window_id, "elevated": True}
    monkeypatch.setattr(driver, "_CACHE", cache)
    guard = _StubGuard(order)
    monkeypatch.setattr(driver, "_GUARD", guard)
    monkeypatch.setattr(driver, "_prepare_window", lambda window: 0x1111)
    monkeypatch.setattr(driver, "_walk_elements", lambda hwnd, max_nodes, budget: ([], {}, False))
    monkeypatch.setattr(driver, "_window_rect", lambda hwnd: [10, 20, 300, 200])
    monkeypatch.setattr(driver, "_ACTION_IMPL", {
        "click": lambda hwnd, target, element_id, params, ctx: (order.append("action"), {"clicked": True})[1],
    })
    return guard


def test_perform_action_envuelve_la_accion_en_lease_y_devuelve_rect(monkeypatch):
    order: list[str] = []
    _preparar_entorno(monkeypatch, order)
    result = driver.perform_action("w1", "click", "e0", {"button": "left"})
    assert order == ["begin", "action", "end"]
    assert result["window_rect"] == [10, 20, 300, 200]


def test_perform_action_rechaza_si_el_lease_se_rompio(monkeypatch):
    order: list[str] = []
    guard = _preparar_entorno(monkeypatch, order)
    guard.broken = True
    with pytest.raises(DriverRefused, match="entrada física"):
        driver.perform_action("w1", "click", "e0", {})
    assert order == ["begin", "action", "end"]


def test_perform_action_handoff_no_instala_lease(monkeypatch):
    order: list[str] = []
    _preparar_entorno(monkeypatch, order, elevated=True)
    with pytest.raises(DriverRefused, match="elevado"):
        driver.perform_action("w1", "click", "e0", {})
    assert order == []


def _raw_focusable() -> object:
    class _Raw:
        def SetFocus(self) -> None:
            pass
    return _Raw()


def test_type_text_aborta_a_mitad_si_el_lease_se_rompio(monkeypatch):
    sent: list[int] = []
    monkeypatch.setattr(driver, "_send", lambda *inputs: sent.append(len(inputs)))
    guard = _StubGuard()
    guard.broken = True
    monkeypatch.setattr(driver, "_GUARD", guard)
    ctx = {"raws": {"42": _raw_focusable()}, "window_rect": [0, 0, 400, 300]}
    target = {"runtime_id": "42", "center": [100, 100]}
    with pytest.raises(DriverRefused, match="entrada física"):
        driver._act_type_text(0x1111, target, "e0", {"text": "hola"}, ctx)
    assert sent == []


class _FakeUser32Cursor:
    def GetForegroundWindow(self):
        return 0x1111

    def SetForegroundWindow(self, _hwnd):
        pass

    def SetCursorPos(self, _x, _y):
        pass


def test_drag_suelta_el_boton_si_el_lease_se_rompio(monkeypatch):
    sent: list[list[int]] = []
    monkeypatch.setattr(driver, "_send", lambda *inputs: sent.append([i.u.mi.dwFlags for i in inputs]))
    monkeypatch.setattr(driver, "_user32", lambda: _FakeUser32Cursor())
    guard = _StubGuard()
    guard.broken = True
    monkeypatch.setattr(driver, "_GUARD", guard)
    ctx = {"raws": {}, "window_rect": [0, 0, 400, 300], "by_runtime": {}, "window_id": "w1"}
    target = {"runtime_id": "42", "center": [100, 100]}
    with pytest.raises(DriverRefused, match="entrada física"):
        driver._act_drag(0x1111, target, "e0", {"to_x": 200, "to_y": 200}, ctx)
    assert sent[0] == [0x0002]
    assert sent[-1] == [0x0004]


class _ContextCache:
    def __init__(self, window=None, element=None):
        self._window = window
        self._element = element

    def window(self, window_id):
        if self._window is None:
            raise driver.DriverError("ventana desconocida")
        return self._window

    def element(self, window_id, element_id):
        if self._element is None:
            raise driver.DriverError("elemento desconocido")
        return self._element


def test_approval_context_describe_ventana_y_elemento(monkeypatch):
    monkeypatch.setattr(driver, "_CACHE", _ContextCache(
        window={"process": "notepad.exe", "title": "Sin título - Bloc de notas"},
        element={"role": "Edit", "name": "Búsqueda"},
    ))
    info = driver.approval_context({"window_id": "w1a2b", "element_id": "e3"})
    assert info == {"app": "notepad.exe", "window": "Sin título - Bloc de notas", "element": "Edit «Búsqueda»"}


def test_approval_context_elemento_sin_nombre(monkeypatch):
    monkeypatch.setattr(driver, "_CACHE", _ContextCache(
        window={"process": "calc.exe", "title": "Calculadora"},
        element={"role": "Button", "name": ""},
    ))
    assert driver.approval_context({"window_id": "w1", "element_id": "e1"}) == {
        "app": "calc.exe", "window": "Calculadora", "element": "Button"}


def test_approval_context_responde_al_alias_de_app(monkeypatch):
    assert driver.approval_context({"app": "Notepad"}) == {"app": "notepad.exe"}


def test_approval_context_vacio_si_no_hay_nada_conocido(monkeypatch):
    monkeypatch.setattr(driver, "_CACHE", _ContextCache())
    assert driver.approval_context({"window_id": "wf", "element_id": "e9"}) == {}
    assert driver.approval_context({}) == {}
