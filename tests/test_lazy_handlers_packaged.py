
from __future__ import annotations

import json
from pathlib import Path

from backend.core.ipc_catalog import handler_module_for
from backend.handlers import _HANDLER_MODULES


def test_all_lazy_handler_modules_are_in_pyinstaller_spec() -> None:
    spec = (Path(__file__).resolve().parent.parent / "backend" / "backend.spec").read_text(encoding="utf-8")
    catalog_path = Path(__file__).resolve().parent.parent / "shared" / "ipc-method-catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    modules = {
        *_HANDLER_MODULES,
        *(
            mod
            for method in catalog["methods"]
            if (mod := handler_module_for(method)) is not None
        ),
    }
    uses_collect = "collect_submodules('backend.handlers')" in spec
    missing = [] if uses_collect else sorted(m for m in modules if f"'{m}'" not in spec)
    assert missing == [], f"Add these to backend.spec hiddenimports: {missing}"
    assert uses_collect
    assert "ipc-method-catalog.json" in spec
