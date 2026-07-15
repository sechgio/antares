# Plan 013: Detect MappingIndex stem conflicts instead of last-write-wins

> **Executor instructions**: Follow step by step. Run verifications. STOP on mismatch. Update `plans/README.md` when done.
>
> **Drift check**: `git diff --stat 5aa6d8b..HEAD -- backend/core/mapping_index.py tests/test_conversion_mapping.py tests/test_renamer_mapping.py`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (prefer after 001 so unmapped parity is stable)
- **Category**: bug
- **Planned at**: commit `5aa6d8b`, 2026-07-14

## Why this matters

Building the index stores both key and `Path(key).stem` into `_exact`/`_lower`, overwriting previous values. Mapping `{"123.jpg": "a", "123": "b"}` makes `lookup("123.png")` return `"b"` (last stem write). Ambiguous Excel rows silently rename wrong files.

## Current state

`backend/core/mapping_index.py:18-24`:

```python
for key, value in file_mapping.items():
    if not key:
        continue
    self._exact[key] = value
    self._exact[Path(key).stem] = value  # last write wins
    self._lower[key.lower()] = value
    self._lower[Path(key).stem.lower()] = value
```

Lookup order (`lookup`): exact name → exact stem → lower name → lower stem.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Mapping tests | `cd backend && python -m pytest ../tests/test_conversion_mapping.py ../tests/test_renamer_mapping.py -v` | pass |
| Lint | `npm run lint:python` | exit 0 |

## Scope

**In scope**:
- `backend/core/mapping_index.py`
- Tests for conflict detection / deterministic precedence
- Call sites that construct MappingIndex — surface conflicts if API already has validation (search `MappingIndex(` and `compute_stats`)

**Out of scope**: UI for conflict resolution wizard; plan 001 unmapped behavior

## Git workflow

- Branch: `advisor/013-mapping-index-stem-conflicts`
- Commit: `fix(mapping): detect stem key conflicts in MappingIndex`
- No push unless asked

## Steps

### Step 1: Define precedence (recommended)

1. Exact filename key always wins for that filename
2. Stem keys only register if they do not collide with another distinct value for the same stem
3. On conflict (two different values claim same stem), either:
   - **A (preferred)**: do not store ambiguous stem entry; only exact keys remain; optional `conflicts` list on index for UI/logs
   - **B**: fail mapping job build with clear error (stricter)

Pick **A** unless conversion already fails hard on mapping issues — check how empty renames are handled.

### Step 2: Implement + tests

```python
# Example: {"123.jpg": "a", "123": "b"}
# lookup("123.jpg") -> "a" (exact)
# lookup("123.png") -> None or error, NOT silent "b"
```

Document behavior in test names.

**Verify**: pytest + lint.

## Done criteria

- [ ] No silent last-write-wins across conflicting stem values
- [ ] Exact key lookups still work
- [ ] Case-insensitive behavior preserved for non-conflicting cases
- [ ] `plans/README.md` 013 → DONE

## STOP conditions

- Changing stem matching breaks many user mappings in production fixtures — add feature flag? Prefer conflicts list + keep exact match; report if fixtures fail massively

## Maintenance notes

- Reviewer: ensure `compute_stats` / unmapped counts still make sense with conflicts.
