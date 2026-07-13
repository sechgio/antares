# Plan 012: Atomic writes for fields/patterns config JSON

> **Executor instructions**: Follow step by step. Update `plans/README.md` when done.
>
> **Drift check**:
> `git diff --stat 1395878..HEAD -- backend/core/config_fields.py backend/core/config_patterns.py tests/test_config_fields.py`
>
> **Functional safety (HARD RULE)**: After a successful save, loaded config must
> equal the same validated payload as today. Do not change validation rules,
> default fields, or IPC handler shapes. Only make the write crash-safe
> (temp + `os.replace`), matching `formatos._save_catalog`.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `1395878`, 2026-07-13

## Why this matters

`save_fields` / `save_patterns` open the config path with `"w"` and dump JSON
in place. A crash mid-write can leave an empty/corrupt file; next load falls
back to defaults and looks like a silent settings reset. Formatos already uses
atomic replace — copy that pattern.

## Functional invariants

| Invariant | How to verify |
|-----------|----------------|
| `save_fields` return value and on-disk JSON content same as before (success path) | Existing + new tests |
| Invalid fields still stripped the same way | `test_config_fields` |
| Cache invalidation still runs after successful write | load sees new data |

## Current state

```python
# backend/core/config_fields.py ~136-138
with open(path, "w", encoding="utf-8") as file:
    json.dump({"fields": validated}, file, indent=2, ensure_ascii=False)
```

```python
# backend/core/formatos.py _save_catalog (exemplar) ~151-158
tmp_path = _CATALOG_PATH.with_suffix(_CATALOG_PATH.suffix + ".tmp")
with open(tmp_path, "w", encoding="utf-8") as f:
    json.dump(...)
    f.flush()
    os.fsync(f.fileno())
os.replace(tmp_path, _CATALOG_PATH)
```

Apply the same idea to `config_patterns.save_patterns`.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Config tests | `python -m pytest tests/test_config_fields.py -v --tb=short` | all pass |
| Patterns tests | `python -m pytest tests/test_config_patterns.py -v --tb=short` | all pass (create if needed) |
| Lint | `python -m ruff check backend/core/config_fields.py backend/core/config_patterns.py` | exit 0 |

## Scope

**In scope**:
- `backend/core/config_fields.py` — `save_fields` write
- `backend/core/config_patterns.py` — `save_patterns` write
- `tests/test_config_fields.py` and/or `tests/test_config_patterns.py`

**Out of scope**:
- theme config (unless identical bug and same one-line pattern — only if already
  in-scope by accident; prefer leave theme alone)
- fichas/technical_reports JSON stores (separate finding)
- Changing field validation

## Git workflow

- Branch: `advisor/012-atomic-config-json-writes`
- Commit: `fix(config): atomic replace for fields and patterns JSON`

## Steps

### Step 1: Shared tiny helper (optional, keep simple)

Either:

- Private `_atomic_write_json(path: Path, payload: dict) -> None` in one module
  and import from the other, **or**
- Duplicate the 6-line temp/fsync/replace pattern in both (project prefers
  minimal abstraction — duplication of 6 lines is OK).

Match formatos: write `.tmp` next to target, `flush`+`fsync`, `os.replace`.

On Windows, `os.replace` overwrites; do not delete target first.

### Step 2: Use in `save_fields` and `save_patterns`

After building `validated` payload, call atomic write instead of open `"w"`.

### Step 3: Tests

- Roundtrip save/load still works (existing).
- New: after save, target file exists and tmp is gone; content parses as JSON
  with expected keys.
- Optional: monkeypatch `json.dump` to raise mid-write on real path — if hard,
  skip; at least assert helper uses replace.

If `config_patterns` has zero tests, add minimal file modeled on
`test_config_fields.py` (load defaults, save valid pattern, reject invalid).

**Verify**: pytest table green.

## Test plan

| Case | Expected |
|------|----------|
| save_fields happy | file content matches validated fields |
| save_patterns happy | patterns persist |
| no leftover `.tmp` after success | assert |

## Done criteria

- [ ] Both saves use temp + replace
- [ ] Existing config tests pass
- [ ] No validation behavior change
- [ ] README DONE

## STOP conditions

- Atomic write fails on Windows CI for the user_data path and cannot be fixed
  without changing path layout — report.
- Patterns module API differs enough that you must change IPC handlers.

## Maintenance notes

- Prefer one shared `_atomic_write_json` later if a third config appears.
- Reviewer: confirm fsync before replace (not just rename without flush).
