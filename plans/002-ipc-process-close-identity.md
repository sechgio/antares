# Plan 002: Scope IPC process-close cleanup to the dead process only

> **Executor instructions**: Follow step by step. Run every verification. STOP if conditions fire. Update `plans/README.md` when done (unless reviewer owns the index).
>
> **Drift check**: `git diff --stat 5aa6d8b..HEAD -- electron/ipc-router.js tests/test-backend-spawner-midflight-exit.js tests/test-backend-spawner-recovery.js tests/test-health-probe-skip-during-requests.js`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `5aa6d8b`, 2026-07-14

## Why this matters

When the backend restarts, the old process’s `close` event can fire after a new process is already attached. Today the close handler always nulls `_attachedProcess` and rejects **all** pending requests — including those belonging to the live process — and can leave listeners stacked (duplicate progress notifies).

## Current state

`electron/ipc-router.js`:

```javascript
// ~81-86: re-attach whenever process object identity changes
function _ensureListeners() {
  const proc = getProcess();
  if (!proc) return false;
  if (_attachedProcess === proc) return true;
  _attachedProcess = proc;
  // ... stdout.on('data', ...)
  proc.on('close', () => {
    _attachedProcess = null;  // ALWAYS — even if a newer process is attached
    for (const [, entry] of _pendingRequests) {
      clearTimeout(entry.timeout);
      entry.reject(new Error('Backend process exited while waiting for response'));
      decrementPendingRequests();
    }
    _pendingRequests.clear();
  });
}
```

No removal of old process listeners before re-attach.

Node tests pattern: `tests/test-backend-spawner-*.js` — plain assert helpers, mock `child_process`, no jest.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Related existing | `node tests/test-backend-spawner-midflight-exit.js` | all ✓ |
| New test (after add) | `node tests/test-ipc-router-process-close.js` (or name you choose) | all ✓ |
| Allowlist if touched | `node tests/test-electron-ipc-allowlist.js` | pass |

## Scope

**In scope**:
- `electron/ipc-router.js` (`_ensureListeners` close handler; optional request tagging)
- New Node test under `tests/` for this regression
- Wire new test into `package.json` `"test"` script **only if** every other `test-*.js` is listed there (match existing pattern)

**Out of scope**:
- backend-spawner restart policy (plan 011)
- clearJobActivity (plan 003 — leave a clear hook or do both only if 003 is executed in same PR; prefer 002 alone first)
- Frontend runner hooks

## Git workflow

- Branch: `advisor/002-ipc-process-close-identity`
- Commit: `fix(electron): ignore stale backend close after process replace`
- No push/PR unless asked

## Steps

### Step 1: Failing regression test

Write a Node test that:
1. Mocks/stubs enough of ipc-router + getProcess so you can call `_ensureListeners` for process A, then B.
2. Or: integration-style — attach A, swap `getProcess` to B and re-call `_ensureListeners`, then emit `close` on A.
3. Assert: pending request registered **after** B attached is **not** rejected by A’s close; `_attachedProcess` still B (or getProcess still returns B).

If ipc-router does not export internals, either:
- export a test-only helper, or
- test via public send path with mocked getProcess module cache (same pattern as `test-backend-spawner-midflight-exit.js`).

**Verify**: test fails on current code (or documents the bug if pure unit isolation is impossible — then implement fix + assert pass).

### Step 2: Fix close handler

In `proc.on('close', ...)`:

```javascript
proc.on('close', () => {
  // Ignore late close from a replaced process
  if (_attachedProcess !== proc) return;
  _attachedProcess = null;
  // reject pendings + clear as today
});
```

Also, when re-attaching (`_attachedProcess !== proc` before assign), if the old process still has listeners you added, remove them if Node API allows (`proc.stdout.removeAllListeners('data')` only if safe — STOP if unsure of side effects). Minimum fix is the identity guard; listener cleanup is best-effort if it does not break tests.

**Verify**: new test passes; existing spawner midflight/recovery tests still pass.

### Step 3: package.json

If you added `tests/test-ipc-router-process-close.js`, append it to the `"test"` script chain next to other electron tests.

**Verify**: `node tests/test-ipc-router-process-close.js` → all pass

## Test plan

- Late close from process A after B attached does not clear B’s pending map
- Close of current attached process still rejects pendings (existing behavior)

## Done criteria

- [ ] Close handler ignores non-attached process
- [ ] Regression test exists and passes
- [ ] Existing midflight/recovery node tests still pass
- [ ] No out-of-scope file edits
- [ ] `plans/README.md` 002 → DONE

## STOP conditions

- Fix requires rewriting entire IPC correlation protocol
- Cannot isolate ipc-router without large refactors — report and propose minimal export surface

## Maintenance notes

- Prefer tagging each pending request with the `proc` reference at send time if multi-process edge cases remain; deferred if identity guard is enough.
