# Plan 013 — Spike notes: replace vulnerable `xlsx`

**Status**: SPIKE DONE (notes only; no product-code pilot)  
**Branch**: `advisor/013-xlsx-migration-spike`  
**Base**: `bd0c48f` (newer than plan’s `3174e83`)  
**Dep still present**: `frontend/package.json` → `"xlsx": "^0.18.5"`  
**Date**: 2026-07-13

## Drift check

```text
git diff --stat 3174e83..HEAD -- frontend/package.json frontend/src/
```

- `frontend/package.json`: unchanged vs that range (xlsx still declared).
- `frontend/src/`: unrelated AutoIMG/conversion/history edits only — **no** xlsx removal.
- Proceed: OK.

## npm audit (`cd frontend && npm audit`)

| Item | Value |
|------|--------|
| Package | `xlsx *` (direct dep) |
| Severity | **high** |
| Advisories | [GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) Prototype Pollution (`<0.19.3`); [GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9) ReDoS (`<0.20.2`) |
| Fix available | **No** (community `xlsx` / SheetJS CE) |
| Audit totals (frontend) | 6 vulns: 1 low, 2 moderate, 3 high |

Parsing untrusted workbooks in the Electron **renderer** amplifies both findings.

---

## 1. Call-site inventory (`rg xlsx frontend/src`)

### A. Real `import('xlsx')` / `import("xlsx")` — library usage

| # | File | Read / Write | Renderer? | API surface used | Output consumed as | Frontend tests |
|---|------|--------------|-----------|------------------|--------------------|----------------|
| 1 | `frontend/src/components/padron/excel.ts` | **Read** | Yes (dynamic import) | `XLSX.read(arrayBuffer)`, `sheet_to_json(..., { defval:'', raw:false })` per sheet | `ParseResult` (`records`, `importedItems`, `importedWaterCutItems`) → `PadronView` | **None** targeting `parseWorkbook` |
| 2 | `frontend/src/components/volantes/utils/import.ts` → `importSpreadsheet` | **Read** | Yes | `read({ cellDates:true })`, `sheet_to_json` header:1 + object mode `raw:true` | `{ records, warnings }` → `VolantesView` | **None** |
| 3 | `frontend/src/components/volantes/utils/import.ts` → `exportTemplateWorkbook` | **Write** | Yes | `json_to_sheet`, `book_new`, `book_append_sheet`, `writeFile("plantilla-volantes.xlsx")` | Downloads template to disk | **None** |
| 4 | `frontend/src/components/preview-panel/PreviewPanelView.tsx` → `parseFile` | **Read** | Yes | `read(binary)`, `sheet_to_json({ header:1, raw:true, dateNF })` + local Excel serial→date | `headers` + row objects + field auto-map | `PreviewPanelView.test.tsx` only asserts file input `accept`; **does not** exercise parse |

**UI wiring (accept strings only — not library imports):**

- `PadronView.tsx` — `.xlsx,.xls,.csv` → calls `parseWorkbook`
- `VolantesView.tsx` — `.xlsx,.xls,.csv` → `importSpreadsheet` / `exportTemplateWorkbook`
- `UbicacionesView.tsx` — `.xlsx,.xls` accept/drop — **does not import `xlsx`**; sends file path to Python
- `TechnicalReportsApp.tsx` / `FichasTecnicasApp.tsx` — `.csv,.xlsx` accept — Python/`openpyxl` via IPC
- `panel-aviso-corte/components/ExcelImporter.tsx` — `.xlsx` → base64 → `api.panelAvisoCorteParseExcel` (Python)

### B. Already on Python (`openpyxl` / pandas) — no frontend `xlsx` dep

| Area | Mechanism | Notes |
|------|-----------|--------|
| Ubicaciones | Path via Electron → `backend/handlers/ubicaciones.py` (`pd.read_excel(..., engine="openpyxl")`) | Preview/generate; cache in handler |
| Panel Aviso de Corte | `xlsx_b64` → `panel_aviso_corte_parse_excel` → `core/panel_aviso_corte/importer.py` | Strongest reference implementation for strategy A |
| Conversion / DB mapping | Path → `core/database.py` `pd.read_excel` / `to_excel` | Also writes xlsx from Python |
| Fichas técnicas | `core/fichas_tecnicas/importer.py` `load_workbook` | |
| Technical reports | `core/technical_reports/importer.py` `load_workbook` | |

### C. Sample fixtures

| Location | Role |
|----------|------|
| `tests/aviso.xlsx` | Golden-ish fixture for panel aviso de corte rendering tests |
| In-memory openpyxl builders | `tests/panel_aviso_corte/test_importer.py` (`_build_xlsx`) |
| Pytest tmp xlsx | `tests/test_database.py`, `tests/test_conversion_mapping.py` (generated, not committed) |
| `formatos/` | No committed `.xlsx` templates found in this worktree |
| Frontend | No committed padron/volantes/preview golden `.xlsx` |

---

## 2. Strategy evaluation

### A — Route reads through Python (`openpyxl`) via IPC

| | |
|--|--|
| Pros | Matches existing desktop architecture; removes untrusted parse from renderer; `openpyxl` already bundled (PyInstaller collects submodules); panel-aviso-corte proves the pattern (b64 → rows/columns JSON) |
| Cons | New IPC methods + contract tests; date/number typing must be pinned (STOP condition); CSV paths that currently share JS parse need a plan; write path for volantes template is separate |
| Effort | **M–L** (~3 read sites + 1 write). Shared helper like `parse_excel_to_sheet_map` + thin front adapters: ~2–4 days engineering + fixture work. Padron aliases stay in TS if IPC returns stringified row maps. |
| Risk | MED — cell typing / `raw`/`cellDates` parity |

### B — Replace with `exceljs` (or similar) in renderer

| | |
|--|--|
| Pros | Stays in JS; read+write in one lib; smaller IPC surface |
| Cons | Still parses in privileged renderer; API not drop-in vs SheetJS (`sheet_to_json` semantics); does not fix “untrusted Excel in renderer” threat model |
| Effort | **M** (~1–2 days for 3 reads + write rewrite + vitest) |
| Risk | MED — date serials / blankrows / header normalization drift |

### C — SheetJS Pro (paid)

| | |
|--|--|
| Pros | Minimal code churn if API-compatible; addresses CE advisories |
| Cons | License cost + procurement; still renderer-side parse unless combined with sandbox; **do not purchase in-plan** |
| Effort | **S** code / **ops** for license |
| Risk | LOW code, MED process |

### Recommendation

**Prefer strategy A (Python/openpyxl IPC) for all reads.**

Rationale: Antares already parses Excel safely on the Python side for Ubicaciones, Panel Aviso de Corte, Conversion, Fichas, and Technical Reports. Keeping a second vulnerable JS parser only for Padron / Volantes / Preview Panel is inconsistent and leaves the high advisories in the renderer. Strategy B is a fallback if IPC latency or offline-edge cases block A for a specific module. Strategy C only if the operator wants minimal diff and approves a commercial license.

**Write path (Volantes `exportTemplateWorkbook`)**: decide separately per plan STOP note — either Python `openpyxl`/`to_excel` via IPC/dialog save, or `exceljs` write-only after reads migrate (so `xlsx` can be removed). Do not block read migration on write.

**Effort to clear advisories end-to-end (A)**: estimate **M–L** (one shared IPC parse + three front adapters + write replacement + golden fixtures). Spike itself: **S** (this document).

---

## 3. Pilot call site & rollout order

### Pilot (suggested; **not implemented** in this spike)

**Suggested pilot**: `PreviewPanelView.parseFile` — smallest read surface (first sheet → header row + objects), already has a light component test shell, less alias/date business logic than Padron/Volantes.

**Why not piloted now**: no golden fixture or parse-level vitest asserting object shape; STOP condition (date/number typing) is easy to trip with `raw:true` + Excel serial conversion. Plan prefers notes-only for spike safety.

**Alternate pilot if operator wants a coded trial next**: add IPC `excel_parse_matrix` returning `{ sheetNames, sheets: { [name]: unknown[][] } }` and wrap PreviewPanel only — preserve `headers`/`data` structure before touching Padron/Volantes.

### Rollout order (after spike approval)

1. **Shared IPC** — generic parse (rows as strings or matrix) modeled on `panel_aviso_corte_parse_excel`; contract tests with openpyxl-built bytes.
2. **Preview Panel** — pilot adapter + vitest with tmp-generated xlsx.
3. **Padron `excel.ts`** — keep alias/mapping in TS; feed `sheetMap` from IPC (`raw:false` string cells).
4. **Volantes `importSpreadsheet`** — careful parity for `cellDates` / `normalizeDateInput` / `normalizeTimeInput`.
5. **Volantes `exportTemplateWorkbook`** — Python or exceljs write-only; then drop `xlsx` from `frontend/package.json`.
6. Confirm `rg` zero library imports + `npm audit` clean of xlsx advisories.

### Already migrated (no work)

Ubicaciones, Panel Aviso de Corte, Conversion DB, Fichas técnicas, Technical reports.

---

## Spike DONE checklist

- [x] Inventory + recommended strategy written
- [x] Operator can decide A / B / C
- [x] `npm audit` xlsx status recorded
- [x] No app-wide `xlsx` removal
- [x] No product code change (pilot deferred)

## Migration DONE (later — not this PR)

- [ ] No `xlsx` dependency
- [ ] All former call sites behavior-preserved with tests
- [ ] `plans/README.md` → DONE (owner: reviewer/advisor; skipped here)
