# Plan 017 notes — AutoIMG rename audit / dry-run spike

> Spike only (2026-07-13). No product code, no Drive writes, no reverse rename.
> Behavior freeze: `autoimg_rename_export` semantics unchanged.

## Drift check (run)

```text
git diff --stat 3174e83..HEAD -- electron/autoimg-sync-engine.js electron/autoimg-ipc-methods.js frontend/src/components/autoimg/
```

Observed: **no** diff on `autoimg-sync-engine.js` / `autoimg-ipc-methods.js`. Frontend AutoIMG had additive stale-guard edits only (`AutoIMGApp.tsx`, `RenameExportPanel.tsx`, tests) — export algorithm below still matches electron sources.

---

## 1. Current export algorithm (NIS → SGIO)

### Entry points

| Layer | Symbol | Role |
|-------|--------|------|
| IPC | `autoimg_rename_export` | Handler in `electron/autoimg-handlers.js` |
| IPC | `autoimg_rename_dest_config` | Returns remembered root folder `{ folder_id, name }` |
| Engine | `renameExport(params)` → `_renameExportCore(params)` | `electron/autoimg-sync-engine.js` |
| Helpers | `buildNisMetaMap`, `buildRenameJobs`, `buildSgioFilename`, `normalizeSgio`, `normalizeDestino`, `uniqueDestinos` | `electron/autoimg-rename.js` |
| UI | `RenameExportPanel.tsx` | Export-only; checkbox `onlyCompletos` (default true) |

### Inputs

```text
dest_folder_id   — Drive parent folder ID (root). Subfolders named from BD_IMG DESTINO are created under it.
only_completos   — default true (handler: params.only_completos !== false)
```

Data sources inside `_renameExportCore`:

1. **BD_IMG!A:C** via `sheets.readRange` → `buildNisMetaMap(bdValues)`
   - Col A = NIS, B = SGIO, C = DESTINO (header row `NIS` skipped when present)
2. **Live scan** via `_scanAllCore()` → `scan.results.nis_results`
   - Each result: `{ nis, count, files: [{ id, name, slot? }, ...] }`

### Naming rules (7 → 8 digits)

- Source files are typically NIS-based (7 digits), e.g. `6553447_1.jpg`.
- Target name is **exactly 8-digit SGIO** + `_` + slot + extension:
  - `buildSgioFilename(sgio, slot, originalName)` → `{SGIO}_{n}{ext}`
  - Pattern enforced: `/^\d{8}_\d+\.[a-z0-9]+$/i`
- `normalizeSgio`: accepts exact `\d{8}` or extracts an 8-digit run from surrounding text; **7-digit values are rejected** (`null`).
- Slot: prefer `file.slot` if valid and unused; else assign next free integer starting at 1 (files sorted by name `es` locale).
- Extension: taken from original filename (lowercased); default `.jpg` if missing.

### Copy vs rename

- **Copy only.** Comment and implementation: original is neither moved nor deleted.
- Drive API: `drive.copyFileToFolder(job.fileId, targetFolderId, job.toName)`.
- Concurrency: `RENAME_COPY_CONCURRENCY = 3` via `mapWithConcurrency`.
- DESTINO subfolders: `drive.findOrCreateSubfolder(rootFolderId, name)` before copies.

### Skip conditions (`buildRenameJobs` / `onlyCompletos`)

| Reason | When |
|--------|------|
| `sin_sgio` | No usable 8-digit SGIO in BD_IMG col B |
| `sin_destino` | Empty DESTINO (col C) after `normalizeDestino` |
| `no_completo` | `onlyCompletos` and `result.count !== 3` |
| `sin_archivos` | Scan entry has no named files |
| `sin_file_id` | File missing Drive `id` |
| `nombre_invalido` | `buildSgioFilename` throws |
| `nombre_duplicado` | Same `DESTINO\0toName` already planned |

Dedupe is **per DESTINO folder**: identical SGIO filenames in different DESTINO folders are allowed.

### Job / result shape (export)

Each planned job:

```js
{ fileId, fromName, toName, nis, sgio, destino, slot }
```

Return of `_renameExportCore`: `{ success, dest_folder_id, dest_name, destinos, folders_created, copied, failed, skipped, planned, scan_summary }`.

Side effects (export path only): CONFIG `RENAME_DEST_FOLDER_ID`, local prefs `saveRenameDest`, optional LOGS row `RENAME_SGIO`. Progress events: `autoimg.rename.folder|plan|progress|complete`.

---

## 2. Proposed audit output JSON (read-only)

Goal: reconcile **expected** SGIO names (from BD_IMG + same job planner) against **found** files under the export root’s DESTINO subfolders — without writing to Drive.

### BD_IMG columns actually used by rename today

| Col | Index | Header | Used by rename? |
|-----|-------|--------|-----------------|
| A | 0 | NIS | yes — join key |
| B | 1 | SGIO | yes — `normalizeSgio` |
| C | 2 | DESTINO | yes — subfolder name |
| D–M | 3–12 | NOMBRE … NOTAS | **not** read by rename (`BD_IMG!A:C` only) |

Audit must not invent sheet writes. Accuracy depends on sync/bootstrap freshness (same STOP note as the plan).

### Suggested response shape

```ts
type AuditStatus = 'missing' | 'match' | 'conflict';

interface AutoimgRenameAuditItem {
  nis: string;
  sgio: string;           // BD_IMG col B (normalized)
  destino: string;        // BD_IMG col C (normalized)
  slot: number;
  expected_name: string;  // buildSgioFilename result, e.g. "70942759_1.jpg"
  found_name: string | null; // name present in DESTINO folder, if any
  status: AuditStatus;
  file_id: string | null; // Drive id of found file when present; null if missing
}

interface AutoimgRenameAuditResult {
  dest_folder_id: string;
  dest_name: string;
  dry_run: true;          // always true for this IPC
  only_completos: boolean;
  planned: number;        // expected jobs from buildRenameJobs
  items: AutoimgRenameAuditItem[];
  skipped: Array<{ nis: string; reason: string; detail?: string }>; // same skip reasons as export planner
  summary: {
    match: number;
    missing: number;
    conflict: number;
    skipped: number;
  };
}
```

### Status semantics

| Status | Meaning |
|--------|---------|
| `match` | DESTINO folder contains a file named `expected_name` (optionally verify `file_id` listed) |
| `missing` | Expected name not found under that DESTINO subfolder |
| `conflict` | Folder has a conflicting artifact for this slot (e.g. wrong name pattern claiming same SGIO+slot, duplicate names, or unexpected extra file that blocks a clean match — exact conflict rules to lock in tests) |

Reuse **`buildRenameJobs`** for the expected set so audit and export share naming/skip logic. Listing DESTINO children is new read-only Drive work; do not call `copyFileToFolder` / rename / delete.

Optional future IPC name (out of scope until notes approved): `autoimg_rename_audit`. Default params mirror export (`dest_folder_id`, `only_completos`) plus **forced** `dry_run: true`.

---

## 3. Implementation gate (before any UI)

Do **not** ship Drive-mutating reverse import in this plan. If a write path is ever proposed, it needs its own plan + irreversible-action UX.

### Tests to add first (mirror `tests/test-autoimg-rename.js`)

Add e.g. `tests/test-autoimg-rename-audit.js` (pure unit, no live Drive):

1. **Planner parity** — Given fixture `nis_results` + `buildNisMetaMap` rows, expected `expected_name` / skip reasons match `buildRenameJobs` output.
2. **Status classification** — Fixture folder listings:
   - empty listing → all planned jobs `missing`, `file_id: null`
   - exact `expected_name` present → `match` + that `file_id`
   - wrong name for same SGIO/slot or duplicate → `conflict`
3. **only_completos** — Incomplete NIS (`count !== 3`) appear in `skipped` with `no_completo` when flag true; included when false.
4. **DESTINO isolation** — Same `toName` in different DESTINO folders does not cross-contaminate match/conflict.
5. **SGIO rejection** — 7-digit / empty SGIO never produces audit items (skipped `sin_sgio`).
6. **JSON stability** — Snapshot or deep-equal of a fixed fixture → stable audit JSON (field names above).

Engine integration tests (optional second step): mock Drive list + sheets `A:C` → `renameAudit` returns `dry_run: true` and never invokes copy/rename APIs.

### Product gates

| Gate | Requirement |
|------|-------------|
| Dry-run default | Any audit IPC must be read-only; `dry_run: true` always for v1 |
| No silent writes | Zero `copyFileToFolder` / move / delete / sheet writes on audit path |
| Separate confirmation | Any **future** write/reverse path requires explicit second confirmation UX (and its own plan); must not share the export button |
| Stale UI | Pair UI with plans 002–003 so audit results are not stale-racy |
| Behavior freeze | Do not change `autoimg_rename_export` / `buildRenameJobs` semantics |

### Explicitly out of scope (this spike)

- Reverse rename that modifies Drive files
- Changing BD_IMG schema
- Shipping `autoimg_rename_audit` IPC/UI in this commit

---

## Verification (this spike)

```bash
node tests/test-autoimg-rename.js
node tests/test-autoimg-sync-engine.js
```

Expect exit 0; no electron/frontend product diffs for this deliverable.
