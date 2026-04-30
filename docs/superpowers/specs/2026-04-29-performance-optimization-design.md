# Performance Optimization Design

**Date:** 2026-04-29  
**Scope:** Aggressive performance optimization across frontend and backend  
**Constraint:** No functionality changes — all features remain identical  

## Problem

HidroConvert is slow across all operations: startup, file loading, preview generation, batch conversion, and UI navigation. Root causes identified:

1. All views render on startup (no lazy loading)
2. framer-motion LayoutGroup on 500+ FileCards causes layout thrashing
3. Sequential `isVideo` IPC call per file (500 files = 500 roundtrips)
4. Status polling every 1s despite push notifications already available
5. Sequential image conversion in backend (no parallelism)
6. SQLite opens/closes connection per query (no pooling, no WAL)
7. No list virtualization for large file sets

## Design

### 1. Lazy Loading of Views (Frontend)

**Before:** All 6 tab views rendered conditionally via `{activeTab === 'X' && <View />}`  
**After:** `React.lazy()` + `Suspense` — each view loads only when tab is first visited

```tsx
const ConversionView = React.lazy(() => import('./components/conversion/ConversionView'));
const DatabaseView = React.lazy(() => import('./components/database/DatabaseView'));
// etc.
```

Impact: ~40% faster cold start, reduced initial JS bundle.

### 2. Replace framer-motion in FileGrid/FileCard (Frontend)

**Before:** `AnimatePresence` + `motion.div layout` on every FileCard  
**After:** CSS transitions only — `transition-all duration-200` on transform/opacity

framer-motion retained only for PreviewDrawer (single animated element).

Impact: Eliminates layout thrashing with 500+ animated nodes.

### 3. Client-side Video Detection (Frontend)

**Before:** `api.isVideo(file)` — one IPC call per file  
**After:** Check file extension client-side against `VIDEO_EXTENSIONS` set

```ts
const VIDEO_EXTENSIONS = new Set(['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.3gp', '.mpg', '.mpeg']);
const isVideo = (path: string) => VIDEO_EXTENSIONS.has(path.split('.').pop()?.toLowerCase() ?? '');
```

Impact: 500 files: 500 IPC calls → 0.

### 4. Replace Polling with Push Notifications (Frontend)

**Before:** `setInterval(pollStatus, 1000)` runs continuously  
**After:** Subscribe to `process.progress` / `process.complete` notifications only. Call `getStatus()` once on mount to recover previous state.

Impact: Eliminates 1 IPC call per second while idle.

### 5. Parallel Image Conversion (Backend)

**Before:** `_process_thread` processes files sequentially in a for loop  
**After:** `concurrent.futures.ProcessPoolExecutor` with `min(cpu_count, 4)` workers

```python
from concurrent.futures import ProcessPoolExecutor, as_completed
import os

MAX_WORKERS = min(os.cpu_count() or 2, 4)

with ProcessPoolExecutor(max_workers=MAX_WORKERS) as pool:
    futures = {pool.submit(convertir_imagen, ...): fpath for fpath in files}
    for future in as_completed(futures):
        # handle result, update state
```

Impact: Near-linear speedup on multi-core CPUs (2-4x for typical 4-core machines).

### 6. SQLite Connection Pooling + WAL (Backend)

**Before:** `sqlite3.connect()` + close in every function  
**After:** Module-level connection with WAL mode, reused across calls

```python
_db_conn: sqlite3.Connection | None = None

def _get_connection() -> sqlite3.Connection:
    global _db_conn
    if _db_conn is None:
        _db_conn = sqlite3.connect(str(get_db_path()))
        _db_conn.execute("PRAGMA journal_mode=WAL")
        _db_conn.row_factory = sqlite3.Row
    return _db_conn
```

Impact: Eliminates connection overhead per query. WAL enables concurrent reads during writes.

### 7. Batch is_videos Handler (Backend) — Optional

Only needed if future frontend needs backend video detection. Made redundant by #3.

### 8. List Virtualization (Frontend)

**Before:** Render all 500 FileCards in DOM  
**After:** Use `react-window` FixedSizeGrid — only render visible items + small overscan

```tsx
import { FixedSizeGrid } from 'react-window';
// Grid with column width=140, row height=180, dynamic column count
```

Impact: 500 DOM nodes → ~20-30 visible at once. Dramatic scroll/render improvement.

## Implementation Order

1. **Frontend lazy loading** — immediate startup gain, low risk
2. **Client-side video detection** — eliminates 500 IPC calls, trivial change
3. **Replace polling with push** — removes constant IPC noise
4. **Remove framer-motion from lists** — eliminates layout thrashing
5. **List virtualization** — DOM reduction for large sets
6. **Backend parallel conversion** — biggest processing speedup
7. **SQLite WAL + pooling** — database query speedup

## Testing Strategy

- All existing tests must pass unchanged
- Manual test: load 500 files, verify UI responsiveness
- Manual test: convert 100 images, verify parallel execution
- Verify process cancellation still works with parallel conversion
- Verify notifications still arrive correctly without polling
