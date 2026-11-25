from __future__ import annotations

import sys

import pytest

if sys.platform == "win32":
    import comtypes

    # Los tests llaman al driver en el hilo principal; en produccion el worker
    # dedicado hace esta inicializacion COM al arrancar.
    comtypes.CoInitialize()

from backend.core.computer_use import driver
from backend.core.computer_use import win32_input as wxi
from backend.core.computer_use.targets import DriverError


def _legacy_stream(text: str):
    stream = []
    for char in text.replace("\r\n", "\n"):
        if char == "\n":
            stream.extend((wxi.key(0x0D), wxi.key(0x0D, up=True)))
        elif char == "\t":
            stream.extend((wxi.key(0x09), wxi.key(0x09, up=True)))
        else:
            encoded = char.encode("utf-16-le")
            units = [int.from_bytes(encoded[i:i + 2], "little") for i in range(0, len(encoded), 2)]
            stream.extend(wxi.unicode_input(unit) for unit in units)
            stream.extend(wxi.unicode_input(unit, up=True) for unit in units)
    return stream


def _signature(inputs) -> list[tuple[int, int, int]]:
    return [(i.type, i.u.ki.wVk, i.u.ki.wScan) if i.type == 1 else (i.type, 0, 0) for i in inputs]


def test_text_inputs_coincide_con_la_secuencia_por_caracter():
    text = "ab\r\ncd\teñÑ€"
    assert _signature(wxi.text_inputs(text)) == _signature(_legacy_stream(text))


def test_text_inputs_par_de_sustitutos_en_orden():
    text = "𝄞a"
    legacy = _signature(_legacy_stream(text))
    assert _signature(wxi.text_inputs(text)) == legacy
    assert len(legacy) == 6


def test_text_inputs_vacio():
    assert wxi.text_inputs("") == []


class _FakeRect:
    left, top, right, bottom = 10, 20, 110, 60


class _FakeRaw:
    def __init__(self, runtime_id=(42, 100), *, raises=False):
        self._runtime_id = runtime_id
        self._raises = raises
        self.CachedBoundingRectangle = _FakeRect()
        self.CachedControlType = 50004
        self.CachedName = "Editor"
        self.CachedAutomationId = "editor"
        self.CachedIsEnabled = True
        self.CachedIsOffscreen = False

    def BuildUpdatedCache(self, _request):
        if self._raises:
            raise OSError("elemento muerto")
        return self

    def GetCachedPropertyValue(self, prop):
        if prop == 30019:
            return False
        if prop == 30045:
            return "texto"
        return self._runtime_id


class _ResolveCache:
    def __init__(self, element, raw):
        self._element = element
        self._raw = raw

    def element(self, window_id, element_id):
        if self._element is None:
            raise DriverError("elemento desconocido")
        return self._element

    def raw_element(self, window_id, element_id):
        return self._raw


def _entry(element_id="e0", runtime_id="42,100"):
    return {"element_id": element_id, "runtime_id": runtime_id, "is_password": False}


def test_resolve_element_valida_solo_el_elemento_con_cache_viva(monkeypatch):
    monkeypatch.setattr(driver, "_CACHE", _ResolveCache(_entry(), _FakeRaw()))

    def forbidden_walk(*_args):
        raise AssertionError("no debería recorrer el árbol con el raw en caché")

    monkeypatch.setattr(driver, "_walk_elements", forbidden_walk)
    fresh, raw = driver._resolve_element(0x1111, "w1", "e0")
    assert fresh["element_id"] == "e0"
    assert fresh["center"] == [60, 40]
    assert fresh["value"] == "texto"
    assert fresh["role"] == "edit"
    assert raw is not None


def test_resolve_element_obsoleto_si_muere_o_cambia_runtime_id(monkeypatch):
    monkeypatch.setattr(driver, "_CACHE", _ResolveCache(_entry(), _FakeRaw(raises=True)))
    with pytest.raises(DriverError, match="obsoleto"):
        driver._resolve_element(0x1111, "w1", "e0")
    monkeypatch.setattr(driver, "_CACHE", _ResolveCache(_entry(), _FakeRaw(runtime_id=(42, 999))))
    with pytest.raises(DriverError, match="obsoleto"):
        driver._resolve_element(0x1111, "w1", "e0")


def test_resolve_element_cae_al_arbol_sin_raw_cacheado(monkeypatch):
    monkeypatch.setattr(driver, "_CACHE", _ResolveCache(_entry(), None))
    walked = []

    class _FallbackCache(_ResolveCache):
        def check_element(self, window_id, element_id, runtime_ids_now):
            return {"runtime_id": "42,100", "element_id": element_id, "center": [1, 2]}

    monkeypatch.setattr(driver, "_CACHE", _FallbackCache(_entry(), None))

    def fake_walk(hwnd, max_nodes, budget, control_view=False):
        walked.append(hwnd)
        return [{"runtime_id": "42,100"}], {"42,100": object()}, False

    monkeypatch.setattr(driver, "_walk_elements", fake_walk)
    fresh, _raw = driver._resolve_element(0x1111, "w1", "e0")
    assert walked == [0x1111]
    assert fresh["center"] == [1, 2]


class _ActionCache:
    generation = 1

    def __init__(self, raw=None):
        self._raw = raw

    def window(self, window_id):
        return {"window_id": window_id, "title": "Prueba", "elevated": False}

    def element(self, window_id, element_id):
        return {"element_id": element_id, "runtime_id": "42,100", "is_password": False}

    def raw_element(self, window_id, element_id):
        return self._raw


class _GuardOk:
    broken = False

    def begin(self):
        pass

    def end(self):
        pass


def _preparar_accion(monkeypatch, cache):
    monkeypatch.setattr(driver, "_CACHE", cache)
    monkeypatch.setattr(driver, "_GUARD", _GuardOk())
    monkeypatch.setattr(driver, "_prepare_window", lambda window: 0x1111)
    monkeypatch.setattr(driver, "_window_rect", lambda hwnd: [0, 0, 300, 200])
    monkeypatch.setattr(driver, "_ensure_foreground", lambda hwnd: None)


def test_press_key_sin_objetivo_no_recorre_el_arbol(monkeypatch):
    _preparar_accion(monkeypatch, _ActionCache())

    def forbidden_walk(*_args, **_kwargs):
        raise AssertionError("press_key sin elemento no debería recorrer el árbol")

    monkeypatch.setattr(driver, "_walk_elements", forbidden_walk)
    monkeypatch.setattr(driver, "_ACTION_IMPL", {
        "press_key": lambda hwnd, target, element_id, params, ctx: {"pressed": "enter"},
    })
    result = driver.perform_action("w1", "press_key", None, {"keys": "enter"})
    assert result["performed"] is True


def test_accion_con_raw_en_cache_no_recorre_el_arbol(monkeypatch):
    _preparar_accion(monkeypatch, _ActionCache(raw=_FakeRaw()))

    def forbidden_walk(*_args, **_kwargs):
        raise AssertionError("con raw en caché no debería recorrer el árbol")

    monkeypatch.setattr(driver, "_walk_elements", forbidden_walk)
    monkeypatch.setattr(driver, "_ACTION_IMPL", {
        "click": lambda hwnd, target, element_id, params, ctx: {"clicked": target["center"]},
    })
    result = driver.perform_action("w1", "click", "e0", {})
    assert result["clicked"] == [60, 40]


def test_type_text_batchado_respeta_el_orden_y_aborta_por_chunk(monkeypatch):
    sent: list[list[tuple[int, int, int]]] = []
    monkeypatch.setattr(driver, "_send", lambda *inputs: sent.append(_signature(inputs)))
    guard = _GuardOk()
    monkeypatch.setattr(driver, "_GUARD", guard)
    monkeypatch.setattr(driver, "_ensure_element_focus", lambda ctx, target: None)
    text = "ab\nc"
    driver._act_type_text(0x1111, {"runtime_id": "42", "center": [1, 1]}, "e0", {"text": text}, {"raws": {}, "window_rect": [0, 0, 9, 9]})
    joined = [item for chunk in sent for item in chunk]
    assert joined == _signature(_legacy_stream(text))

    class _GuardBroken:
        broken = True

    sent.clear()
    monkeypatch.setattr(driver, "_GUARD", _GuardBroken())
    with pytest.raises(Exception, match="entrada física"):
        driver._act_type_text(0x1111, {"runtime_id": "42", "center": [1, 1]}, "e0", {"text": "texto largo"}, {"raws": {}, "window_rect": [0, 0, 9, 9]})
    assert sent == []
