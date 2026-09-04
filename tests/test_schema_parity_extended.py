"""Keep backend report contracts aligned with their frontend counterparts."""

from __future__ import annotations

import pathlib
import re
from typing import get_args


def _read_frontend_interface(path: pathlib.Path, interface: str) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    m = re.search(rf"export interface {interface}\s*\{{", text)
    if not m:
        return {}

    fields: dict[str, str] = {}
    depth = 0
    for line in text[m.end():].splitlines():
        if depth == 0:
            field = re.match(r"^\s*([A-Za-z_]\w*)\s*(\??):\s*(.*)$", line)
            if field:
                fields[field.group(1)] = field.group(3).strip()
        depth += line.count("{") - line.count("}")
        if depth < 0:
            break
    return fields


def _read_frontend_literals(path: pathlib.Path, alias: str) -> set[str]:
    text = path.read_text(encoding="utf-8")
    match = re.search(rf"export type {alias}\s*=\s*([^;]+);", text, re.DOTALL)
    return set(re.findall(r"'([^']+)'", match.group(1))) if match else set()


def _read_backend_keys(typeddict: type) -> set[str]:
    return set(typeddict.__required_keys__)


def test_ficha_schema_parity() -> None:
    """Ficha Técnica frontend and backend should share their core fields."""
    frontend = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "src" / "components" / "fichas-tecnicas" / "types.ts"
    backend = pathlib.Path(__file__).resolve().parent.parent / "backend" / "core" / "fichas_tecnicas" / "types.py"
    assert frontend.exists() and backend.exists()
    from backend.core.fichas_tecnicas.types import FichaDocument, FichaStatus

    fe_fields = _read_frontend_interface(frontend, "FichaTecnica")
    assert set(fe_fields) == _read_backend_keys(FichaDocument)
    assert set(get_args(FichaStatus)) == set(re.findall(r"'([^']+)'", fe_fields["status"]))


def test_informe_schema_parity() -> None:
    """Informe V2 frontend and backend should expose the same core fields."""
    frontend = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "src" / "components" / "informes-v2" / "types.ts"
    backend = pathlib.Path(__file__).resolve().parent.parent / "backend" / "core" / "informes_v2" / "types.py"
    assert frontend.exists() and backend.exists()
    from backend.core.informes_v2.types import (
        InformeDiameterRow,
        InformeHeader,
        InformeMedidas,
        InformeStatus,
        InformeV2Document,
        ReservoirType,
    )

    fe_fields = _read_frontend_interface(frontend, "InformeV2")
    assert set(fe_fields) == _read_backend_keys(InformeV2Document)
    assert set(_read_frontend_interface(frontend, "ReportHeader")) == _read_backend_keys(InformeHeader)
    assert set(_read_frontend_interface(frontend, "MedidasData")) == _read_backend_keys(InformeMedidas)
    assert set(_read_frontend_interface(frontend, "DiameterRow")) == _read_backend_keys(InformeDiameterRow)
    assert set(get_args(InformeStatus)) == _read_frontend_literals(frontend, "ReportStatus")
    assert set(get_args(ReservoirType)) == _read_frontend_literals(frontend, "ReservoirType")


def test_technical_report_schema_parity() -> None:
    """Technical report frontend and backend should expose matching fields."""
    frontend = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "src" / "components" / "technical-reports" / "types.ts"
    backend = pathlib.Path(__file__).resolve().parent.parent / "backend" / "core" / "technical_reports" / "types.py"
    assert frontend.exists(), f"frontend types missing: {frontend}"
    assert backend.exists(), f"backend types missing: {backend}"
    from backend.core.technical_reports.types import (
        ReservoirType,
        TechnicalCanastillas,
        TechnicalHeader,
        TechnicalInspection,
        TechnicalMedidas,
        TechnicalMetadata,
        TechnicalReportDocument,
        TechnicalStatus,
        TechnicalValvulas,
    )

    assert set(_read_frontend_interface(frontend, "TechnicalReport")) == _read_backend_keys(TechnicalReportDocument)
    assert set(_read_frontend_interface(frontend, "ReportMetadata")) == _read_backend_keys(TechnicalMetadata)
    assert set(_read_frontend_interface(frontend, "ReportHeader")) == _read_backend_keys(TechnicalHeader)
    assert set(_read_frontend_interface(frontend, "InspeccionDescripcion")) == _read_backend_keys(TechnicalInspection)
    assert set(_read_frontend_interface(frontend, "ValvulasData")) == _read_backend_keys(TechnicalValvulas)
    assert set(_read_frontend_interface(frontend, "CanastillasData")) == _read_backend_keys(TechnicalCanastillas)
    assert set(_read_frontend_interface(frontend, "MedidasData")) == _read_backend_keys(TechnicalMedidas)
    assert set(get_args(TechnicalStatus)) == _read_frontend_literals(frontend, "ReportStatus")
    assert set(get_args(ReservoirType)) == _read_frontend_literals(frontend, "ReservoirType")


def test_api_jsonvalue_type_exists() -> None:
    """The frontend IPC layer should use a JSON-compatible parameter type."""
    api_path = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "src" / "api.ts"
    text = api_path.read_text(encoding="utf-8")
    assert "Record<string, unknown>" in text or "JsonValue" in text
