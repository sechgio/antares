# Plan 014: Use parsePositiveInt for ImagePreview resize

> **Executor instructions**: Follow step by step. Run verifications. STOP on mismatch. Update `plans/README.md` when done.
>
> **Drift check**: `git diff --stat 5aa6d8b..HEAD -- frontend/src/components/ImagePreview.tsx frontend/src/components/ImagePreview.test.tsx frontend/src/components/conversion/helpers.ts`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `5aa6d8b`, 2026-07-14

## Why this matters

Image preview uses `parseInt` for resize dimensions when both strings are truthy, so values like `"12a"` become `12` or `NaN` can be sent. Process path uses `parsePositiveInt` and disables start when invalid — preview and process diverge.

## Current state

```typescript
// ImagePreview.tsx:102-103
const resize = ra && rh ? [parseInt(ra), parseInt(rh)] : null;
```

```typescript
// conversion/helpers.ts:174-176
export const parsePositiveInt = (value: string) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
```

Process uses `parsePositiveInt(resizeAncho/Alto)` in `ConversionView.tsx` ~503-504.

Existing tests: `ImagePreview.test.tsx`.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `cd frontend && npx vitest run src/components/ImagePreview.test.tsx` | pass |
| Typecheck | `npm run typecheck:frontend` | exit 0 |

## Scope

**In scope**:
- `frontend/src/components/ImagePreview.tsx`
- `frontend/src/components/ImagePreview.test.tsx`
- May import `parsePositiveInt` from `./conversion/helpers` or a shared util — if import path creates layering smell, **duplicate the 3-line helper** in ImagePreview or move helper to `frontend/src/utils/` only if already common. Prefer import from helpers if ConversionView already shares that module with ImagePreview via props only — check imports. Acceptable: inline same logic to avoid circular deps.

**Out of scope**: Backend preview_image validation; process path

## Git workflow

- Branch: `advisor/014-image-preview-parse-positive-int`
- Commit: `fix(frontend): validate ImagePreview resize with parsePositiveInt`
- No push unless asked

## Steps

### Step 1: Parse safely

```typescript
const w = parsePositiveInt(ra);
const h = parsePositiveInt(rh);
const resize = w != null && h != null ? [w, h] : null;
```

Treat empty or invalid as no resize (null), not NaN array.

### Step 2: Tests

- Invalid resize strings → `previewImage` called with `resize: null` (or omitted)
- Valid `"800"`,`"600"` → `[800, 600]`

**Verify**: vitest + typecheck.

## Done criteria

- [ ] No NaN resize sent to API
- [ ] Invalid partial inputs treated as no resize
- [ ] Tests updated
- [ ] `plans/README.md` 014 → DONE

## STOP conditions

- parsePositiveInt lives only under conversion and importing it pulls heavy modules — copy the pure function instead

## Maintenance notes

- Keep process and preview using the same numeric rules.
