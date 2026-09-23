from __future__ import annotations

import pathlib
import re
from typing import get_args


def _read_frontend_interface(path: pathlib.Path, interface: str) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    m = re.search(rf"(?:export\s+)?interface {interface}\s*\{{", text)
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
    if match:
        return set(re.findall(r"'([^']+)'", match.group(1)))
    for m in re.finditer(rf"(?:import|export)\s+type\s*\{{[^}}]*\b{alias}\b[^}}]*\}}\s*from\s*['\"]([^'\"]+)['\"]", text):
        rel = m.group(1)
        target = (path.parent / f"{rel}.ts").resolve()
        if not target.exists():
            target = (path.parent / rel / "index.ts").resolve()
        if target.exists():
            found = _read_frontend_literals(target, alias)
            if found:
                return found
    return set()


def _read_backend_keys(typeddict: type) -> set[str]:
    return set(typeddict.__required_keys__)


def _read_frontend_const(path: pathlib.Path, name: str) -> str:
    text = path.read_text(encoding="utf-8")
    m = re.search(rf"export const {name}\s*=\s*'([^']*)'", text)
    assert m, f"{name} missing in {path}"
    return m.group(1)


def test_ficha_schema_parity() -> None:
    frontend = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "src" / "components" / "fichas-tecnicas" / "types.ts"
    backend = pathlib.Path(__file__).resolve().parent.parent / "backend" / "core" / "fichas_tecnicas" / "types.py"
    assert frontend.exists() and backend.exists()
    from backend.core.fichas_tecnicas.types import FichaDocument, FichaStatus

    fe_fields = _read_frontend_interface(frontend, "FichaTecnica")
    assert set(fe_fields) == _read_backend_keys(FichaDocument)
    assert set(get_args(FichaStatus)) == set(re.findall(r"'([^']+)'", fe_fields["status"]))


def test_informe_schema_parity() -> None:
    frontend = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "src" / "components" / "informes-v2" / "types.ts"
    backend = pathlib.Path(__file__).resolve().parent.parent / "backend" / "core" / "informes_v2" / "types.py"
    assert frontend.exists() and backend.exists()
    from backend.core.informes_v2.models import PLANTILLA_VALUES, R2_TITULO_LINEA1, R2_TITULO_LINEA2
    from backend.core.informes_v2.types import (
        InformeDiameterRow,
        InformeHeader,
        InformeMedidas,
        InformeStatus,
        InformeV2Document,
        InspeccionRow,
        PlantillaId,
        ReservoirType,
        Reservorios2Data,
        Reservorios2Medidas,
        Reservorios2Row,
    )

    fe_fields = _read_frontend_interface(frontend, "InformeV2")
    assert set(fe_fields) == _read_backend_keys(InformeV2Document)
    assert set(_read_frontend_interface(frontend, "ReportHeader")) == _read_backend_keys(InformeHeader)
    assert set(_read_frontend_interface(frontend, "MedidasData")) == _read_backend_keys(InformeMedidas)
    assert set(_read_frontend_interface(frontend, "DiameterRow")) == _read_backend_keys(InformeDiameterRow)
    assert set(_read_frontend_interface(frontend, "InspeccionRow")) == _read_backend_keys(InspeccionRow)
    assert set(_read_frontend_interface(frontend, "Reservorios2Row")) == _read_backend_keys(Reservorios2Row)
    assert set(_read_frontend_interface(frontend, "Reservorios2Medidas")) == _read_backend_keys(Reservorios2Medidas)
    assert set(_read_frontend_interface(frontend, "Reservorios2Data")) == _read_backend_keys(Reservorios2Data)
    assert set(get_args(PlantillaId)) == _read_frontend_literals(frontend, "PlantillaId")
    assert set(get_args(PlantillaId)) == set(PLANTILLA_VALUES)
    assert set(get_args(InformeStatus)) == _read_frontend_literals(frontend, "ReportStatus")
    assert set(get_args(ReservoirType)) == _read_frontend_literals(frontend, "ReservoirType")
    assert _read_frontend_const(frontend, "R2_TITULO_LINEA1") == R2_TITULO_LINEA1
    assert _read_frontend_const(frontend, "R2_TITULO_LINEA2") == R2_TITULO_LINEA2


def test_technical_report_schema_parity() -> None:
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
    src_dir = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "src"
    texts = [(src_dir / "api.ts").read_text(encoding="utf-8")]
    texts += [p.read_text(encoding="utf-8") for p in (src_dir / "api").glob("*.ts")]
    assert any("Record<string, unknown>" in text or "JsonValue" in text for text in texts)
