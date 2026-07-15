# Plan 001: Align mapping preview with process for unmapped files

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 5aa6d8b..HEAD -- backend/core/renamer.py backend/handlers/conversion.py tests/test_renamer.py tests/test_renamer_mapping.py tests/test_conversion_mapping.py`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `5aa6d8b`, 2026-07-14

## Why this matters

In mapping mode, process keeps the original filename when a file is not in the mapping. Preview falls through to the pattern engine, so the UI shows renames that never happen on disk. With an empty pattern, unmapped files preview as `".jpg"` (extension-only), which is invalid and collides. Users approve wrong names.

## Current state

- `backend/handlers/conversion.py` — process path for mapping unmapped files (keeps original):

```python
# conversion.py ~982-987
if mapping_index:
    if mapping_index.lookup(p.name) is not None:
        nuevo_nombre = engine.aplicar(p, file_mapping=mapping_index)
    else:
        nuevo_nombre = p.name
```

- `backend/core/renamer.py` — `preview_lote` falls through to pattern when mapping miss:

```python
# renamer.py ~231-251
if file_mapping:
    mapped_name = self._resolve_mapped_output_name(ruta, file_mapping)
    if mapped_name is not None:
        resultados.append((str(ruta), mapped_name, True))
        continue
codigo = codigos_manuales.get(...)
# ... falls into self.aplicar(...) for unmapped
```

- Empty `patron` + `aplicar` yields extension-only name (`renamer.py:153-166`): clean to `""` then `+= ext` → `".jpg"`.
- Process already preserves `p.name` on miss; preview must match that (use `_preserve_original_name` for sanitization consistency with record-mode no-match at `renamer.py:238-241`).
- Existing tests: `tests/test_renamer_mapping.py`, `tests/test_renamer.py` (`test_preview_lote_*`). Conventions: pytest, 4-space, no new comments unless needed.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Python tests (scoped) | `cd backend && python -m pytest ../tests/test_renamer.py ../tests/test_renamer_mapping.py ../tests/test_conversion_mapping.py -v` | all pass |
| Lint | `npm run lint:python` | exit 0 |

## Scope

**In scope**:
- `backend/core/renamer.py` (`preview_lote` only for the mapping miss branch)
- `tests/test_renamer.py` and/or `tests/test_renamer_mapping.py` (new regression tests)
- Optionally `tests/test_conversion_mapping.py` if you add an end-to-end preview vs process parity assertion

**Out of scope**:
- Changing process path behavior for unmapped files
- Catalog / key_column rename parity (different code path)
- MappingIndex stem conflicts (plan 013)
- UI components

## Git workflow

- Branch: `advisor/001-mapping-preview-process-parity`
- Commits: Conventional Commits, e.g. `fix(renamer): preserve original name for unmapped mapping preview`
- Do NOT push or open a PR unless asked

## Steps

### Step 1: Write failing tests

Add tests that lock desired behavior:

1. **`preview_lote` with partial mapping**: one file mapped, one unmapped; unmapped suggested name must equal sanitized original (`_preserve_original_name` / original filename), third tuple element `False` for unmapped.
2. **Empty pattern + mapping miss**: `RenamerEngine("")` with `file_mapping` that does not include the file → must NOT return `".jpg"`; must return original name (with extension).
3. Optional: empty pattern + mapping hit still renames correctly.

Model after `tests/test_renamer.py::test_preview_lote_mapeo_parcial_no_consume_contador_por_fila` and `tests/test_renamer_mapping.py`.

**Verify**: run the new tests alone → they **FAIL** on current code (RED).

### Step 2: Fix `preview_lote` mapping miss

In `preview_lote`, when `file_mapping` is truthy and `_resolve_mapped_output_name` returns `None`, append:

```python
resultados.append((str(ruta), self._preserve_original_name(ruta), False))
continue
```

Do **not** fall through to `aplicar` for mapping mode misses.

Optional hardening (only if tests require): if `aplicar` would produce a name that is only an extension (empty stem after clean), prefer `_preserve_original_name` — but prefer fixing only the mapping-miss path to stay surgical.

**Verify**: same tests → PASS (GREEN).

### Step 3: Full scoped suite + lint

**Verify**:
```text
cd backend && python -m pytest ../tests/test_renamer.py ../tests/test_renamer_mapping.py ../tests/test_conversion_mapping.py -v
```
→ all pass

```text
npm run lint:python
```
→ exit 0

## Test plan

- New: unmapped under mapping preserves original name in `preview_lote`
- New: empty patron + unmapped under mapping does not yield `".jpg"`
- Existing mapping/apply tests must still pass (`test_no_match_falls_back_to_pattern` is about `aplicar` without relying on preview_lote — do not break `aplicar` unless a test forces it)

## Done criteria

- [ ] New regression tests exist and pass
- [ ] `preview_lote` with active `file_mapping` never applies pattern to unmapped files
- [ ] Scoped pytest suite above exits 0
- [ ] `npm run lint:python` exits 0
- [ ] No files outside in-scope list modified (`git status`)
- [ ] `plans/README.md` row 001 → DONE

## STOP conditions

- Process path no longer keeps `p.name` on mapping miss (then re-read conversion.py and re-plan parity target).
- Fix seems to require changing catalog/key_column preview paths.
- Verification fails twice after a reasonable fix.

## Maintenance notes

- Any new rename source (e.g. hybrid mapping+catalog) must define unmapped behavior once and share it between preview and process.
- Reviewer: confirm process still uses `p.name` (not `_preserve_original_name`) only if intentional — if process should also sanitize, that is a separate change; this plan only matches preview to process.
