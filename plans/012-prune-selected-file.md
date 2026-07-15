# Plan 012: Prune selectedFile when file list changes

> **Executor instructions**: Follow step by step. Run verifications. STOP on mismatch. Update `plans/README.md` when done.
>
> **Drift check**: `git diff --stat 5aa6d8b..HEAD -- frontend/src/hooks/useFileSelection.ts frontend/src/hooks/**/*FileSelection*`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `5aa6d8b`, 2026-07-14

## Why this matters

`useFileSelection` prunes `selectedFiles` Set when paths leave the list, but leaves `selectedFile` (primary highlight) pointing at a removed path. After history re-execute or bulk list replace, UI can highlight a ghost file.

## Current state

`frontend/src/hooks/useFileSelection.ts:14-27` — only prunes Set, not primary:

```typescript
useEffect(() => {
  setSelectedFiles((prev) => { /* filter to filesSet */ });
}, [filesSet]);
// selectedFile never cleared
```

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `cd frontend && npx vitest run src/hooks` (or new test file path) | pass |
| Typecheck | `npm run typecheck:frontend` | exit 0 |

## Scope

**In scope**:
- `frontend/src/hooks/useFileSelection.ts`
- New test `frontend/src/hooks/useFileSelection.test.ts(x)` if none exists

**Out of scope**: ConversionView history apply beyond what hook fix covers

## Git workflow

- Branch: `advisor/012-prune-selected-file`
- Commit: `fix(frontend): clear primary selection when file leaves list`
- No push unless asked

## Steps

### Step 1: Prune selectedFile

In the same `filesSet` effect (or adjacent):

```typescript
setSelectedFile((prev) => {
  if (prev == null || filesSet.has(prev)) return prev;
  return null; // or files[0] if product prefers always-one-selected
});
```

Prefer `null` unless ConversionView assumes non-null — check usages; if preview requires a path, fall back to `files[0] ?? null`.

### Step 2: Test

Render hook with files `['a','b']`, select `a`, change files to `['b']`, expect selectedFile not `a`.

**Verify**: vitest + typecheck.

## Done criteria

- [ ] Primary selection never points outside `files`
- [ ] Multi-select prune still works
- [ ] `plans/README.md` 012 → DONE

## STOP conditions

- Callers require selectedFile always set — use first remaining file fallback

## Maintenance notes

- Keep prune O(n) over selection only, not full list scans beyond Set.
