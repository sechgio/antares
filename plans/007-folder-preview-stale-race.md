# Plan 007: Fix FolderPreviewStrip stale-result race

> **Executor instructions**: Follow step by step. Run verifications. STOP on mismatch. Update `plans/README.md` when done.
>
> **Drift check**: `git diff --stat 5aa6d8b..HEAD -- frontend/src/components/autoimg/components/FolderPreviewStrip.tsx frontend/src/components/autoimg/components/FolderPreviewStrip.test.tsx`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `5aa6d8b`, 2026-07-14

## Why this matters

A shared `cancelled` ref is set true on cleanup then immediately false on the next effect when `idsKey` changes. In-flight previews from the previous folder list can still write `sessionCache` and `setPreviews`, showing wrong thumbnails and poisoning the cache.

## Current state

`frontend/src/components/autoimg/components/FolderPreviewStrip.tsx`:

```typescript
const cancelled = useRef(false);
useEffect(() => {
  cancelled.current = false;  // clears previous cleanup
  ...
  void mapWithConcurrency(pending, CONCURRENCY, async (folderId) => {
    const res = await api.autoimgDriveFolderPreview(folderId);
    if (cancelled.current) return;  // may be false again for newer effect
    setSessionCache(folderId, res.thumbs);
    setPreviews(...);
  });
  return () => { cancelled.current = true; };
}, [idsKey]);
```

Existing test file: `FolderPreviewStrip.test.tsx`.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `cd frontend && npx vitest run src/components/autoimg/components/FolderPreviewStrip.test.tsx` | pass |
| Typecheck | `npm run typecheck:frontend` | exit 0 |

## Scope

**In scope**:
- `FolderPreviewStrip.tsx`
- `FolderPreviewStrip.test.tsx`

**Out of scope**: Other AutoIMG caches; backend preview API

## Git workflow

- Branch: `advisor/007-folder-preview-stale-race`
- Commit: `fix(autoimg): generation guard for folder preview strip`
- No push unless asked

## Steps

### Step 1: Generation counter

Replace boolean with:

```typescript
const reqGen = useRef(0);
useEffect(() => {
  const gen = ++reqGen.current;
  ...
  if (gen !== reqGen.current) return; // before setState/cache write
  return () => { /* optional: no need to set flag if gen is monotonic */ };
}, [idsKey]);
```

On cleanup, either increment gen or compare captured `gen` to `reqGen.current` after await (standard pattern: capture `gen` at start; after await require `gen === reqGen.current`).

**Do not** reset a shared boolean to false at effect start.

### Step 2: Test

Mock slow `autoimgDriveFolderPreview` for folder A; change ids to B before resolve; assert A’s thumbs never applied / cache not set for A after switch (or state shows B only).

**Verify**: vitest passes.

## Done criteria

- [ ] Stale responses ignored
- [ ] Regression test covers rapid idsKey change
- [ ] typecheck pass
- [ ] `plans/README.md` 007 → DONE

## STOP conditions

- Component structure differs substantially — re-read file and apply same gen pattern

## Maintenance notes

- sessionCache is module-level or parent — ensure stale writes never call `setSessionCache` for cancelled gens.
