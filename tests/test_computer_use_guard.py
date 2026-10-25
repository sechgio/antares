from __future__ import annotations

import threading

import pytest

from backend.core.computer_use import driver, input_guard
from backend.core.computer_use.policy import DriverRefused
from backend.core.computer_use.targets import DriverError, TargetCache

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


def test_guard_rechaza_sin_windows(monkeypatch):
    monkeypatch.setattr(input_guard, "_user32", lambda: None)
    guard = input_guard.InputGuard()
    with pytest.raises(DriverRefused):
        guard.begin()
    assert guard.broken is True


@pytest.mark.parametrize("failed_hook", [0, 1, 2])
def test_guard_rechaza_hooks_fallidos_y_limpia_instalaciones_parciales(monkeypatch, failed_hook):
    fake = _FakeUser32()

    def install(*_args):
        fake.calls["hook"] += 1
        return 0 if failed_hook in (0, fake.calls["hook"]) else 7

    monkeypatch.setattr(fake, "SetWindowsHookExW", install)
    monkeypatch.setattr(input_guard, "_user32", lambda: fake)
    guard = input_guard.InputGuard()
    try:
        with pytest.raises(DriverRefused):
            guard.begin()
        assert guard.broken is True
        assert fake.calls["unhook"] == (0 if failed_hook == 0 else 1)
    finally:
        guard.end()


def test_guard_rechaza_si_el_arranque_no_confirma_los_hooks(monkeypatch):
    guard = input_guard.InputGuard()
    monkeypatch.setattr(guard, "_pump", lambda _ready, stop: stop.wait())
    try:
        with pytest.raises(DriverRefused):
            guard.begin()
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
    assert order == ["begin", "end"]


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
    monkeypatch.setattr(driver, "_user32", lambda: _FakeUser32Cursor())
    guard = _StubGuard()
    monkeypatch.setattr(driver, "_GUARD", guard)

    def send(*inputs, **_kwargs):
        sent.append([i.u.mi.dwFlags for i in inputs])
        guard.broken = True

    monkeypatch.setattr(driver, "_send", send)
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


def test_normalize_app_resuelve_alias():
    assert driver.normalize_app(" Notepad ") == "notepad.exe"
    assert driver.normalize_app("CALC") == "calc.exe"
    assert driver.normalize_app("MiApp.EXE") == "miapp.exe"


def test_launch_app_abre_cualquier_nombre_y_resuelve_alias(monkeypatch):
    launched = []
    monkeypatch.setattr(driver, "_ensure_dpi", lambda: None)
    monkeypatch.setattr(driver.time, "sleep", lambda _s: None)
    monkeypatch.setattr(
        driver.os, "startfile", lambda target, arguments="": launched.append((target, arguments)), raising=False
    )
    assert driver.launch_app(" Firefox ")["launched"] == "firefox"
    assert driver.launch_app("Calc", "x")["launched"] == "calc"
    assert launched == [("Firefox", ""), ("calc.exe", "x")]


def test_launch_app_sugiere_start_process_si_no_encuentra_el_ejecutable(monkeypatch):
    def missing(target, arguments=""):
        raise FileNotFoundError(2, "No se encuentra", target)

    monkeypatch.setattr(driver, "_ensure_dpi", lambda: None)
    monkeypatch.setattr(driver.os, "startfile", missing, raising=False)
    with pytest.raises(DriverError, match=r"Start-Process 'O''Brien App'"):
        driver.launch_app("O'Brien App")


@pytest.mark.parametrize("app", ["", "   ", "a\x00b", "x" * 261])
def test_launch_app_rechaza_nombres_no_validos(app):
    with pytest.raises(ValueError, match="no válido"):
        driver.launch_app(app)


@pytest.mark.parametrize("current", [
    [{"element_id": "e0", "runtime_id": "delete"}, {"element_id": "e1", "runtime_id": "save"}],
    [{"element_id": "e0", "runtime_id": "delete"}],
    [{"element_id": "e0", "runtime_id": "save", "is_password": True}],
])
def test_action_keeps_observed_identity_and_rechecks_password(monkeypatch, current):
    order: list[str] = []
    _preparar_entorno(monkeypatch, order)
    cache = TargetCache()
    generation = cache.remember_windows([{"window_id": "w1", "elevated": False}])
    cache.remember_elements("w1", generation, [{"element_id": "e0", "runtime_id": "save", "is_password": False}])
    monkeypatch.setattr(driver, "_CACHE", cache)
    monkeypatch.setattr(driver, "_walk_elements", lambda *_: (current, {}, False))
    selected = []
    monkeypatch.setattr(driver, "_ACTION_IMPL", {
        "set_value": lambda _hwnd, target, *_: (selected.append(target["runtime_id"]) or {}),
    })
    if len(current) == 2:
        driver.perform_action("w1", "set_value", "e0", {"value": "texto"})
        assert selected == ["save"]
    else:
        with pytest.raises((DriverError, DriverRefused)):
            driver.perform_action("w1", "set_value", "e0", {"value": "texto"})
        assert selected == []


@pytest.mark.parametrize("action,params", [
    ("click", {}), ("scroll", {"amount": 1}), ("set_value", {"value": "texto"}),
])
def test_no_input_if_user_breaks_lease_while_observing(monkeypatch, action, params):
    order: list[str] = []
    guard = _preparar_entorno(monkeypatch, order)

    def observe(*_):
        guard.broken = True
        return [], {}, False

    monkeypatch.setattr(driver, "_walk_elements", observe)
    monkeypatch.setattr(driver, "_ACTION_IMPL", {action: lambda *_: (order.append("effect") or {})})
    with pytest.raises(DriverRefused):
        driver.perform_action("w1", action, "e0", params)
    assert "effect" not in order


def test_timeout_cancels_old_job_even_after_next_lease_begins(monkeypatch):
    order: list[str] = []
    guard = _preparar_entorno(monkeypatch, order)
    release = threading.Event()
    entered = threading.Event()
    worker = driver._run_on_worker
    calls = 0

    def observe(*_):
        if not entered.is_set():
            entered.set()
            assert release.wait(2)
        return [], {}, False

    def bounded_worker(fn, timeout):
        nonlocal calls
        calls += 1
        return worker(fn, 0.05 if calls == 1 else 1.0)

    def begin():
        guard.broken = False
        order.append("begin")
        if calls:
            release.set()

    monkeypatch.setattr(guard, "begin", begin)
    monkeypatch.setattr(driver, "_walk_elements", observe)
    monkeypatch.setattr(driver, "_run_on_worker", bounded_worker)
    try:
        with pytest.raises(DriverError, match="tiempo límite"):
            driver.perform_action("w1", "click", "e0", {})
        assert entered.is_set()
        result = driver.perform_action("w1", "click", "e0", {})
        assert result["performed"] is True
        assert order.count("action") == 1
    finally:
        release.set()
        worker(lambda: None, 2.0)


def test_timed_out_typing_does_not_send_input_after_guard_resets(monkeypatch):
    release = threading.Event()
    entered = threading.Event()
    sent = []
    guard = _StubGuard()
    monkeypatch.setattr(driver, "_GUARD", guard)
    monkeypatch.setattr(driver, "_ensure_element_focus", lambda *_: None)

    class User32:
        def SendInput(self, count, _inputs, _size):
            sent.append(count)
            return count

    monkeypatch.setattr(driver, "_user32", User32)

    def type_later():
        entered.set()
        assert release.wait(2)
        return driver._act_type_text(1, {"runtime_id": "42"}, "e0", {"text": "abc"}, {})

    try:
        with pytest.raises(DriverError, match="tiempo límite"):
            driver._run_on_worker(type_later, 0.05)
        assert entered.is_set()
        guard.broken = False
        release.set()
        driver._run_on_worker(lambda: None, 2.0)
        assert sent == []
    finally:
        release.set()


def test_timed_out_launch_does_not_start_app(monkeypatch):
    release = threading.Event()
    entered = threading.Event()
    launched = []
    worker = driver._run_on_worker

    def prepare():
        entered.set()
        assert release.wait(2)

    monkeypatch.setattr(driver, "_ensure_dpi", prepare)
    monkeypatch.setattr(driver.os, "startfile", lambda *args, **_: launched.append(args), raising=False)
    monkeypatch.setattr(driver, "_run_on_worker", lambda fn, timeout: worker(fn, 0.05))
    try:
        with pytest.raises(DriverError, match="tiempo límite"):
            driver.launch_app("notepad")
        assert entered.is_set()
        release.set()
        worker(lambda: None, 2.0)
        assert launched == []
    finally:
        release.set()
