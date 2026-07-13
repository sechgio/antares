# Plan 016 — Historial reexecute spike notes

> Design spike only. **No `reexecute: true` flags flipped.** Conversion behavior unchanged.
>
> Base: `bd0c48f`. Worktree branch: `advisor/016-historial-reexecute-spike`.
>
> Drift check (`git diff --stat 3174e83..HEAD -- frontend/src/components/history/ backend/core/run_types.py`): only `backend/core/run_types.py` (+34 lines — `ficha_tecnica` registry from plan 007). Frontend history components unchanged vs that baseline for reexecute wiring.

## 1. Inventory — every history save site

Helper: `frontend/src/utils/history.ts` → `saveFeatureHistory(runType, label, details, count)` stores:

- `files: [label]` (almost always a **display name / PDF filename**, not source paths)
- `options: details`
- `formato: label`, `patron: ''`, `calidad: 0`

Conversion is the exception: backend `save_run` in `backend/handlers/conversion.py` (not `saveFeatureHistory`).

| # | Call site | `run_type` | Options keys actually saved | Absolute paths? | Can UI rebuild from options alone? |
|---|-----------|------------|-----------------------------|-----------------|------------------------------------|
| 0 | `backend/handlers/conversion.py` (`save_run`) | `conversion` | `formato`, `calidad`, `conversion_enabled`, `resize`, `keep_exif`, `usar_rename`, `use_column_rename`, `rename_source`, `mapping_mode`, `mapping_path`, `id_column`, `rename_column`, `key_column`, `destino`, `secuencia`, `word_separator`, `use_filename_seq`, `sequence_mode` | **Yes** — `files_json` = source image absolute paths; `mapping_path` / `destino` may be absolute | **Yes** (already: `ConversionView.applyHistoryRun`) — missing mapping file → toast, no silent partial run |
| 1 | `frontend/src/components/formatos/FormatosView.tsx:651` | `formato` | `format_id`, `desde`, `hasta` | **No** — `files_json` = `[selected.nombre]` | **Yes** — if `format_id` still exists in catalog; set range and call `api.formatosGenerate` |
| 2a | `frontend/src/components/volantes/VolantesView.tsx:127` | `volante` | `layoutMode`, `reservorio`, `single: true` | **No** — label = output PDF name | **No** — no excel path, no record id, no plantilla path |
| 2b | `frontend/src/components/volantes/VolantesView.tsx:250` | `volante` | `layoutMode`, `reservorio`, `records` (count) | **No** | **No** — same gaps; schema expects `excel_path`/`plantilla` but UI does not save them |
| 3 | `frontend/src/components/padron/PadronView.tsx:587` | `padron` | Water-cut: `outputFormat`, `startItem`, `endItem`, `pages`; else: `outputFormat`, `orientation`, `startItem`, `endItem`, `pages` | **No** | **No** — no excel path / workbook snapshot; schema expects `excel_path`/`filtro` but UI does not save them |
| 4 | `frontend/src/components/image-optimizer/index.tsx:598` | `image_optimizer` | `preset`, `scope`, `successCount`, `errorCount`, `settings` (stringified `BatchSettings`) | **No** — label = `"Lote N imágenes"`; source images are in-memory `File` blobs never persisted | **Partial** — can restore preset + full `BatchSettings`; **cannot** restore image list or re-run without re-import |
| 5 | `frontend/src/components/sellador/SelladorView.tsx:394` | `sellador` | `stamp_count`, `stamped_pages`, `positions` (count), `x`, `y`, `width`, `height`, `seed`, `source` (PDF **basename** only) | **No** absolute PDF path | **No** — cannot reload source PDF; rects/seed only useful after PDF re-picked |
| 6a | `frontend/src/components/reportes-campo/ReportesCampoApp.tsx:152` | `reporte_campo` | `reportType`, `type: 'individual'`, `photos` (count), `header` | **No** — no photo paths | **No** — photos and logos not in options |
| 6b | `frontend/src/components/reportes-campo/ReportesCampoApp.tsx:176` | `reporte_campo` | `reportType`, `type: 'consolidado'`, `count` | **No** | **No** |
| 7 | `frontend/src/components/panel-aviso-corte/PanelAvisoCorteApp.tsx:58` | `panel_aviso_corte` | `format`, `template`, `panels` (count) | **No** | **No** — session images / excel / key_column not saved (schema lists `key_column`/`strategy` unused by this call) |
| 8 | `frontend/src/components/evidencia-volanteo/EvidenciaVolanteoApp.tsx:57` | `evidencia_volanteo` | `format`, `pages`, `images` (count) | **No** | **No** — image session not persisted |
| 9a | `frontend/src/components/technical-reports/TechnicalReportsApp.tsx:201` | `informe_tecnico` | `type: 'individual'`, `reportId` | **No** — label = PDF filename | **Partial** — can reopen report by id if still in DB; form field snapshot / logos not in options |
| 9b | `frontend/src/components/technical-reports/TechnicalReportsApp.tsx:218` | `informe_tecnico` | `type: 'consolidado'`, `count` | **No** | **No** — only regenerates current DB set, not a frozen snapshot |
| 10a | `frontend/src/components/fichas-tecnicas/FichasTecnicasApp.tsx:252` | `ficha_tecnica` | `type: 'plantilla'` | **No** | **No** — empty restore surface |
| 10b | `frontend/src/components/fichas-tecnicas/FichasTecnicasApp.tsx:272` | `ficha_tecnica` | `type: 'individual'`, `fichaId` | **No** | **Partial** — can select ficha by id if still in DB; logos / dirty form state not stored |
| 10c | `frontend/src/components/fichas-tecnicas/FichasTecnicasApp.tsx:297` | `ficha_tecnica` | `type: 'consolidado'`, `count` | **No** | **No** |

### Registry vs payload drift (informational)

Frontend `schemaOptionKeys` / backend schemas document keys that several UIs **do not currently write** (`padron.excel_path`, `volante.excel_path`/`plantilla`, `reporte_campo.cs`/`contratista`, `panel_aviso_corte.key_column`/`strategy`). Reexecute must not assume schema keys exist in historical rows.

Today only `conversion.reexecute === true` in `frontend/src/components/history/runTypes.ts`.

## 2. Ranked pilots

| Rank | Candidate | Why | Why not / blockers |
|------|-----------|-----|--------------------|
| **1 (recommend)** | **`formato`** | Options alone are complete (`format_id`, `desde`, `hasta`). No external file paths. Restore = select format + set range; user can regenerate via existing `api.formatosGenerate`. Smallest blast radius; mirrors conversion’s “restore form, don’t auto-run” pattern. | Fails if format was deleted; need toast. Does not need schema enrichment first. |
| 2 | `image_optimizer` | `settings` JSON is a full `BatchSettings` snapshot + `preset`/`scope` — best settings fidelity after conversion. | **No source images in history** (`File` blobs). Reexecute can only restore settings; must document settings-only UX or enrich payload with persisted paths (Electron folder) before full re-run. |
| 3 | `informe_tecnico` (individual only) | Has `reportId` → can navigate + load entity. | Consolidado/plantilla-like modes incomplete; depends on DB still having the report; logos not in options. |
| 4 | `ficha_tecnica` (individual only) | Has `fichaId`; registry already present (plan 007 merged — see notes). | **Defer** — plantilla/consolidado incomplete; individual still missing logos/form snapshot. Enrich `saveFeatureHistory` before any flag flip. |
| 5 | `padron` / `volante` | High user value for field repeat work. | Payloads lack excel/plantilla paths despite schema; **enrich history first** (additive fields only), then new plan. |
| 6 | `sellador` | Seed + rects useful. | Source is basename only; PDF must be re-picked. |
| — | `reporte_campo`, `panel_aviso_corte`, `evidencia_volanteo` | — | Session media not stored; not pilots until payload enrichment. |

**Recommendation:** Pilot **`formato`**. Do **not** flip `reexecute: true` in this spike.

**Defer `ficha_tecnica`:** Plan 007 registry is already on this base (`ficha_tecnica` in `RUN_TYPE_REGISTRY`), but payloads remain incomplete for safe restore of all export modes.

## 3. Restore contract — pilot `formato`

### Input (history row shape)

```ts
{
  run_type: 'formato',
  files_json: '["<format display name>"]',  // informational only
  options_json: '{"format_id":"<id>","desde":<int>,"hasta":<int>}',
  formato: '<format display name>',
  // patron/calidad unused for this type
}
```

Parsed restore payload:

| Field | Source | Required |
|-------|--------|----------|
| `format_id` | `options.format_id` | yes |
| `desde` | `options.desde` | yes (≥ 1) |
| `hasta` | `options.hasta` | yes (≥ `desde`) |

### UI / IPC restore (proposed; not implemented)

1. Historial: if `RUN_TYPES.formato.reexecute` (future) → `dispatchHistoryReexecute(run)` (or typed sibling event).
2. `App.tsx`: on reexecute for `formato`, `setActiveTab('formatos')` (today hardcodes `convert` only — must generalize without breaking conversion).
3. `FormatosView`: subscribe / `takePending…`:
   - `await api.formatosList()`
   - Find format by `format_id`
   - If missing → **toast error**, leave UI unchanged (no silent empty selection)
   - If found → select it, `setDesde(desde)`, `setHasta(hasta)`
4. **Do not auto-call** `api.formatosGenerate` on restore (parity with conversion: restore form, user confirms).

### Failure modes

| Condition | Behavior |
|-----------|----------|
| Invalid / missing `format_id`, `desde`, `hasta` | Toast; no navigation side effects beyond optional tab switch cancel |
| Format deleted from catalog | Toast: format no longer available |
| `hasta < desde` or out of format numeric bounds | Toast; do not clamp silently into a different range |
| IPC list failure | Toast; keep pending cleared so remount does not loop |

### Tests required before flipping `reexecute: true`

1. **Pure unit:** `canRebuildFormatoState(options) → { ok, formatId, desde, hasta } | { ok: false, reason }` — no UI.
2. **Characterization:** given a saved options object from a real generate call, restore equals original form state (`selected.id`, `desde`, `hasta`).
3. **Missing format:** restore with unknown `format_id` → error path, no selection change.
4. **Regression:** conversion reexecute paths unchanged (`historyEvents`, `ConversionView.applyHistoryRun`, `App` convert tab on conversion-only events).
5. **Optional e2e/smoke:** Historial row with `formato` shows Reejecutar only after flag + handler wired; click restores FormatosView fields without generating PDF.

### Explicit non-goals for the follow-up PR

- Do not change how `formato` rows are stored today (already sufficient).
- Do not enable other run types’ flags in the same PR.
- Do not auto-generate PDF on reexecute.

## 4. Verification log (spike)

- Conversion reexecute paths: **not modified** (spike added docs only under `plans/`).
- Tests: see commit / executor report for `pytest` results on this worktree.
- `plans/README.md`: **SKIPPED** per operator (reviewer/advisor owns index).
