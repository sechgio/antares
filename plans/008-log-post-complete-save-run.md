# Plan 008: Log (never swallow) post-complete save_run failures

> **Executor instructions**: Follow step by step. Run verifications. STOP on mismatch. Update `plans/README.md` when done.
>
> **Drift check**: `git diff --stat 5aa6d8b..HEAD -- backend/handlers/conversion.py`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (composes with 004 if both touch save_run options)
- **Category**: bug
- **Planned at**: commit `5aa6d8b`, 2026-07-14

## Why this matters

After a successful conversion, `_notify_complete` runs and `notified = True`, then `save_run(...)`. The outer `except` only handles `if not notified`, so history failures are silent. Users lose Reejecutar entries with no log.

## Current state

`backend/handlers/conversion.py` ~799-845:

```python
_notify_complete(job, ok_count, err_count)
notified = True
from backend.core.history import save_run
save_run(...)  # exceptions after notified are swallowed by:
except Exception as exc:
    if not notified:
        ... log and notify ...
    # else: nothing
```

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Lint | `npm run lint:python` | exit 0 |
| Tests | `cd backend && python -m pytest ../tests/test_conversion_scheduler.py -v` | pass |

## Scope

**In scope**:
- `backend/handlers/conversion.py` only around post-complete history save
- Optional small unit test with monkeypatch on `save_run`

**Out of scope**: history schema; UI; changing when save_run is called for cancelled jobs (004 may add cancelled flag)

## Git workflow

- Branch: `advisor/008-log-post-complete-save-run`
- Commit: `fix(conversion): log history save failures after successful complete`
- No push unless asked

## Steps

### Step 1: Isolate save_run

Wrap `save_run` in its own try/except:

```python
try:
    save_run(...)
except Exception:
    logger.exception("Failed to save conversion history for job %s", job_id)
    log_message(... optional user-visible warn ..., "warn", state=state)
```

Do **not** re-raise into the outer handler in a way that double-notifies complete. Job remains successful; history is best-effort.

### Step 2: Test (recommended)

Monkeypatch `save_run` to raise; run a minimal conversion job path or unit-test the helper if extracted. Assert logger.exception called / job still completes. If full job harness is heavy, a focused test of the exception branch with mocked pieces is enough.

**Verify**: lint + scoped pytest pass.

## Done criteria

- [ ] save_run failures always logged
- [ ] complete notification still only once
- [ ] no silent swallow of post-complete errors
- [ ] `plans/README.md` 008 → DONE

## STOP conditions

- save_run is required for product correctness and must fail the job — product decision; default is log-only

## Maintenance notes

- Same pattern if other post-complete side effects are added later.
