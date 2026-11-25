from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from check_any_guard import scan_text


def test_fixture_negativo_limpio():
    text = (
        "from typing import TypedDict\n"
        "\n"
        "class Payload(TypedDict):\n"
        "    nombre: str\n"
        "\n"
        "def parse(data: Payload) -> str:\n"
        "    return data['nombre']\n"
    )
    assert scan_text(text) == [], "el fixture bien tipado no debe disparar la guarda"


def test_fixture_positivo_dispara():
    text = "def parse(data: dict[str, Any]) -> None:\n    pass\n"
    hits = scan_text(text)
    assert len(hits) == 1, "el fixture con dict[str, Any] desnudo debe disparar la guarda"
    line_no, _line, occurrences, allowlisted = hits[0]
    assert line_no == 1
    assert occurrences == 1
    assert allowlisted is False


def test_varias_ocurrencias_en_una_linea_cuentan_todas():
    text = "def f(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]: ...\n"
    hits = scan_text(text)
    assert len(hits) == 1
    assert hits[0][2] == 3, "cada ocurrencia de la línea se cuenta por separado"


def test_allowlist_exime():
    for marker in (
        "# allowlist: dict[str, Any]",
        "# type: ignore",
        "# noqa",
    ):
        text = f"def parse(data: dict[str, Any]) -> None: ...  {marker}\n"
        hits = scan_text(text)
        assert len(hits) == 1
        assert hits[0][3] is True, f"el marcador {marker!r} exime la línea"


def test_sin_any_no_hay_hits():
    assert scan_text("x = 1\n") == []


def test_control_de_habla_sobre_backend_real():
    backend = Path(__file__).resolve().parent.parent / "backend"
    textos = list(backend.rglob("*.py"))
    assert len(textos) > 50, "el backend real tiene decenas de archivos: si la lista sale corta, la búsqueda está rota"
    total_hits = 0
    for path in textos:
        total_hits += len(scan_text(path.read_text(encoding="utf-8", errors="ignore")))
    assert total_hits > 0, (
        "el backend real contiene ocurrencias conocidas de dict[str, Any]: "
        "cero hits significa que el patrón de la guarda quedó mudo, no que el código está limpio"
    )
