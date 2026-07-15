# Plan 004: Propagate cancel flag through complete notify + UI progress

> **Executor instructions**: Follow step by step. Run verifications. STOP on mismatch. Update `plans/README.md` when done.
>
> **Drift check**: `git diff --stat 5aa6d8b..HEAD -- backend/handlers/conversion.py frontend/src/hooks/useProcessRunner.ts frontend/src/hooks/useProcessRunner.test.tsx backend/core/history.py`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `5aa6d8b`, 2026-07-14

## Why this matters

Cancel already stores `cancelled` on `job.result` and freezes progress in backend state, but `_notify_complete` only sends `ok_count`/`err_count`. The frontend always forces `progress: 100` on `process.complete`, so Detener looks like a full success. History also saves cancelled runs as normal partial successes with no flag.

## Current state

Backend (`conversion.py`):

```python
# ~787-799
state.progress = 100 if not cancelled else state.progress
job.result = {"ok_count": ok_count, "err_count": err_count, "cancelled": cancelled}
_notify_complete(job, ok_count, err_count)  # no cancelled

# ~874-880
def _notify_complete(job, ok_count, err_count):
    notif_data = {"ok_count": ok_count, "err_count": err_count, "job_id": job.id}
    send_notification(f"job.{job.id}.complete", notif_data)
    if is_default:
        send_notification("process.complete", {"ok_count": ok_count, "err_count": err_count})
```

Frontend (`useProcessRunner.ts:48-50`):

```typescript
} else if (method === 'process.complete') {
  setStatus((prev) => ({ ...(prev ?? emptyStatus()), ...filtered, running: false, progress: 100 } as ProcessStatus));
  setRunning(false);
}
```

`safeKeys` does not include `cancelled`. History `save_run` options lack `cancelled` (`conversion.py:805-829`).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| FE unit | `cd frontend && npx vitest run src/hooks/useProcessRunner.test.tsx` | pass |
| Python (if backend tests added) | `cd backend && python -m pytest ../tests/test_conversion_scheduler.py -v` | pass |
| Typecheck | `npm run typecheck:frontend` | exit 0 |
| Lint | `npm run lint:python` | exit 0 |

## Scope

**In scope**:
- `backend/handlers/conversion.py` — `_notify_complete` signature/payload; `save_run` options include `cancelled: bool`
- `frontend/src/hooks/useProcessRunner.ts` — do not force 100% when cancelled; allow `cancelled` in filtered keys if UI needs it
- `frontend/src/hooks/useProcessRunner.test.tsx` — update expectations
- `frontend/src/types` only if `ProcessStatus` needs optional `cancelled`
- Optional: history list UI badge — **only if** trivial; otherwise store flag in options for later UI

**Out of scope**:
- Stopping in-flight workers (plan 010)
- Changing cancel grace timeout
- Full history UI redesign

## Git workflow

- Branch: `advisor/004-cancel-complete-flag-and-ui`
- Commits: `fix(conversion): include cancelled in process.complete`; `fix(frontend): honor cancel progress on complete`
- No push unless asked

## Steps

### Step 1: Backend payload

Change `_notify_complete` to accept `cancelled: bool = False` and include:
- `cancelled`
- `progress` (final backend progress) in both `job.*.complete` and `process.complete`

Call sites must pass `cancelled` from the job path.

Add `cancelled` to `save_run` `options` dict.

**Verify**: unit or lightweight test that mocks `send_notification` if one exists; else grep that call sites pass cancelled. Prefer a small pytest that patches `send_notification`.

### Step 2: Frontend

On `process.complete`:
- Set `running: false`
- Set `progress` from payload if present; else keep previous progress; **never force 100 when `cancelled === true`**
- If not cancelled and progress omitted, 100 is OK

Add `cancelled` to `safeKeys` if stored on status.

Update tests:
- complete with `cancelled: true, progress: 40` → progress stays 40, running false
- complete without cancelled → progress 100 still OK

**Verify**: vitest file passes; typecheck passes.

### Step 3: Update test that locked bad already_running behavior only if needed

Do not change soft-fail tests except as required by progress semantics.

## Test plan

- FE: cancelled complete does not jump to 100
- FE: successful complete still ends at 100
- BE: notification includes `cancelled: true` when cancelled

## Done criteria

- [ ] Complete notifications include `cancelled` (and progress when cancelled)
- [ ] UI does not force 100% on cancel
- [ ] History options store `cancelled`
- [ ] vitest + lint/typecheck gates pass
- [ ] `plans/README.md` 004 → DONE

## STOP conditions

- `ProcessStatus` type used in many places and adding fields breaks broadly — keep `cancelled` optional
- save_run schema validation rejects unknown options — check `backend/core/run_types.py` and extend schema if required (still in scope if needed for save)

## Maintenance notes

- Plan 010 will rely on `cancelled` in complete payloads for generation discard tests.
- Reviewer: ensure SegmentedProgressBar still works with partial progress.
