# Plan 010: Discard late worker writes after cancel (generation token)

> **Executor instructions**: Follow step by step. Run verifications. STOP on mismatch. Update `plans/README.md` when done.
>
> **Drift check**: `git diff --stat 5aa6d8b..HEAD -- backend/handlers/conversion.py backend/core/jobs.py tests/test_conversion_scheduler.py`
>
> **Prerequisite**: Plan 004 should be done so complete payloads include `cancelled`.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/004-cancel-complete-flag-and-ui.md
- **Category**: bug
- **Planned at**: commit `5aa6d8b`, 2026-07-14

## Why this matters

Cancel marks the job done after a short grace (`_CANCEL_GRACE_SECONDS = 0.25`) and cancels only not-started futures. In-flight workers still call `convertir_imagen` / `copiar_archivo`, so files appear after “cancelled” and a quick restart can race the same destinations. UI intentionally does not wait for all workers (covered by scheduler tests).

## Current state

`conversion.py` ~40-41, 721-735, 783-799:
- Cancel sets flag, `future.cancel()` for pending, wait 0.25s, set `running=False`, notify complete
- Workers already running continue to completion

`tests/test_conversion_scheduler.py` documents cancel must release UI quickly — **do not** break that by waiting for all workers on the cancel path.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Scheduler tests | `cd backend && python -m pytest ../tests/test_conversion_scheduler.py -v` | pass |
| Conversion suite | `cd backend && python -m pytest ../tests/test_conversion_mapping.py -v` | pass |
| Lint | `npm run lint:python` | exit 0 |

## Scope

**In scope**:
- `backend/handlers/conversion.py` — generation/epoch for job; ignore results and optionally skip write after cancel
- Tests for discard-after-cancel

**Out of scope**:
- Changing FE cancel button behavior beyond what 004 did
- Killing OS threads mid-Pillow (not feasible safely)
- Blocking create_job until drain (acceptable optional if UI stays responsive — prefer result discard first)

## Git workflow

- Branch: `advisor/010-cancel-discard-late-writes`
- Commit: `fix(conversion): ignore worker results after cancel generation bump`
- No push unless asked

## Steps

### Step 1: Design (keep simple)

At cancel time, bump a `cancel_generation` or set `state.cancelled = True` already used. In the worker completion callback / after `convertir_imagen` returns:
- If cancelled, **do not** increment ok_count, **do not** emit progress as success
- Prefer: check cancel flag **before** write; if cancelled mid-flight after heavy work, skip write when possible (check flag immediately before `convertir_imagen` and immediately before save if split)

Minimum viable: before writing each file, if cancelled → return cancelled/skipped without writing.

### Step 2: Tests

1. Cancel while a slow worker is mid-flight → destination for that file **must not** appear (or must not update ok_count) after cancel
2. Cancel still returns quickly (existing scheduler test still passes)

Use monkeypatch/sleep in worker if existing harness supports it (`test_conversion_scheduler.py` patterns).

### Step 3: Avoid restart race

If same `job_id` can restart immediately, either:
- refuse create until workers drained (with timeout), or
- use unique run generation so late writes from old gen are ignored even if they hit disk check

Prefer generation token stored on job state.

**Verify**: scheduler + new tests pass; cancel latency still OK.

## Done criteria

- [ ] Cancelled jobs do not count late successes
- [ ] Best-effort: no new files written after cancel flag observed before write
- [ ] UI cancel still fast (existing tests)
- [ ] `plans/README.md` 010 → DONE

## STOP conditions

- Fix requires joining all workers with long timeout that fails existing cancel UX tests — stop and report tradeoff
- ThreadPool cannot check cancel between open and save without refactoring converter — check flag before calling convertir_imagen as MVP

## Maintenance notes

- Combine with plan 009: late cancelled writes that still race should at least not overwrite via disk suffix — still discard preferred.
