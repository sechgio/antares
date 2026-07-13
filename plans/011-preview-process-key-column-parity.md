# Plan 011: Make rename preview and process use the same key-column resolution

> **Executor instructions**: Follow step by step. **This plan must not change
> on-disk conversion/rename results for the process path** unless tests prove
> process already intended the new behavior. Prefer aligning **preview → process**
> semantics so batch writes stay identical.
>
> **Drift check**:
> `git diff --stat 1395878..HEAD -- backend/handlers/conversion.py tests/test_conversion_mapping.py tests/test_conversion_column_rename.py tests/test_rename_audit.py`
>
> **Functional safety (HARD RULE)**:
> 1. When `key_column` is non-empty, both preview and process already resolve
>    columns — keep that.
> 2. When `key_column` is empty and no mapping Excel: **process** uses
>    `buscar_lote_por_codigos` (all-field legacy). Preview today may
>    auto-detect a column — that is the divergence.
> 3. After this plan, preview with empty `key_column` must produce the **same
>    `nuevo` names** as process would for the same params/files/DB (shared helper).
> 4. Do not change mapping-Excel mode, out-path dedupe, or EXIF conversion.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: MED (rename UX; mitigate by process-preserving default)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `1395878`, 2026-07-13

## Why this matters

Users review rename preview then run process. With empty `key_column`, preview
auto-detects a DB column while process intentionally skips auto-detect and uses
all-field batch lookup. The same IPC params can show one set of names and write
another. Unifying on **process semantics** fixes the lie without changing what
already gets written to disk.

## Functional invariants

| Invariant | How to verify |
|-----------|----------------|
| Process with empty `key_column` still uses all-field / `buscar_lote_por_codigos` path | Characterization test on `_prepare_chunk_tasks` / job |
| Process with explicit `key_column` unchanged | Existing column-rename tests |
| Mapping mode (`mapping` / `mapping_path`) unchanged | Mapping tests |
| Preview with empty key matches process names | New parity test |

## Current state

```python
# Process — only auto-detect when key_column truthy (conversion.py ~538-543)
if usar_rename and not file_mapping and not mapping_path and files and key_column:
    ...
    key_column = _resolve_key_column(key_column, files, db_cols)
```

```python
# Preview — when no key_column, auto-detect (conversion.py ~358-376)
else:
    # No key_column provided: try auto-detecting the best column first
    ...
    auto_key = _resolve_key_column(None, files, db_cols, probe_result=probe) if ...
    if auto_key:
        db_cache = buscar_por_columna(..., auto_key)
    else:
        db_cache = buscar_lote_por_codigos(codigos_list)
```

```python
# Chunk tasks when key_column empty (conversion.py ~909-911)
else:
    codigos = [...]
    db_cache = lookup_fn(codigos)  # lote all-fields
```

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Mapping / rename tests | `python -m pytest tests/test_conversion_mapping.py tests/test_conversion_column_rename.py tests/test_rename_audit.py tests/test_conversion_record_sequence.py -v --tb=short` | all pass |
| New parity tests | `python -m pytest tests/test_conversion_key_parity.py -v --tb=short` | all pass (create file) |
| Lint | `python -m ruff check backend/handlers/conversion.py tests/` | exit 0 |

## Scope

**In scope**:
- `backend/handlers/conversion.py` — extract shared resolution used by `preview`
  and `_run_conversion_job` / `_prepare_chunk_tasks`
- New tests under `tests/test_conversion_*.py`

**Out of scope**:
- Changing Excel mapping / `MappingIndex`
- FE auto-selection of key column
- Forcing process to auto-detect when key is empty (would change disk output —
  only if product later demands it; not this plan)

## Git workflow

- Branch: `advisor/011-preview-process-key-parity`
- Commit: `fix(conversion): align preview key resolution with process`

## Steps

### Step 1: Characterization tests (write first)

Create `tests/test_conversion_key_parity.py`:

1. **Process empty key**: with a temp DB / mocked `buscar_lote_por_codigos` and
   `buscar_por_columna`, run a minimal `_run_conversion_job` or the rename
   preparation path and record resulting output names (or spy which lookup was
   called). Assert `buscar_por_columna` is **not** used for auto-detect when
   `key_column=""`.

2. **Preview empty key (current bug)**: call `preview` with same params; today
   it may call auto-detect — capture behavior.

3. **Parity goal**: after fix, preview and process both call the same lookup
   strategy when `key_column` is `""` / missing: **all-field lote**, not
   auto-detected single column.

4. **Explicit key_column**: both paths use that column (existing tests cover
   much of this — add one shared-params case if missing).

**Verify**: parity test fails before fix if preview auto-detects.

### Step 2: Shared helper

Extract something like:

```python
def _resolve_rename_lookup_mode(
    *,
    key_column: str,
    use_column_rename: bool,
    has_mapping: bool,
    files: list,
    ...
) -> RenameLookupPlan:
    """Single source of truth for preview + process."""
```

Rules (must match **current process**):

| Inputs | Behavior |
|--------|----------|
| mapping present | mapping index |
| `key_column` non-empty | resolve column (may auto-correct invalid name via `_resolve_key_column`) + `buscar_por_columna` |
| `use_column_rename` | existing process branch |
| else empty key | `buscar_lote_por_codigos` — **no** auto-detect |

Wire **preview** and **process** to this helper. Delete divergent branches.

### Step 3: Optional UX note

If preview previously showed auto-detected matches for empty key, after fix it
may show fewer/more matches matching process. That is intentional. Do **not**
change process to restore old preview behavior.

### Step 4: Full rename regression suite

**Verify**: all commands in the table pass.

## Test plan

| Case | Expected |
|------|----------|
| empty key_column | preview lookup == process lookup strategy |
| key_column="codigo" | both use column |
| mapping dict | both mapping mode |
| existing column-rename / sequence tests | green |

## Done criteria

- [ ] One shared resolution path for preview + process
- [ ] Process on-disk rename strategy for empty key unchanged (lote)
- [ ] Parity tests pass
- [ ] Existing conversion rename tests pass
- [ ] README DONE

## STOP conditions

- Product owner requires process to auto-detect like old preview — escalate;
  that is a **different** plan with intentional rename output changes + golden
  rename fixtures.
- Helper forces FE contract changes.
- Cannot test without a huge DB fixture — use mocks like other conversion tests.

## Maintenance notes

- Any future auto-detect must flip **both** paths via the helper in one PR.
- Reviewer: diff preview vs `_prepare_chunk_tasks` for leftover divergence.
