# Plan 017: Make mapping orphan stats O(keys + files), preserve results

> **Executor instructions**: Follow step by step. Update `plans/README.md` when done.
>
> **Drift check**:
> `git diff --stat 1395878..HEAD -- backend/core/mapping_index.py tests/test_mapping_index.py`
>
> **Functional safety (HARD RULE)**: `orphanEntries`, `matchedFiles`,
> `unmatchedFiles`, and `collisions` results for a given mapping+file set must
> match **current** semantics after the algorithmic change. Only complexity
> changes. Do **not** change `lookup` / `resolve_output_name` matching rules
> in this plan (stem clobber is a separate finding — leave lookup maps alone
> unless a test forces a pure bugfix).

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `1395878`, 2026-07-13

## Why this matters

```python
orphan_entries = [
    id_key for id_key in self.raw
    if not any(self._id_matches_file(id_key, name) for name in file_names)
]
```

This is O(|mapping| × |files|) and freezes `db_parse_mapping` /
`db_validate_mapping` on large Excel maps. A set-based index of file names and
stems keeps the same membership checks cheaper.

## Functional invariants

| Invariant | How to verify |
|-----------|----------------|
| Same orphan keys for fixtures | Characterization: before/after equal sets |
| lookup still case/stem tolerant | Existing mapping tests |
| collisions unchanged | Existing tests |

## Current state

- `backend/core/mapping_index.py` — `compute_stats`, `_id_matches_file`, `lookup`
- Tests: `tests/test_mapping_index.py`

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Mapping index tests | `python -m pytest tests/test_mapping_index.py tests/test_renamer_mapping.py -v --tb=short` | all pass |
| Lint | `python -m ruff check backend/core/mapping_index.py` | exit 0 |

## Scope

**In scope**:
- `backend/core/mapping_index.py` — `compute_stats` (and helpers only if needed)
- `tests/test_mapping_index.py`

**Out of scope**:
- Changing `MappingIndex.__init__` stem overwrite policy
- FE mapping UI
- Excel parse `iterrows` performance (separate)

## Git workflow

- Branch: `advisor/017-mapping-orphan-stats-o1`
- Commit: `perf(mapping): O(1) orphan detection via stem/name sets`

## Steps

### Step 1: Golden characterization tests

Add fixtures with:

- exact name match
- stem match
- case-insensitive match
- true orphans
- empty files / empty mapping

Capture current `compute_stats` outputs (run once, hardcode expected, or
compute expected with a slow reference function kept only in tests).

### Step 2: Implement set-based orphans

Build from `file_names`:

```python
names = set(file_names)
lower = {n.lower() for n in file_names}
stems = {Path(n).stem for n in file_names}
stems_lower = {Path(n).stem.lower() for n in file_names}
```

For each `id_key`, treat as matched if `_id_matches_file` would be true —
implement by checking the same conditions against the sets (not nested loop).

**Critical**: re-read `_id_matches_file` and mirror it exactly:

```python
def _id_matches_file(self, id_key: str, file_name: str) -> bool:
    key_lower = id_key.lower()
    stem_key = Path(id_key).stem.lower()
    if file_name == id_key or file_name.lower() == key_lower:
        return True
    file_stem = Path(file_name).stem
    return file_stem == id_key or file_stem.lower() in {stem_key, key_lower}
```

### Step 3: Optional microbench

Not required. If added, mark `@pytest.mark.slow` or keep under 1s for 5k×5k.

**Verify**: all mapping tests pass; golden orphans identical.

## Test plan

| Case | Expected |
|------|----------|
| Golden fixtures | stats equal to pre-change reference |
| Large synthetic 2k×2k | finishes quickly + correct orphan count |

## Done criteria

- [ ] Nested any-loop removed from hot path
- [ ] Golden parity tests pass
- [ ] lookup behavior untouched
- [ ] README DONE

## STOP conditions

- Set-based logic cannot reproduce `_id_matches_file` for a discovered edge
  case — keep slow path for that case or STOP.
- You start "fixing" stem clobber in the same PR — split out.

## Maintenance notes

- If `_id_matches_file` changes, update set construction in lockstep.
- Reviewer: require golden tests, not only speed claims.
