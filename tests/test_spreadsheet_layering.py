from __future__ import annotations

import ast
from importlib.util import resolve_name
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parents[1] / "backend"
_SPREADSHEET_HANDLER = "backend.handlers.spreadsheet"


def _handler_import_lines(source: str, package: str) -> list[int]:
    violations = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            targets = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if node.level:
                module = resolve_name("." * node.level + module, package)
            targets = [module, *(f"{module}.{alias.name}" for alias in node.names)]
        else:
            continue
        if _SPREADSHEET_HANDLER in targets:
            violations.append(node.lineno)
    return violations


@pytest.mark.parametrize("source", [
    "import backend.handlers.spreadsheet as spreadsheet",
    "from backend.handlers import spreadsheet",
    "def parse():\n    from backend.handlers.spreadsheet import parser",
    "from ...handlers.spreadsheet import parser",
])
def test_spreadsheet_layering_rejects_handler_imports(source: str) -> None:
    assert len(_handler_import_lines(source, "backend.core.agent")) == 1


def test_spreadsheet_layering_allows_decoder_imports() -> None:
    source = "from backend.utils.text_decoding import sniff_csv"
    assert not _handler_import_lines(source, "backend.core.agent")


def test_backend_core_and_utils_do_not_import_spreadsheet_handler() -> None:
    violations = []
    for directory in (_BACKEND / "core", _BACKEND / "utils"):
        for file in directory.rglob("*.py"):
            relative = file.relative_to(_BACKEND)
            package = ".".join(("backend", *relative.parent.parts))
            violations.extend(
                f"{relative.as_posix()}:{line}"
                for line in _handler_import_lines(file.read_text(encoding="utf-8"), package)
            )
    assert not violations, "\n".join(violations)
