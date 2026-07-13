# Plan 016: Spike Historial reexecute beyond Conversión (design only first)

> **Executor instructions**: This plan’s primary deliverable is a **design/spike document**, not a full multi-module feature. Do not enable `reexecute: true` widely without per-type restore contracts. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 3174e83..HEAD -- frontend/src/components/history/ backend/core/run_types.py`
>
> **Behavior freeze (HARD)**: Conversión reexecute must keep working exactly as today. Do not change how history rows are stored for existing run types. Any pilot must be additive and opt-in per run type.

## Status

- **Priority**: P3
- **Effort**: L (full rollout) / S–M (spike)
- **Risk**: MED
- **Depends on**: plan 007 (ficha registry) if fichas are in scope for later reexecute — not required for spike
- **Category**: direction
- **Planned at**: commit `3174e83`, 2026-07-13

## Why this matters

Historial logs many tools, but only `conversion` has `reexecute: true`. Field users repeat padrones/volantes/reportes manually. Blindly flipping flags would restore incomplete state and look like “logic changes” — hence spike-first.

## Current state

- `frontend/src/components/history/runTypes.ts` — only `conversion.reexecute === true`
- `frontend/src/components/history/historyEvents.ts` — reexecute bus consumed by Conversión
- Multiple modules call `saveFeatureHistory` with varied payloads
- Backend `RUN_TYPE_REGISTRY` validates options per type

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Grep history saves | `rg "saveFeatureHistory" frontend/src` | inventory |
| History tests | `cd backend && python -m pytest ../tests/test_run_types.py ../tests/test_history_export.py -v` | pass |

## Scope

**In scope**:
- Spike notes file: `plans/016-reexecute-spike-notes.md` (create)
- Optional: one **non-user-facing** prototype behind a dead flag is discouraged — prefer notes + maybe a unit-level “canRebuildState(payload)” pure function for the chosen pilot type without wiring UI

**Out of scope for this plan**:
- Enabling reexecute for all run types
- Changing conversion reexecute
- Backend schema breakages

## Git workflow

- Branch: `advisor/016-historial-reexecute-spike`
- Commit: `docs(plans): historial reexecute spike notes`
- No push/PR unless asked.

## Steps

### Step 1: Inventory payloads

For each `saveFeatureHistory` call site, record: `run_type`, options keys, whether file paths are absolute and still valid after restart, and whether UI can rebuild from options alone.

**Verify**: notes table complete.

### Step 2: Rank pilots

Recommend a single pilot (likely `image_optimizer` or `padron` if payloads are rich and paths recoverable). Explicitly defer `ficha_tecnica` until plan 007 lands and payloads include enough to reopen forms.

**Verify**: ranked list with “why / why not”.

### Step 3: Define restore contract for the pilot

Write:
- Input: history row shape
- Output: UI state to set / IPC to call
- Failure modes: missing files → toast, no silent partial run
- Tests required before flipping `reexecute: true`

Do **not** flip the flag in this plan unless the operator explicitly expands scope after reviewing notes.

## Test plan

- Spike: no product test changes required.
- Future implementation: characterization test that restore(payload) equals original form state.

## Done criteria

- [ ] `plans/016-reexecute-spike-notes.md` exists with inventory, ranking, contract
- [ ] Conversion reexecute untouched
- [ ] `plans/README.md` → DONE (spike) or BLOCKED awaiting operator pick of pilot

## STOP conditions

- Operator demands full multi-module reexecute in one PR — refuse; split per type.
- Payload lacks enough data to restore safely — recommend richer `saveFeatureHistory` first (additive fields only).

## Maintenance notes

- Each run type gets its own follow-up plan after this spike.
- Reviewer: reject drive-by `reexecute: true` without restore handler + tests.
