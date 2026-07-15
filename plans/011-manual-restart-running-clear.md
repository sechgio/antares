# Plan 011: Emit backend.restarting on forced/manual kill-restart

> **Executor instructions**: Follow step by step. Run verifications. STOP on mismatch. Update `plans/README.md` when done.
>
> **Drift check**: `git diff --stat 5aa6d8b..HEAD -- electron/backend-spawner.js frontend/src/hooks/useProcessRunner.ts frontend/src/hooks/useProcessRunner.test.tsx`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `5aa6d8b`, 2026-07-14

## Why this matters

`useProcessRunner` clears `running` only on `backend.restarting` | `backend.fatal` | `backend.error`. Auto-restart emits `backend.restarting`. User/manual restart and health-forced path call `manualRestart` → `startPythonBackend` which emits `backend.starting` only. Health path currently also emits `backend.error` first (mitigates health case), but **user** `backend-restart` IPC does not — conversion UI can stay “running” forever after a manual restart mid-job.

Tests explicitly require that `backend.starting` alone does **not** clear running (`useProcessRunner.test.tsx:157-170`) — so the fix belongs on the **emitter** side (or a carefully scoped FE change).

## Current state

```javascript
// backend-spawner.js manualRestart ~648-694
_forceKillProcess(pythonProcess);
...
await startPythonBackend(isDev); // emits backend.starting at attempt===1

// auto path ~503-506 emits backend.restarting
```

```typescript
// useProcessRunner.ts:32-35
if (method === 'backend.restarting' || method === 'backend.fatal' || method === 'backend.error') {
  setRunning(false);
  ...
}
```

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Spawner tests | `node tests/test-backend-spawner-recovery.js` | pass |
| Manual restart tests if any | `node tests/test-backend-spawner-manual-restart.js` | pass |
| FE hook | `cd frontend && npx vitest run src/hooks/useProcessRunner.test.tsx` | pass |

## Scope

**In scope**:
- `electron/backend-spawner.js` — notify `backend.restarting` when `manualRestart` kills/replaces a process (force or not)
- Tests for spawner notification
- Optionally FE only if emitter fix insufficient

**Out of scope**: Changing meaning of `backend.starting` for first app launch; plan 002/003

## Git workflow

- Branch: `advisor/011-manual-restart-running-clear`
- Commit: `fix(electron): emit backend.restarting on manual kill-restart`
- No push unless asked

## Steps

### Step 1: Emit restarting from manualRestart

When `manualRestart` actually kills a process (or force-restarts):

```javascript
_notifyRenderer('backend.restarting', { reason: 'manual', force });
```

before or after kill, consistent with auto-restart payload shape (read auto-restart notify and match fields).

Do **not** emit restarting on no-op path (`!force && already READY`).

### Step 2: Tests

- Manual restart while ready (force) → restarting notified
- First start of app → still `backend.starting` only (no false restarting if never ready)

Keep FE test: starting alone does not clear running (still valid for cold start).

**Verify**: node + vitest pass.

## Done criteria

- [ ] Forced/manual kill-restart notifies `backend.restarting`
- [ ] Cold start still uses `backend.starting`
- [ ] Conversion UI clears running on user restart
- [ ] `plans/README.md` 011 → DONE

## STOP conditions

- Double notify confuses other UI listeners — check subscribers of `backend.restarting` in frontend

## Maintenance notes

- Health path may emit both error and restarting — OK if FE is idempotent on clear running.
