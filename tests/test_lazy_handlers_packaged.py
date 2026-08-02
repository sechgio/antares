"""Regression: every lazy handler module must be listed in backend.spec.

After the HandlerRegistry switched to importlib lazy loads, PyInstaller no
longer sees static imports of backend.handlers.* — without hiddenimports the
frozen installer starts but every IPC call fails with ModuleNotFoundError.
"""

from __future__ import annotations

from pathlib import Path

from backend.handlers import _EXACT_MODULE, _HANDLER_MODULES, _PREFIX_MODULE


def test_all_lazy_handler_modules_are_in_pyinstaller_spec() -> None:
    spec = (Path(__file__).resolve().parent.parent / "backend" / "backend.spec").read_text(encoding="utf-8")
    modules = {
        *_HANDLER_MODULES,
        *_EXACT_MODULE.values(),
        *(mod for _prefix, mod in _PREFIX_MODULE),
    }
    missing = sorted(m for m in modules if f"'{m}'" not in spec)
    assert missing == [], f"Add these to backend.spec hiddenimports: {missing}"
    assert "collect_submodules('backend.handlers')" in spec
