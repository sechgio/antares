# Plan 005: Guard ConversionView mount bootstrap vs history re-execute

> **Executor instructions**: Follow step by step. Run verifications. STOP on mismatch. Update `plans/README.md` when done.
>
> **Drift check**: `git diff --stat 5aa6d8b..HEAD -- frontend/src/components/conversion/ConversionView.tsx frontend/src/components/conversion/ConversionView*.test.tsx`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `5aa6d8b`, 2026-07-14

## Why this matters

On mount, ConversionView applies a pending history re-execute (async) and in parallel loads fields/DB columns, which **unconditionally** overwrites `patron`, `namingMode`, and often `renameSource` when responses arrive. Reejecutar while Convert was unmounted can be wiped when bootstrap resolves later. Same race if user edits pattern before bootstrap finishes.

## Current state

`frontend/src/components/conversion/ConversionView.tsx`:

```typescript
// ~187-196: apply pending history
useEffect(() => {
  const pending = takePendingHistoryReexecute();
  if (pending) applyHistoryRun(pending);
  return subscribeHistoryReexecute(...);
}, [applyHistoryRun]);

// ~199-251: bootstrap ALWAYS setPatron/setNamingMode/setRenameSource
if (fieldsResult.status === 'fulfilled') {
  ...
  setPatron(defaultPat);      // overwrites history
  setNamingMode(...);
}
if (dbColumnsResult.status === 'fulfilled') {
  if (columns.length > 0) {
    setRenameSource('catalog');  // overwrites mapping re-execute
    setFields(columns);
  }
}
```

`applyHistoryRun` (~97-185) sets files, patron, renameSource, mapping, etc. asynchronously (may await `api.dbParseMapping`).

Conventions: React function components, vitest + Testing Library. Existing tests: `ConversionView.mapping.test.tsx`, `ConversionView.preview.test.tsx`.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| FE tests | `cd frontend && npx vitest run src/components/conversion` | pass |
| Typecheck | `npm run typecheck:frontend` | exit 0 |

## Scope

**In scope**:
- `frontend/src/components/conversion/ConversionView.tsx`
- New or extended tests under `frontend/src/components/conversion/`

**Out of scope**:
- History storage backend
- Changing default pattern formulas (only when they apply)
- Plan 012 selectedFile (can mention but not implement)

## Git workflow

- Branch: `advisor/005-history-reexecute-bootstrap-guard`
- Commit: `fix(conversion): do not clobber re-execute with mount defaults`
- No push unless asked

## Steps

### Step 1: Choose minimal guard (recommended)

Use a ref `defaultsLockedRef` (or `userConfigGen`):

1. On successful `applyHistoryRun` start (or when pending history exists at mount), set `defaultsLockedRef.current = true`.
2. Bootstrap `setPatron` / `setNamingMode` / `setRenameSource('catalog')` only run when `!defaultsLockedRef.current`.
3. Still allow `setFields` / `setFormats` / `setPatterns` / `setDbColumns` always (data lists, not user config) — unless history already set fields; prefer: set fields from bootstrap only if fields still equal initial empty/default.

Alternative acceptable approach: only apply default patron if `patron` is still the initial constant used in `useState`.

Do **not** skip bootstrap entirely when no history — first load must still get defaults.

### Step 2: Concurrent re-execute generation (related BUG-06)

If cheap: bump `applyGen` at start of `applyHistoryRun`; ignore late async writes when gen mismatches. Include if tests are easy; otherwise STOP note as deferred only if timeboxed — prefer include, effort is small.

### Step 3: Tests

Simulate:
1. Mount with pending history payload that sets patron `HIST_{seq}{ext}` and renameSource mapping
2. Resolve getFields/getDbColumns after a tick with columns
3. Assert patron and renameSource still from history

Mock `api` like existing ConversionView tests.

**Verify**: vitest conversion suite passes; typecheck passes.

## Done criteria

- [ ] History re-execute not overwritten by late bootstrap defaults
- [ ] Fresh mount without history still gets default patron
- [ ] Tests cover the race
- [ ] typecheck clean
- [ ] `plans/README.md` 005 → DONE

## STOP conditions

- `takePendingHistoryReexecute` API differs from plan description
- Fix requires rewriting entire ConversionView state into a reducer without clear win — pick the ref lock instead

## Maintenance notes

- Any new mount-time default setters must honor the same lock.
- Reviewer: verify mapping re-execute still restores mappingPath/columns.
