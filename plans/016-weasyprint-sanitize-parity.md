# Plan 016: Apply sanitizer + deny-by-default URL fetcher to all WeasyPrint PDF paths

> **Executor instructions**: Follow step by step. Update `plans/README.md` when done.
>
> **Drift check**:
> `git diff --stat 1395878..HEAD -- backend/core/evidencia_volanteo/rendering.py backend/core/panel_aviso_corte/rendering.py backend/utils/html_sanitizer.py tests/test_evidencia_volanteo_html_sanitize.py tests/panel_aviso_corte tests/evidencia_volanteo`
>
> **Functional safety (HARD RULE)**: Generated PDFs for **normal** templates
> (bundled Jinja + validated images/logos as data-URIs or allowed local assets)
> must still produce a successful PDF with the same user-visible content
> (text, layout, embedded photos). Defense-in-depth must **not** strip
> legitimate `data:image/*` logos or break Jinja autoescape paths.
> Prefer reusing the already-shipped `render_pdf_html` hardening pattern.
> If a template relies on `base_url` file fetches for images, replace with the
> same data-URI pipeline already used elsewhere — do not leave open network
> fetch.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: MED (PDF rendering edge cases)
- **Depends on**: ideally after plan 014 if touching panel tests heavily — **none** hard
- **Category**: security
- **Planned at**: commit `1395878`, 2026-07-13

## Why this matters

`render_pdf_html` already does `sanitize_html_for_pdf` +
`_deny_external_url_fetcher` (data: only). Template-driven `render_pdf` in
evidencia and panel `write_pdf` still call `HTML(string=..., base_url=...)`
without sanitizer/fetcher. Autoescape reduces HTML injection, but WeasyPrint
can still fetch resources via `base_url` if markup regresses. Unify paths so
security fixes do not stay one-off.

## Functional invariants

| Invariant | How to verify |
|-----------|----------------|
| Evidencia PDF export still succeeds with fixture images | `tests/evidencia_volanteo/test_rendering.py` |
| Panel PDF export still succeeds | `tests/panel_aviso_corte/test_rendering.py` |
| `render_pdf_html` path unchanged in behavior | existing sanitize tests |
| DOCX export unchanged | do not touch DOCX branches except accidental |

## Current state

```python
# evidencia_volanteo/rendering.py — hardened
html_string = sanitize_html_for_pdf(html_string)
HTML(string=html_string, url_fetcher=_deny_external_url_fetcher).write_pdf(...)

# evidencia_volanteo/rendering.py render_pdf — open
HTML(string=html_string, base_url=str(_TEMPLATE_DIR)).write_pdf(...)

# panel_aviso_corte/rendering.py — open
HTML(string=html_string, base_url=str(_template_dir())).write_pdf(...)
```

Shared sanitizer: `backend/utils/html_sanitizer.py`.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Evidencia sanitize | `python -m pytest tests/test_evidencia_volanteo_html_sanitize.py -v --tb=short` | pass |
| Evidencia render | `python -m pytest tests/evidencia_volanteo -v --tb=short` | pass (needs WeasyPrint stack on Windows — if DLL missing, note env; do not skip silently without documenting) |
| Panel render | `python -m pytest tests/panel_aviso_corte -v --tb=short` | pass |
| Lint | `python -m ruff check backend/core/evidencia_volanteo backend/core/panel_aviso_corte backend/utils/html_sanitizer.py` | exit 0 |

## Scope

**In scope**:
- `backend/core/evidencia_volanteo/rendering.py` — `render_pdf`
- `backend/core/panel_aviso_corte/rendering.py` — PDF branch
- Optional extract shared helper
  `backend/utils/pdf_html.py` with `write_pdf_from_html(html) -> bytes` used by
  both (only if it reduces duplication without large move)
- Tests asserting sanitizer applied / external fetcher deny for template path

**Out of scope**:
- technical_reports / fichas HTML (no WeasyPrint today)
- Changing Jinja templates' visual layout
- Word/DOCX exporters

## Git workflow

- Branch: `advisor/016-weasyprint-sanitize-parity`
- Commit: `fix(security): sanitize all WeasyPrint HTML→PDF paths`

## Steps

### Step 1: Characterization — current PDF tests green

Run evidencia + panel rendering tests **before** changes. If WeasyPrint native
deps missing on the machine, document and still implement + run non-PDF unit
tests; do not claim DONE without either green PDF tests or explicit CI proof.

### Step 2: Extract or copy hardened write path

Create a small helper (preferred location:
`backend/utils/html_sanitizer.py` or next to it):

```python
def write_pdf_sanitized(html_string: str) -> bytes:
    html_string = sanitize_html_for_pdf(html_string)
    from weasyprint import HTML
    buf = BytesIO()
    HTML(string=html_string, url_fetcher=_deny_external_url_fetcher).write_pdf(buf)
    return buf.getvalue()
```

Move `_deny_external_url_fetcher` to shared module if duplicated.

### Step 3: Switch both open call sites to the helper

Remove bare `base_url=...` unless you prove a template **requires** file URL
loads that cannot be data-URIs. Existing panel/evidencia code already builds
data-URIs for images — prefer that.

If tests fail because CSS relative paths need `base_url`:

- Option A: pass `base_url` **and** a custom fetcher that allows only
  files under the template directory (allowlist) + data: — still deny http(s).
- Option B: inline critical CSS.

Do not restore open network fetch.

### Step 4: Tests

- Extend `tests/test_evidencia_volanteo_html_sanitize.py` or rendering tests:
  assert `sanitize_html_for_pdf` is applied on template PDF path (spy) **or**
  assert malicious `http://` img in injected HTML does not cause fetch
  (mock fetcher).
- Panel: one test that render_pdf still returns `%PDF` bytes for fixture panels.

**Verify**: pytest commands green.

## Test plan

| Case | Expected |
|------|----------|
| Normal evidencia PDF | success, non-empty |
| Normal panel PDF | success, non-empty |
| HTML with external http url | no network; PDF still builds or sanitized empty resource |
| Existing sanitize unit tests | pass |

## Done criteria

- [ ] No WeasyPrint `write_pdf` in backend without sanitize + restricted fetcher
- [ ] Panel + evidencia PDF tests pass (or CI-documented)
- [ ] No intentional layout regression in fixtures
- [ ] README DONE

## STOP conditions

- Removing `base_url` breaks CSS/fonts and allowlisted local fetcher cannot be
  done in S–M effort — STOP with failing test names.
- WeasyPrint version differences change fetcher API — match installed API;
  do not pin major upgrades in this plan.
- Temptation to weaken sanitizer to make a test pass — forbidden.

## Maintenance notes

- Any new WeasyPrint call site must use the shared helper.
- Reviewer: `rg "write_pdf|HTML\\(" backend` — all paths hardened.
