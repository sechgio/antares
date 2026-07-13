# Plan 013: Bundle `pymupdf`/`fitz` in the PyInstaller backend build

> **Executor instructions**: Follow step by step. Update `plans/README.md` when done.
>
> **Drift check**:
> `git diff --stat 1395878..HEAD -- backend/backend.spec backend/core/sellador_preview.py tests/test-build-size-guards.js`
>
> **Functional safety (HARD RULE)**: Source (unfrozen) behavior unchanged.
> Sellador/formatos page preview must keep working with installed pymupdf.
> Only packaging metadata changes so the **frozen** backend includes the
> already-declared runtime dependency. Do not remove `pypdf` or rewrite
> preview rendering.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (larger binary; no algorithm change)
- **Depends on**: none
- **Category**: migration
- **Planned at**: commit `1395878`, 2026-07-13

## Why this matters

`sellador_preview` imports `fitz` lazily via `_require_fitz()`. PyInstaller
often misses lazy imports. `backend.spec` `collect_submodules` lists pandas,
openpyxl, weasyprint, PIL, lxml, pypdf, jinja2, jsonschema, docx — **not**
`fitz`/`pymupdf`. Packaged installs can fail sellador/formatos page raster
with "PyMuPDF no está instalado" even though `pyproject.toml` declares
`pymupdf`. Adding collect fixes packaging without changing preview logic.

## Functional invariants

| Invariant | How to verify |
|-----------|----------------|
| `import fitz` / `_require_fitz()` API unchanged | No code change required in sellador_preview except optional comment |
| pypdf stamp/apply path unchanged | Do not touch `sellador.py` stamp logic |
| Dev `pip install -e .` still works | pymupdf already a dep |

## Current state

```python
# backend/core/sellador_preview.py
def _require_fitz():
    try:
        import fitz  # pymupdf
    except ImportError as exc:
        msg = "PyMuPDF no está instalado. Ejecuta: pip install pymupdf"
        raise ValueError(msg) from exc
    return fitz
```

```python
# backend/backend.spec ~47-48
for _pkg in ('pandas', 'openpyxl', 'weasyprint', 'PIL', 'lxml', 'pypdf',
             'jinja2', 'jsonschema', 'docx'):
    _hidden += collect_submodules(_pkg)
```

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Sellador unit tests | `python -m pytest tests/test_sellador_handler.py -v --tb=short` | all pass |
| Spec syntax check | `python -c "import pathlib; print(pathlib.Path('backend/backend.spec').read_text()[:200])"` | file readable |
| Optional local freeze | `npm run build:backend` | exit 0 **if** PyInstaller installed; if not, skip and note in PR |
| Size guards (if edited) | `node tests/test-build-size-guards.js` | exit 0 |

## Scope

**In scope**:
- `backend/backend.spec` — add `fitz` and/or `pymupdf` to collect list; add
  explicit hiddenimports if hooks need it
- `tests/test-build-size-guards.js` — only if it enumerates expected packages
  and would fail without update
- Optional one-line comment in `sellador_preview.py` that freeze needs fitz in
  spec (no logic change)

**Out of scope**:
- Replacing pymupdf with pypdf for raster
- Changing DPI / max_width defaults (other plans)
- Frontend sellador UI

## Git workflow

- Branch: `advisor/013-pyinstaller-bundle-pymupdf`
- Commit: `fix(build): include pymupdf/fitz in backend PyInstaller collect`

## Steps

### Step 1: Extend collect_submodules

In `backend/backend.spec`, add `'fitz'` and `'pymupdf'` to the package tuple
(or a second try/except collect like psutil if import name differs by version).

If PyInstaller docs/hooks for pymupdf recommend `collect_all('pymupdf')`, use
that **only** if collect_submodules alone is known insufficient — prefer
minimal change matching existing style first.

### Step 2: Align size guards

If `tests/test-build-size-guards.js` lists backend hidden modules, add pymupdf
there consistently. Do not invent new size budgets that fail CI; only keep
lists in sync.

### Step 3: Verify unfrozen path still works

**Verify**: `python -m pytest tests/test_sellador_handler.py -v` green.

If you can run `npm run build:backend` locally, smoke-import frozen binary or
document "build succeeded" in the plan status note. If PyInstaller missing,
do not install globally without user consent — leave as manual verification
item in PR description.

## Test plan

| Case | Expected |
|------|----------|
| Sellador handler tests | pass |
| Spec contains fitz/pymupdf | `rg "fitz|pymupdf" backend/backend.spec` matches |
| Optional frozen smoke | sellador_render_page works in packaged app |

## Done criteria

- [ ] `backend.spec` collects pymupdf/fitz
- [ ] Sellador tests still pass
- [ ] No preview algorithm changes
- [ ] README DONE

## STOP conditions

- Collect balloons installer beyond existing hard size guard and CI fails —
  report numbers; do not silently raise limits without product OK.
- `collect_submodules('fitz')` throws on the build machine — try documented
  pymupdf hook; if still blocked, STOP with logs.

## Maintenance notes

- Any new lazy-import heavy native dep needs a matching `backend.spec` entry.
- Dual PDF stack (pypdf + pymupdf) is intentional — document only, do not merge.
