
from __future__ import annotations

import importlib
import time
from contextlib import nullcontext

import pytest


def test_fichas_create_resolves_without_waiting_on_heavy_imports(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.handlers import HandlerRegistry

    heavy = {
        "backend.handlers.conversion",
        "backend.handlers.sellador",
        "backend.handlers.ubicaciones",
        "backend.handlers.panel_aviso_corte",
        "backend.handlers.optimizer",
        "backend.handlers.formatos",
    }
    for name in heavy:
        importlib.import_module(name)

    orig_import = importlib.import_module
    sleeps = {"n": 0}

    def slow_import(name: str, package: str | None = None):  # type: ignore[no-untyped-def]
        if name in heavy:
            sleeps["n"] += 1
            time.sleep(5)
        return orig_import(name, package)

    monkeypatch.setattr(importlib, "import_module", slow_import)

    reg = HandlerRegistry()
    t0 = time.perf_counter()
    handler = reg.get("fichas_tecnicas_create")
    elapsed = time.perf_counter() - t0

    assert handler is not None
    assert elapsed < 2.0, f"expected <2s lazy resolve, got {elapsed:.2f}s (heavy sleeps={sleeps['n']})"
    assert sleeps["n"] == 0, "fichas resolve must not import heavy unrelated modules"


def test_technical_reports_create_resolves_without_waiting_on_heavy_imports(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.handlers import HandlerRegistry

    heavy = {
        "backend.handlers.conversion",
        "backend.handlers.sellador",
        "backend.handlers.ubicaciones",
        "backend.handlers.panel_aviso_corte",
    }
    for name in heavy:
        importlib.import_module(name)

    orig_import = importlib.import_module

    def slow_import(name: str, package: str | None = None):  # type: ignore[no-untyped-def]
        if name in heavy:
            time.sleep(5)
        return orig_import(name, package)

    monkeypatch.setattr(importlib, "import_module", slow_import)

    reg = HandlerRegistry()
    t0 = time.perf_counter()
    handler = reg.get("technical_reports_create")
    elapsed = time.perf_counter() - t0

    assert handler is not None
    assert elapsed < 2.0, f"expected <2s lazy resolve, got {elapsed:.2f}s"


def test_unknown_method_does_not_eager_load_all_modules(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.handlers import HandlerRegistry

    imports: list[str] = []
    orig_import = importlib.import_module

    def tracking_import(name: str, package: str | None = None):  # type: ignore[no-untyped-def]
        if name.startswith("backend.handlers."):
            imports.append(name)
        return orig_import(name, package)

    monkeypatch.setattr(importlib, "import_module", tracking_import)

    reg = HandlerRegistry()
    assert "nonexistent_method" not in reg
    assert imports == []


def test_warm_core_skips_deferred_modules(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.handlers import (
        _CORE_HANDLER_MODULES,
        _DEFERRED_HANDLER_MODULES,
        _POST_READY_HANDLER_MODULES,
        HandlerRegistry,
    )

    imported: list[str] = []
    orig_import = importlib.import_module

    def tracking_import(name: str, package: str | None = None):  # type: ignore[no-untyped-def]
        if name.startswith("backend.handlers."):
            imported.append(name)
        return orig_import(name, package)

    monkeypatch.setattr(importlib, "import_module", tracking_import)

    reg = HandlerRegistry()
    for name in _CORE_HANDLER_MODULES:
        importlib.import_module(name)
    imported.clear()

    reg.warm_core()
    deferred_hits = [m for m in imported if m in _DEFERRED_HANDLER_MODULES]
    assert deferred_hits == [], f"warm_core must not import deferred: {deferred_hits}"
    post_hits = [m for m in imported if m in _POST_READY_HANDLER_MODULES]
    assert post_hits == [], f"warm_core must not import post-ready: {post_hits}"


def test_warm_core_excludes_pillow_conversion() -> None:
    from backend.handlers import _CORE_HANDLER_MODULES, _POST_READY_HANDLER_MODULES

    assert "backend.handlers.conversion" not in _CORE_HANDLER_MODULES
    assert "backend.handlers.conversion" in _POST_READY_HANDLER_MODULES
    assert "backend.handlers.canvas" in _POST_READY_HANDLER_MODULES


def test_post_ready_methods_resolve_without_prior_warm_core_of_those_modules(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.handlers import (
        _CORE_HANDLER_MODULES,
        _POST_READY_HANDLER_MODULES,
        HandlerRegistry,
    )

    imported: list[str] = []
    orig_import = importlib.import_module

    def tracking_import(name: str, package: str | None = None):  # type: ignore[no-untyped-def]
        if name.startswith("backend.handlers."):
            imported.append(name)
        return orig_import(name, package)

    monkeypatch.setattr(importlib, "import_module", tracking_import)

    reg = HandlerRegistry()
    for name in _CORE_HANDLER_MODULES:
        orig_import(name)
    imported.clear()
    reg.warm_core()
    assert all(m not in imported for m in _POST_READY_HANDLER_MODULES)

    imported.clear()
    preview = reg.get("preview")
    assert preview is not None
    assert "backend.handlers.conversion" in imported

    imported.clear()
    canvas_list = reg.get("canvas_list")
    assert canvas_list is not None
    assert "backend.handlers.canvas" in imported


def test_warm_core_faster_than_full_warm_when_deferred_are_slow(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.handlers import (
        _CORE_HANDLER_MODULES,
        _DEFERRED_HANDLER_MODULES,
        HandlerRegistry,
    )

    for name in (*_CORE_HANDLER_MODULES, *_DEFERRED_HANDLER_MODULES):
        importlib.import_module(name)

    orig_import = importlib.import_module

    def slow_deferred(name: str, package: str | None = None):  # type: ignore[no-untyped-def]
        if name in _DEFERRED_HANDLER_MODULES:
            time.sleep(0.05)
        return orig_import(name, package)

    monkeypatch.setattr(importlib, "import_module", slow_deferred)

    core_reg = HandlerRegistry()
    t0 = time.perf_counter()
    core_reg.warm_core()
    core_ms = (time.perf_counter() - t0) * 1000

    full_reg = HandlerRegistry()
    t1 = time.perf_counter()
    full_reg.warm()
    full_ms = (time.perf_counter() - t1) * 1000

    assert core_ms < full_ms, f"expected warm_core ({core_ms:.0f}ms) < warm all ({full_ms:.0f}ms)"
    assert full_ms - core_ms >= 200, f"expected >=200ms gap, got core={core_ms:.0f} full={full_ms:.0f}"


def test_every_electron_backend_method_resolves() -> None:
    import re
    from pathlib import Path

    from backend.handlers import HandlerRegistry, _module_for_method

    text = (Path(__file__).resolve().parent.parent / "electron" / "ipc-methods.js").read_text(encoding="utf-8")
    start = text.index("const BACKEND_METHODS")
    end = text.index("];", start)
    methods = re.findall(r"'([a-z][a-z0-9_]*)'", text[start:end])
    assert methods

    unmapped = [m for m in methods if _module_for_method(m) is None]
    assert unmapped == []

    reg = HandlerRegistry()
    unresolved = [m for m in methods if reg.get(m) is None]
    assert unresolved == []


def test_warm_post_ready_releases_critical_waiters_before_formatos_warm(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import sys
    import types

    from backend.handlers import WARM_CRITICAL_DONE, HandlerRegistry

    order: list[str] = []
    monkeypatch.setattr(WARM_CRITICAL_DONE, "set", lambda: order.append("critical_done"), raising=False)

    fake_pdf_html = types.SimpleNamespace(write_pdf_sanitized=lambda html: b"%PDF-fake")
    monkeypatch.setitem(sys.modules, "backend.utils.pdf_html", fake_pdf_html)
    monkeypatch.setattr("backend.handlers.serialized_import", nullcontext)

    reg = HandlerRegistry()
    monkeypatch.setattr(reg, "warm", lambda modules=None: order.append("handler_warm"))
    monkeypatch.setattr(reg, "_warm_formatos_core", lambda: order.append("formatos_import"))

    reg.warm_post_ready()

    assert "critical_done" in order, "WARM_CRITICAL_DONE must be set during warm_post_ready"
    assert "formatos_import" in order, "formatos warm must run during warm_post_ready"
    assert order.index("critical_done") < order.index("formatos_import"), (
        f"formatos warm must run after critical release, got order={order}"
    )


def test_warm_formatos_core_failure_is_non_fatal(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.handlers import HandlerRegistry

    real_import = importlib.import_module

    def failing_import(name: str, package: str | None = None):  # type: ignore[no-untyped-def]
        if name == "backend.core.formatos":
            raise ImportError("boom")
        return real_import(name, package)

    monkeypatch.setattr(importlib, "import_module", failing_import)
    monkeypatch.setattr("backend.handlers.serialized_import", nullcontext)

    reg = HandlerRegistry()
    reg._warm_formatos_core()


def test_warm_core_does_not_import_formatos_core(monkeypatch: pytest.MonkeyPatch) -> None:
    import sys

    from backend.handlers import HandlerRegistry

    saved = sys.modules.pop("backend.core.formatos", None)
    try:
        reg = HandlerRegistry()
        reg.warm_core()
        assert "backend.core.formatos" not in sys.modules
    finally:
        if saved is not None:
            sys.modules["backend.core.formatos"] = saved
