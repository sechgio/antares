# Informes Tecnicos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full native "Informes tecnicos" tool in COSMO Desktop with JSON persistence, CSV/XLSX import, React editing/preview, and PDF export through Electron IPC.

**Architecture:** Implement the domain in pure Python services under `backend/core/technical_reports`, expose small JSON-RPC handlers, and add a focused React module under `frontend/src/components/technical-reports`. PDF export asks Python to render HTML and Electron to convert it with the existing `html_to_pdf` native method.

**Tech Stack:** Python 3.10, dataclasses, openpyxl, Jinja2, pytest, React 18, TypeScript, Vite/Vitest, lucide-react, Electron IPC.

---

### Task 1: Backend Domain Models

**Files:**
- Create: `backend/core/technical_reports/__init__.py`
- Create: `backend/core/technical_reports/models.py`
- Test: `tests/test_technical_reports_models.py`

- [ ] **Step 1: Write the failing test**

```python
from backend.core.technical_reports.models import TechnicalReport, create_empty_report


def test_empty_report_has_nested_defaults():
    report = create_empty_report(1)

    assert report["id"] == "RPT-0001"
    assert report["metadata"]["informe_id"] == 1
    assert report["inspeccion"]["caja_registro"] == "unchecked"
    assert report["valvulas"]["impulsion"]["2"] == 0
    assert report["canastillas"]["aduccion"]["14"] == 0


def test_normalize_report_patches_legacy_canastillas():
    report = TechnicalReport.normalize({
        "id": "RPT-0007",
        "metadata": {"informe_id": 7},
        "header": {"tipo": "ELEVADO"},
        "inspeccion": None,
        "valvulas": {},
        "canastillas": {"aduccion": {"2": 1}},
    })

    assert report["inspeccion"]["marco_tapa"] == "unchecked"
    assert report["canastillas"]["aduccion"]["14"] == 0
    assert report["header"]["volumen"] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_technical_reports_models.py -v`
Expected: FAIL because `backend.core.technical_reports.models` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `models.py` with constants for check states, field defaults, `report_id_from_number()`, `create_empty_report()`, and `TechnicalReport.normalize(data)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_technical_reports_models.py -v`
Expected: PASS.

### Task 2: JSON Database

**Files:**
- Create: `backend/core/technical_reports/database.py`
- Test: `tests/test_technical_reports_database.py`

- [ ] **Step 1: Write the failing test**

```python
from backend.core.technical_reports.database import TechnicalReportsDB
from backend.core.technical_reports.models import create_empty_report


def test_crud_roundtrip_uses_json_file(tmp_path):
    db = TechnicalReportsDB(tmp_path / "technical_reports.json")
    report = create_empty_report(1)

    created = db.create(report)
    created["header"]["cs"] = "SUR"
    updated = db.update("RPT-0001", created)

    reloaded = TechnicalReportsDB(tmp_path / "technical_reports.json")
    assert updated["header"]["cs"] == "SUR"
    assert reloaded.get("RPT-0001")["header"]["cs"] == "SUR"
    assert reloaded.delete("RPT-0001") is True
    assert reloaded.get_all() == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_technical_reports_database.py -v`
Expected: FAIL because `database.py` does not exist.

- [ ] **Step 3: Write minimal implementation**

Implement a thread-safe JSON dictionary store with atomic save via temporary file and `Path.replace()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_technical_reports_database.py -v`
Expected: PASS.

### Task 3: CSV/XLSX Importer

**Files:**
- Create: `backend/core/technical_reports/importer.py`
- Test: `tests/test_technical_reports_importer.py`

- [ ] **Step 1: Write the failing test**

```python
import base64
from io import BytesIO

from openpyxl import Workbook

from backend.core.technical_reports.importer import import_reports_from_bytes, normalize_header_value


def test_csv_semicolon_import_maps_human_headers():
    content = (
        "Nro Informe;Centro de Servicio;Codigo Infraestructura;Tipo;Volumen;Caja Registro;Mes\n"
        "3;SUR;RES-01;ELEVADO;150;X;5\n"
    ).encode("utf-8")

    reports = import_reports_from_bytes("datos.csv", content)

    assert reports[0]["id"] == "RPT-0003"
    assert reports[0]["header"]["cs"] == "SUR"
    assert reports[0]["metadata"]["mes"] == "MAYO"
    assert reports[0]["inspeccion"]["caja_registro"] == "normal"


def test_xlsx_import_reads_rows():
    wb = Workbook()
    ws = wb.active
    ws.append(["Informe", "CS", "Codigo", "Tipo", "Volumen", "Descarga"])
    ws.append([4, "NORTE", "CIS-02", "CISTERNA", 80, "MALO"])
    buf = BytesIO()
    wb.save(buf)

    reports = import_reports_from_bytes("datos.xlsx", buf.getvalue())

    assert reports[0]["id"] == "RPT-0004"
    assert reports[0]["header"]["tipo"] == "CISTERNA"
    assert reports[0]["inspeccion"]["descarga"] == "critico"


def test_normalize_header_value_removes_accents_and_separators():
    assert normalize_header_value("Código de Infraestructura") == "codigoinfraestructura"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_technical_reports_importer.py -v`
Expected: FAIL because `importer.py` does not exist.

- [ ] **Step 3: Write minimal implementation**

Port the relevant column mapping, CSV dialect detection, XLSX reader, status parsing, safe int/string conversion, month resolution, and flat-to-nested transform from the reference.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_technical_reports_importer.py -v`
Expected: PASS.

### Task 4: HTML Rendering

**Files:**
- Create: `backend/core/technical_reports/rendering.py`
- Create: `backend/templates/technical_reports/informe_tecnico.html`
- Modify: `pyproject.toml`
- Test: `tests/test_technical_reports_rendering.py`

- [ ] **Step 1: Write the failing test**

```python
from backend.core.technical_reports.models import create_empty_report
from backend.core.technical_reports.rendering import render_report_html, render_consolidated_html


def test_render_report_html_contains_report_fields():
    report = create_empty_report(2)
    report["header"]["codigo_infraestructura"] = "RES-99"

    html = render_report_html(report)

    assert "Informe Tecnico" in html or "Informe Técnico" in html
    assert "RES-99" in html
    assert "page-container" in html


def test_render_consolidated_html_renders_multiple_pages():
    reports = [create_empty_report(1), create_empty_report(2)]

    html = render_consolidated_html(reports)

    assert html.count("page-container") == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_technical_reports_rendering.py -v`
Expected: FAIL because renderer/template does not exist.

- [ ] **Step 3: Write minimal implementation**

Add `Jinja2>=3.1.0` to `pyproject.toml`, render the reference-inspired A4 template from `backend/templates/technical_reports`, and support optional `logo_left`/`logo_right` data URLs.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_technical_reports_rendering.py -v`
Expected: PASS.

### Task 5: IPC Handlers

**Files:**
- Modify: `backend/handlers.py`
- Test: `tests/test_technical_reports_handlers.py`

- [ ] **Step 1: Write the failing test**

```python
import base64

from backend.handlers import HANDLERS


def test_technical_reports_handlers_are_registered(monkeypatch, tmp_path):
    from backend.core.technical_reports import database as db_module

    monkeypatch.setattr(db_module, "DEFAULT_DB_PATH", tmp_path / "technical_reports.json")
    assert "technical_reports_list" in HANDLERS
    assert "technical_reports_import_file" in HANDLERS


def test_import_file_handler_imports_csv(monkeypatch, tmp_path):
    from backend.core.technical_reports import database as db_module

    monkeypatch.setattr(db_module, "DEFAULT_DB_PATH", tmp_path / "technical_reports.json")
    content = base64.b64encode(b"Informe;CS;Codigo;Tipo\n1;SUR;RES-1;ELEVADO\n").decode("ascii")

    result = HANDLERS["technical_reports_import_file"]({"filename": "datos.csv", "content_b64": content})

    assert result["imported_count"] == 1
    assert HANDLERS["technical_reports_list"]({"summary": True})["reports"][0]["id"] == "RPT-0001"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_technical_reports_handlers.py -v`
Expected: FAIL because handlers are not registered.

- [ ] **Step 3: Write minimal implementation**

Add handler methods that delegate to the database/importer/rendering services, decode base64 import content, filter summaries, and return clear errors through exceptions.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_technical_reports_handlers.py -v`
Expected: PASS.

### Task 6: Frontend API and Navigation

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`
- Create: `frontend/src/components/technical-reports/index.ts`
- Create: `frontend/src/components/technical-reports/TechnicalReportsApp.tsx`
- Create: `frontend/src/components/technical-reports/types.ts`
- Create: `frontend/src/components/technical-reports/api.ts`
- Test: `frontend/src/__tests__/api.test.ts`
- Test: `frontend/src/__tests__/App.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add API assertions for `technicalReportsList`, `technicalReportsImportFile`, and `technicalReportsRenderHtml`. Add an App test that clicks "Informes tecnicos" and expects the heading.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/__tests__/api.test.ts src/__tests__/App.test.tsx`
Expected: FAIL because the API methods and tab do not exist.

- [ ] **Step 3: Write minimal implementation**

Add typed API methods, a lazy tab, command palette item, sidebar item with a lucide icon, and a placeholder tool shell that loads summaries.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/api.test.ts src/__tests__/App.test.tsx`
Expected: PASS.

### Task 7: Full Frontend Tool

**Files:**
- Create: `frontend/src/components/technical-reports/DatabasePanel.tsx`
- Create: `frontend/src/components/technical-reports/FormPanel.tsx`
- Create: `frontend/src/components/technical-reports/PreviewPanel.tsx`
- Create: `frontend/src/components/technical-reports/technical-reports.css`
- Modify: `frontend/src/components/technical-reports/TechnicalReportsApp.tsx`

- [ ] **Step 1: Write the failing test**

Use the App navigation test as integration guard and add a component assertion that the empty state renders "Importar".

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/App.test.tsx`
Expected: FAIL until the full module renders stable UI.

- [ ] **Step 3: Write minimal implementation**

Implement the three-panel UI, file import through base64, selection/edit/save/delete/clear flows, React A4 preview, logo uploads, individual PDF export, and consolidated PDF export.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/__tests__/App.test.tsx`
Expected: PASS.

### Task 8: Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused backend tests**

Run: `python -m pytest tests/test_technical_reports_models.py tests/test_technical_reports_database.py tests/test_technical_reports_importer.py tests/test_technical_reports_rendering.py tests/test_technical_reports_handlers.py -v`
Expected: PASS.

- [ ] **Step 2: Run focused frontend tests**

Run: `cd frontend && npx vitest run src/__tests__/api.test.ts src/__tests__/App.test.tsx`
Expected: PASS.

- [ ] **Step 3: Run typecheck and build**

Run: `npm run typecheck:frontend`
Expected: PASS.

Run: `npm run build:frontend`
Expected: PASS.

- [ ] **Step 4: Run full regression if focused checks are clean**

Run: `npm test`
Expected: PASS or document unrelated pre-existing failures with command output.
