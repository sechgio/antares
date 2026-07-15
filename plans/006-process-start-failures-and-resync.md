# Plan 006: Surface process start failures and resync on already_running

> **Executor instructions**: Follow step by step. Run verifications. STOP on mismatch. Update `plans/README.md` when done.
>
> **Drift check**: `git diff --stat 5aa6d8b..HEAD -- frontend/src/hooks/useProcessRunner.ts frontend/src/hooks/useProcessRunner.test.tsx frontend/src/components/conversion/ConversionView.tsx`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `5aa6d8b`, 2026-07-14

## Why this matters

`doProcess` ignores soft failures and does not catch hard errors → unhandled rejections / silent no-op. Soft `already_running` forces UI idle without `pollStatus()`, so the UI can show idle while the backend job still runs.

## Current state

```typescript
// ConversionView.tsx ~498-514
const doProcess = async () => {
  if (!allReady || running) return;
  await startProcess({ ... }); // no try/catch, ignore return
};

// useProcessRunner.ts ~61-68
setRunning(true);
const result = await api.startProcess(body);
if (!result?.started) {
  setRunning(false);  // always, including already_running
  ...
  return result;
}
```

Backend returns `{ started: false, reason: "already_running" }` when job running (`conversion.py:418-421`).

Test currently **locks** the bad already_running clear: `useProcessRunner.test.tsx:83-96`.

Toasts: use existing `addToast` pattern in ConversionView (search for `addToast` usage).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Hook tests | `cd frontend && npx vitest run src/hooks/useProcessRunner.test.tsx` | pass |
| Conversion tests | `cd frontend && npx vitest run src/components/conversion` | pass |
| Typecheck | `npm run typecheck:frontend` | exit 0 |

## Scope

**In scope**:
- `frontend/src/hooks/useProcessRunner.ts`
- `frontend/src/hooks/useProcessRunner.test.tsx`
- `frontend/src/components/conversion/ConversionView.tsx` (`doProcess` only)

**Out of scope**: Backend process_start; cancel path; other views that start jobs

## Git workflow

- Branch: `advisor/006-process-start-failures-and-resync`
- Commit: `fix(frontend): toast process start failures and resync already_running`
- No push unless asked

## Steps

### Step 1: useProcessRunner soft-fail branching

On `!result?.started`:
- If `reason === 'already_running'`: call `await pollStatus()` (do **not** force idle first); return result
- Else (`no_files`, `no_destination`, unknown): clear running as today

Update test `clears running on soft start failure { started: false }`:
- Split into: `no_files` clears running; `already_running` ends with running true if pollStatus returns running true

### Step 2: ConversionView doProcess

```typescript
const doProcess = async () => {
  if (!allReady || running) return;
  try {
    const result = await startProcess({ ... });
    if (result && result.started === false) {
      // toast reason — map known reasons to Spanish/i18n strings used in app
      addToast(...);
    }
  } catch (err) {
    addToast(/* error message */);
  }
};
```

Match existing toast API (severity, message). Prefer locale keys if the file already uses `t(...)`.

**Verify**: vitest + typecheck pass.

## Done criteria

- [ ] Hard start errors toast, no unhandled rejection from button click
- [ ] Soft non-running reasons toast and clear running
- [ ] `already_running` resyncs via pollStatus
- [ ] Tests updated
- [ ] `plans/README.md` 006 → DONE

## STOP conditions

- No toast system available in ConversionView — use existing error UI pattern in that file
- pollStatus mock missing in tests — extend mocks like other tests

## Maintenance notes

- Other screens that call `startProcess` should mirror toast handling later (out of scope).
