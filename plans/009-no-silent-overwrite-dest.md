# Plan 009: Refuse or auto-suffix pre-existing conversion destinations

> **Executor instructions**: Follow step by step. Run verifications. STOP on mismatch. Update `plans/README.md` when done.
>
> **Drift check**: `git diff --stat 5aa6d8b..HEAD -- backend/core/converter.py backend/handlers/conversion.py backend/handlers/optimizer.py tests/test_conversion_out_path_dedupe.py`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `5aa6d8b`, 2026-07-14

## Why this matters

Conversion writes with `img.save` / `shutil.copy2` without checking if the destination already exists. In-batch collisions are auto-suffixed (`_dedupe_chunk_out_paths`), but **on-disk** files from a previous run are overwritten silently — data loss. Optimizer already refuses/skips existing files (`optimizer.py:162-169`).

## Current state

```python
# converter.py ~71-72, 168-178
shutil.copy2(ruta_origen, ruta_destino)
...
ruta_destino.parent.mkdir(parents=True, exist_ok=True)
img.save(ruta_destino, ...)
```

```python
# conversion.py ~1022-1059
# _dedupe_chunk_out_paths only tracks `reserved` set for this batch, not Path.exists()
```

Optimizer pattern (exemplar for on-disk awareness):

```python
# optimizer.py ~162-169
while target.exists() and attempts < MAX_DEDUP_ATTEMPTS:
    archive_name = _dedupe_archive_name(safe_base, seen)
    target = destination / archive_name
    attempts += 1
if target.exists():
    skipped.append(...)
    continue
```

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Dedupe tests | `cd backend && python -m pytest ../tests/test_conversion_out_path_dedupe.py -v` | pass |
| Broader conversion | `cd backend && python -m pytest ../tests/test_conversion_mapping.py ../tests/test_conversion_scheduler.py -v` | pass |
| Lint | `npm run lint:python` | exit 0 |

## Scope

**In scope**:
- `backend/handlers/conversion.py` — extend `_dedupe_chunk_out_paths` (or post-step) to consider `out_path.exists()` on disk, auto-suffix like in-batch (preferred, matches batch behavior)
- `tests/test_conversion_out_path_dedupe.py` — new cases with real tmp_path files
- Optionally `converter.py` only if you add a shared safe-write helper used by conversion — keep conversion-layer preferred to avoid surprising other callers of `convertir_imagen`

**Out of scope**:
- Optimizer rewrite
- UI “overwrite?” dialog (auto-suffix is the product default for this plan)
- Changing mapping collision **job failure** policy (mapping mode may still fail on planned collisions differently — do not weaken mapping validation)

## Git workflow

- Branch: `advisor/009-no-silent-overwrite-dest`
- Commit: `fix(conversion): auto-suffix when destination already exists on disk`
- No push unless asked

## Steps

### Step 1: Failing tests

With `tmp_path`:
1. Create `out/a.jpg` already on disk
2. Task wants `out/a.jpg` for new input
3. After dedupe-with-disk, result path is `out/a-2.jpg` (or next free), not overwrite

Also: free name unchanged when file does not exist.

**Verify**: RED before fix.

### Step 2: Implement disk-aware suffixing

Extend `_dedupe_chunk_out_paths` so when choosing a path:
1. Key not in `reserved` **and**
2. Path does not exist on disk (or exists but is “owned” by this write — not applicable for new convert)

If collision with disk or reserved, suffix `-2`, `-3`, … like today, checking both reserved and `exists()`.

Bound attempts (see optimizer `MAX_DEDUP_ATTEMPTS` — reuse or define constant in conversion module).

Log collisions when `log` callback provided.

**Do not** change `convertir_imagen` global semantics unless tests force it; prefer path selection before convert.

### Step 3: Full scoped tests + lint

**Verify**: pytest files above + lint pass.

## Test plan

- Existing in-batch collision tests still pass
- New on-disk pre-existing file gets suffix
- Case-insensitive Windows key behavior preserved (`_out_path_key`)

## Done criteria

- [ ] Pre-existing destinations are not overwritten without suffix/skip
- [ ] Regression tests with tmp_path
- [ ] lint clean
- [ ] `plans/README.md` 009 → DONE

## STOP conditions

- Product requirement is “always overwrite” — stop and report; do not implement half measures
- Mapping mode intentionally overwrites same mapped name — confirm tests; still protect *unrelated* pre-existing files

## Maintenance notes

- Reviewer: ensure video copy path (`copiar_archivo`) goes through same task paths after dedupe.
- If atomic write (temp + rename) is desired later, separate plan.
