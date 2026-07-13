# Plan 007: Always emit complete/error when a conversion job dies

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 1395878..HEAD -- backend/handlers/conversion.py backend/core/jobs.py tests/test_conversion_scheduler.py tests/test_jobs.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **Functional safety (HARD RULE)**: Do **not** change how images are converted,
> renamed, written to disk, or which files are selected. This plan only ensures
> the job always ends with a complete notification + structured `job.result` when
> something raises. Happy-path rename/convert output must be bit-identical to
> before.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `1395878`, 2026-07-13

## Why this matters

`_run_conversion_job` only calls `_notify_complete` on early validation returns
and the happy path. If `parse_id_rename_mapping`, DB lookup setup, or any
unexpected exception raises before those points, the job thread clears
`running=False` in `finally` but never emits `process.complete` /
`job.{id}.complete`. The UI can hang until a poll notices idle state, and
`job.result` stays empty. Fixing this restores feedback without changing
conversion work.

## Functional invariants (must still hold)

| Invariant | How to verify |
|-----------|----------------|
| Successful conversion still notifies complete with same ok/err counts | Existing conversion scheduler tests still pass |
| Cancel still sets `job.result.cancelled` and notifies | `test_conversion_cancel_releases_visible_state_without_waiting_for_slow_workers` |
| Disk outputs for happy path unchanged | No changes to `convertir_imagen`, renamer, or write paths |
| Validation failures (empty mapping, collisions) still notify complete | Keep existing early-return `_notify_complete` calls |

## Current state

- `backend/handlers/conversion.py` — `_run_conversion_job` (~507–794)
- `backend/core/jobs.py:188-194` — job wrapper only clears `running` in `finally`
- Early validation paths already call `_notify_complete` (e.g. empty mapping ~570)
- Outer structure ends with:

```python
# conversion.py — end of _run_conversion_job (approx 749-794)
        job.result = {"ok_count": ok_count, "err_count": err_count, "cancelled": cancelled}
        ...
        _notify_complete(job, ok_count, err_count)
        ...
        save_run(...)
    finally:
        with state._lock:
            state.running = False
```

Exceptions before the block that sets `job.result` skip `_notify_complete`.

### Conventions

- Notifications: `_notify_complete` / `_emit_progress_notifications` in same file.
- Errors: log with `log_message(..., "error", state=state)`; Spanish user-facing
  strings via `t(...)` where keys exist.
- Tests: model after `tests/test_conversion_scheduler.py`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Conversion job tests | `python -m pytest tests/test_conversion_scheduler.py tests/test_jobs.py -v --tb=short` | all pass |
| Broader conversion suite | `python -m pytest tests/test_conversion_*.py tests/test_handlers.py -v --tb=short` | all pass |
| Lint touched files | `python -m ruff check backend/handlers/conversion.py tests/` | exit 0 |

## Scope

**In scope**:
- `backend/handlers/conversion.py` — `_run_conversion_job` error/complete path only
- `tests/test_conversion_scheduler.py` (or new `tests/test_conversion_job_complete.py`)

**Out of scope**:
- Cancel drain / grace period changes (separate plan if any)
- History `save_run` schema / cancelled flag policy (do not expand history semantics)
- Frontend `useProcessRunner`
- `convertir_imagen`, renamer, mapping algorithms

## Git workflow

- Branch: `advisor/007-conversion-job-always-complete`
- Commits: Conventional Commits, e.g. `fix(conversion): always notify complete on job errors`
- Do NOT push or open a PR unless asked.

## Steps

### Step 1: Add a failing characterization test

In `tests/test_conversion_scheduler.py` (or dedicated file):

1. Monkeypatch `parse_id_rename_mapping` (or force a raise after job start by
   patching something invoked only in the try body, e.g. raise from
   `get_scheduler` after params with valid files) so `_run_conversion_job`
   raises once inside the main `try`.
2. Capture notifications via monkeypatch of `conversion.send_notification` or
   `_notify_complete`.
3. Assert: after call returns, `job.state.running is False`, and either
   `_notify_complete` was invoked **or** a `process.complete` /
   `job.{id}.complete` notification was sent once.
4. Assert `job.result` contains an error signal, e.g.
   `{"ok_count": 0, "err_count": N, "error": "..."}` or equivalent documented
   shape — **do not** invent a FE-breaking shape; prefer additive keys:
   `job.result = {"ok_count": 0, "err_count": len(files), "cancelled": False, "error": "<type>: <msg>"}`.

**Verify**: `python -m pytest tests/test_conversion_scheduler.py -k complete -v` → FAIL on missing notify.

### Step 2: Implement complete-on-exception without changing happy path

In `_run_conversion_job`:

1. Keep all successful / cancel / early-validation paths as they are.
2. Wrap the body so unexpected exceptions:
   - are logged (`logger.exception` or `log_message` with error tag),
   - set `job.result` with ok/err and `error` message,
   - call `_notify_complete(job, ok, err)` once,
   - do **not** re-raise (job thread should end cleanly like today).
3. Prefer a structure like:

```python
notified = False
try:
    ...  # existing body; on early returns set notified=True after _notify_complete
except Exception as exc:
    ... set result, log, _notify_complete once ...
    notified = True
finally:
    with state._lock:
        state.running = False
    # Optional safety: if not notified and we somehow exited without notify,
    # notify once. Only if you can prove no double-notify on happy path.
```

4. **Do not** call `save_run` on unexpected crash unless it already would have
   (avoid new history rows for broken jobs unless existing early paths already
   save — currently only happy/cancel path saves near the end; keep that:
   on exception **skip** `save_run`).

**Verify**: new test passes; `test_conversion_prepares_work_incrementally` and
cancel test still pass.

### Step 3: Guard against double-complete

Ensure early returns that already call `_notify_complete` do not also hit a
second complete in `finally`. Use a local `notified` flag or only catch
exceptions (not early returns).

**Verify**: test that happy path still emits complete exactly once (spy on
`send_notification` / `_notify_complete` count == 1).

## Test plan

| Case | Expected |
|------|----------|
| Raise mid-job | complete once; running false; result has error |
| Happy path (mocked scheduler) | complete once; result has cancelled false |
| Cancel | existing cancel assertions unchanged |

Model structure after `tests/test_conversion_scheduler.py`.

## Done criteria

- [ ] New regression test(s) pass
- [ ] `python -m pytest tests/test_conversion_scheduler.py tests/test_jobs.py -v` passes
- [ ] No changes to converter/renamer/write paths
- [ ] Happy-path complete still fires exactly once
- [ ] Exception path does not leave `running=True`
- [ ] No files outside scope modified
- [ ] `plans/README.md` row → DONE

## STOP conditions

- Fix seems to require changing FE notification contract field names used by
  `useProcessRunner` (`process.complete` / progress fields).
- You need to change cancel grace / drain semantics to make the test pass.
- Double-complete appears on happy path and cannot be fixed with a simple flag.
- Drift: `_run_conversion_job` structure no longer matches excerpts.

## Maintenance notes

- Reviewer: confirm no double `process.complete` and no new `save_run` on crash.
- Follow-up (not this plan): cancelled-run history flag; join workers on cancel.
