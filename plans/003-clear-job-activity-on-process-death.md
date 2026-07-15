# Plan 003: Clear job-activity grace when backend process dies

> **Executor instructions**: Follow step by step. Run verifications. STOP on mismatch. Update `plans/README.md` when done.
>
> **Drift check**: `git diff --stat 5aa6d8b..HEAD -- electron/ipc-router.js electron/backend-spawner.js tests/test-health-probe-skip-during-requests.js`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/002-ipc-process-close-identity.md (same close handler; land 002 first or merge carefully)
- **Category**: bug
- **Planned at**: commit `5aa6d8b`, 2026-07-14

## Why this matters

Job activity timestamps (`noteJobActivity` / `hasRecentJobActivity`) suppress health restarts for ~60s during long conversions. On process death, activity is only cleared on `process.complete` / `job.*.complete`. Crash/kill mid-job leaves activity set, so a newly spawned backend that wedges can avoid health restarts for up to a minute.

## Current state

- `electron/ipc-router.js:102-112` — notes activity on progress/heartbeat; clears only on complete
- `electron/ipc-router.js:135-143` — process `close` does **not** call `clearJobActivity()`
- `electron/backend-spawner.js` — exports `noteJobActivity`, `clearJobActivity`, `hasRecentJobActivity` (verify exact export names in file)
- Grace window ~60s (`backend-spawner.js` near constants for job activity)

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Health tests | `node tests/test-health-probe-skip-during-requests.js` | pass |
| Spawner recovery | `node tests/test-backend-spawner-recovery.js` | pass |

## Scope

**In scope**:
- `electron/ipc-router.js` (close handler when attached process dies)
- Optionally `electron/backend-spawner.js` (`killPython` / `manualRestart` entry) if cleaner
- `tests/test-health-probe-skip-during-requests.js` or new small test

**Out of scope**: Changing grace duration; heartbeat protocol; frontend

## Git workflow

- Branch: `advisor/003-clear-job-activity-on-process-death`
- Commit: `fix(electron): clear job activity when backend process exits`
- No push unless asked

## Steps

### Step 1: Test

Add assertion: after `noteJobActivity()`, simulate process death / call the clear path used on close, then `hasRecentJobActivity()` is false.

**Verify**: test fails before fix if activity stuck; passes after.

### Step 2: Clear on death

In the **attached** process `close` handler (after plan 002 identity check), call `clearJobActivity()` before or after rejecting pendings.

Also call `clearJobActivity()` from `killPython` / start of `manualRestart` if close might not fire reliably on Windows — check existing kill path; do not double-break health tests.

**Verify**: health skip test still passes for live jobs (progress still notes activity); new death-clear test passes.

## Done criteria

- [ ] Process death clears job activity
- [ ] Live conversion still skips health restart via activity
- [ ] Scoped node tests pass
- [ ] `plans/README.md` 003 → DONE

## STOP conditions

- Clearing activity causes flaky health kills during normal conversion — re-check heartbeat emission
- Plan 002 not applied and close handler still wrong identity — stop and do 002 first

## Maintenance notes

- Any new job notification types that imply liveness must call `noteJobActivity`; terminal paths must clear.
