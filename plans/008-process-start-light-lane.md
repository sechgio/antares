# Plan 008: Run `process_start` on the light (or sync-safe) lane, not heavy

> **Executor instructions**: Follow this plan step by step. Run every
> verification command. STOP if any condition applies — do not improvise.
> Update `plans/README.md` when done.
>
> **Drift check**:
> `git diff --stat 1395878..HEAD -- backend/main.py shared/long-running-methods.json tests/test_backend_main.py`
>
> **Functional safety (HARD RULE)**: Must not change conversion algorithms,
> output files, or when a job is considered "started". Only changes **which
> thread pool lane** accepts the IPC handler that spawns the job thread.
> Actual image work must remain on the heavy pool.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `1395878`, 2026-07-13

## Why this matters

`process_start` is listed in `HEAVY_METHODS` but only calls `JobManager.create_job`
and returns. Real work runs later inside `_run_conversion_job` via
`submit_heavy`. When the heavy budget is saturated, a new start can fail with
"Backend ocupado" even though spawning a thread is cheap and
`JobManager.max_concurrent` still has room. Moving start off the heavy lane
restores the ability to enqueue jobs under load without changing conversion.

## Functional invariants

| Invariant | How to verify |
|-----------|----------------|
| `process_start` still returns `{started, job_id, reason?}` same shapes | Existing handler / stress tests |
| Per-file conversion still uses heavy pool | `test_dispatch_uses_heavy_scheduler_for_heavy_methods` patterns; conversion still `submit_heavy` |
| Health probes still work during jobs | `process_status` remains in `SYNC_METHODS` |
| Electron long-running timeout list can keep `process_start` | Do **not** remove from `shared/long-running-methods.json` unless you prove FE timeouts still correct |

## Current state

```python
# backend/main.py — HEAVY_METHODS includes:
"process_start",
# ...
# SYNC_METHODS:
"version",
"process_status",
```

```python
# conversion.py process_start — only create_job, no image work
result = mgr.create_job(
    job_type="conversion",
    params=params,
    target=_run_conversion_job,
    job_id=job_id,
)
```

```json
// shared/long-running-methods.json — first entry is "process_start"
// Used by Electron/FE for timeout / health-skip classification — NOT the same
// as Python HEAVY_METHODS. Leave this file alone unless tests require it.
```

Comment in `main.py:87-88`: keep HEAVY list aligned with
`shared/long-running-methods.json` **for Python-handled methods that are heavy**.
`process_start` is the exception: long-running *job*, short *handler*.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Main routing tests | `python -m pytest tests/test_backend_main.py -v --tb=short` | all pass |
| Conversion smoke | `python -m pytest tests/test_handlers.py tests/test_conversion_scheduler.py -v --tb=short` | all pass |
| Lint | `python -m ruff check backend/main.py tests/test_backend_main.py` | exit 0 |

## Scope

**In scope**:
- `backend/main.py` — remove `"process_start"` from `HEAVY_METHODS` only
- `tests/test_backend_main.py` — assert `process_start` is **not** heavy; still
  dispatchable on light path

**Out of scope**:
- Changing `process_status` / `SYNC_METHODS`
- Editing Electron spawner / FE timeouts (unless a test proves they break —
  then STOP and report)
- Moving other HEAVY methods
- Changing `JobManager` concurrency limits

## Git workflow

- Branch: `advisor/008-process-start-light-lane`
- Commit: `perf(backend): accept process_start without heavy budget`

## Steps

### Step 1: Test — process_start is not heavy

Add to `tests/test_backend_main.py`:

```python
def test_process_start_is_not_heavy() -> None:
    """Start only spawns a job thread; must not consume heavy slots."""
    assert "process_start" not in backend_main.HEAVY_METHODS
```

Optionally extend dispatch test: submit with method `process_start` and assert
`submit_light` was used (mirror existing heavy-dispatch test).

**Verify**: test fails while `process_start` still in `HEAVY_METHODS`.

### Step 2: Remove from HEAVY_METHODS

Delete the `"process_start"` entry from `HEAVY_METHODS` in `backend/main.py`.

Update the comment near HEAVY_METHODS to note: *job spawners that return
immediately must stay off HEAVY; long-running *work* inside the job still uses
`submit_heavy`.*

**Do not** remove from `shared/long-running-methods.json` in this plan.

**Verify**: new test passes; other HEAVY assertions still pass.

### Step 3: Sanity

Run conversion scheduler + handlers tests.

**Verify**: full commands table above green.

## Test plan

- `process_start ∉ HEAVY_METHODS`
- Existing heavy methods (fichas, evidencia, …) still listed
- Optional: monkeypatch scheduler — `process_start` handler uses light submit

## Done criteria

- [ ] `"process_start"` not in `HEAVY_METHODS`
- [ ] Still in `shared/long-running-methods.json` (unchanged)
- [ ] Conversion job body still uses `submit_heavy` for per-file work
- [ ] Tests green; scope respected
- [ ] README status DONE

## STOP conditions

- Removing from HEAVY requires also changing Electron health-probe logic to keep
  CI green (report — may need a tiny electron plan, not drive-by).
- You find `process_start` does substantial heavy work before return (then the
  finding is wrong — STOP).
- Any change to on-disk conversion results appears necessary.

## Maintenance notes

- If more fire-and-forget starters appear, same rule: short IPC → light; work → heavy.
- Keep `long-running-methods.json` and `HEAVY_METHODS` divergence documented.
