# Final Fix Report — perf/ux-fixes review d1adc38..fed7a91

**Branch:** perf/ux-fixes
**Base:** d1adc38..fed7a91
**Fix Commit:** fix(perf): address final review findings
**Date:** 2026-08-31

## Issues Fixed (Important ×3)

### 1) frontend/src/api.ts:753-755,791-810 — templates_list invalidation missing

**Finding:** `templates_list` cached with 5min TTL had no invalidation path after mutating ops. Search found no `formatos_upload`/`formatos_delete` mutator for `templates_list`; `templates_list` is read-only bundled HTML (`backend/templates` + `user_data/templates` overrides per `backend/handlers/templates.py:43`). No `template_upload`/`template_delete` IPC exists.

**Fix:** Added explanatory comment above `templatesList` (`api.ts:752-757`) documenting TTL is intentional:

```ts
// templates_list is quasi-immutable: bundled HTML under backend/templates (plus
// user_data/templates overrides). No mutating IPC exists (no template upload/
// delete); the only way to add templates is to drop HTML files and restart.
// TTL=5min is intentional — avoids stale while keeping dedupe/cache benefits.
templatesList: () => cachedInvoke('templates_list', () => _invoke(...))
```

**Rationale:** Templates are immutable post-boot; user dropping HTML into `%LOCALAPPDATA%\Antares\templates` during session requires restart to be picked up. 5min TTL is acceptable; no `invalidateApiCache('templates_list')` mutator needed. `formatos_list` is intentionally NOT cached (direct `_invoke`) so `formatos_upload`/`formatos_delete` need no invalidation.

**Alternative considered:** Adding `.then(v=>{invalidateApiCache('templates_list');return v})` to a non-existent mutator was rejected; stub invalidation would be dead code.

### 2) frontend/src/components/conversion/ConversionView.tsx:1662-1670 — removeSelectedFiles not stable

**Finding:** `const removeSelectedFiles = useCallback(()=>{...selectedFiles...},[selectedFiles])` recreated on every selection change, causing FileGrid re-renders and keydown listener re-subscription.

**Fix:** Ref-based stable callback:
```ts
const selectedFilesRef = useRef(selectedFiles);
useEffect(() => { selectedFilesRef.current = selectedFiles; }, [selectedFiles]);

const removeSelectedFiles = useCallback(() => {
  const cur = selectedFilesRef.current;
  setFiles((prev) => {
    const next = prev.filter((p) => !cur.has(p));
    ...
  });
}, []);

// Listener now stable, uses ref for size check
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (selectedFilesRef.current.size === 0) return;
    ...
    removeSelectedFiles();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [removeSelectedFiles]);
```

**Verification:** `FileGrid.test.tsx:123` expects `const removeSelectedFiles = useCallback` — still matches. Handler stability tests pass (see below).

### 3) frontend/vite.config.ts:51-53 — alias overreach

**Finding:** Plan required only `canvg` stub for jspdf SVG, but `html2canvas` + `dompurify` also stubbed. Those two leave 227KB in `empty-module` chunk if only `canvg` is stubbed, but no src imports exist.

**Verification:** `grep -r html2canvas|dompurify frontend/src` → 0 matches (only `vite.config.ts` and `package.json` overrides). `frontend/package.json` retains `dompurify` override for transitive dep, but no static import.

**Fix:** Reverted to canvg-only per plan:
```ts
resolve: {
  alias: {
    '@': path.resolve(..., './src'),
    canvg: path.resolve(..., './src/empty-module.js'),
  },
}
```
Kept `frontend/src/empty-module.js` with `export default {}; export const h/p/e = {};` (covers `canvg` named export `e` and keeps `h/p` harmless). No functional change; Vite alias overreach removed.

**Deferred (Optional):** Shared cell renderer extraction for `DataPreviewModal` — marked deferrable, not in scope for this fix.

## Verification

```bash
$ cd frontend && npx tsc --noEmit
# (no output, exit 0)

$ npm run check:budgets
canvas chunk: index-D_S8pi86.js (332.1 KB)
incremental (beyond shell): 457.8 KB (budget 500 KB)
OK: Canvas incremental 457.8 KB within budget; no forbidden static vendors
shell JS: index-DrwPr3Lu.js, vendor-react-DyGFuK0t.js, vite-preload-DTdAas1V.js, vendor-i18n-D6eI48Cm.js, vendor-icons-DBF-lof8.js
OK: shell preload clean (5 JS assets); no forbidden heavy vendors

$ npx vitest run src/api.cache.test.ts src/components/conversion/FileGrid.test.tsx src/hooks/context-memo.test.tsx --reporter=verbose
✓ src/api.cache.test.ts (10 tests: dedupes concurrent templatesList, caches sequential, invalidates on demand, dedupes getFields/renamePatterns/dbColumns/theme, mutating invalidates theme_get, does not cache failed, clear all)
✓ src/components/conversion/FileGrid.test.tsx (2 tests: cellProps stable when parent re-renders, cellProps memo does not recreate when handlers stable)
✓ src/hooks/context-memo.test.tsx (3 tests: toast/dialog/auth provider does not re-render consumers)
Test Files 3 passed (3), Tests 15 passed (15)

$ npx vitest run src/__tests__/api.test.ts
✓ src/__tests__/api.test.ts (17 tests: IPC error handling, timeout budgets, hydrate, etc.)
Test Files 1 passed, Tests 17 passed
```

## Files Changed

- `frontend/src/api.ts` (+5 comment lines, `templates_list` TTL doc)
- `frontend/src/components/conversion/ConversionView.tsx` (+7/-4, `selectedFilesRef` + stable `removeSelectedFiles` + stable keydown listener)
- `frontend/vite.config.ts` (-2 aliases, keep `canvg` only)
- `.superpowers/sdd/final-fix-report.md` (this report)

No change to `frontend/src/empty-module.js` (retains `default+h/p/e`).

## Commit

`fix(perf): address final review findings` on `perf/ux-fixes` HEAD (fed7a91 + fixes)

**Report path:** `C:/Users/HIDROAA/Desktop/antares/.superpowers/sdd/final-fix-report.md`
