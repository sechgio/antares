# Panel Aviso Bulk Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir exportar lotes grandes de imagenes sin serializar todo el lote a base64 cuando existen rutas locales disponibles.

**Architecture:** El frontend conservara una ruta local opcional por imagen y construira un payload hibrido con `image_paths` preferidos y `images` base64 como respaldo. El backend resolvera ambos origenes antes de delegar al renderizador existente, que seguira trabajando con bytes/base64 normalizados.

**Tech Stack:** React, TypeScript, Electron IPC, Python, pytest, Vitest.

---

### Task 1: Contract Tests

**Files:**
- Modify: `frontend/src/components/panel-aviso-corte/utils/exportPdf.test.ts`
- Modify: `tests/panel_aviso_corte/test_rendering.py`

- [ ] Write a frontend failing test that proves export prefers local paths and only base64-encodes files without a path.
- [ ] Write a backend failing test that proves render input can be supplied from `image_paths`.
- [ ] Run both targeted tests and confirm they fail for the missing feature.

### Task 2: Frontend Payload

**Files:**
- Modify: `frontend/src/components/panel-aviso-corte/types.ts`
- Modify: `frontend/src/components/panel-aviso-corte/hooks/usePanelSession.ts`
- Modify: `frontend/src/components/panel-aviso-corte/utils/exportPdf.ts`
- Modify: `frontend/src/components/panel-aviso-corte/components/ImageUploader.tsx`
- Modify: `frontend/src/api.ts`

- [ ] Add `localPath?: string` to loaded images.
- [ ] Capture Electron-provided paths when files enter the session.
- [ ] Build `image_paths` first and use base64 only for files without a path.
- [ ] Update helper text so the UI describes supported formats rather than implying a small-lot ceiling.
- [ ] Run targeted frontend tests.

### Task 3: Backend Resolution

**Files:**
- Modify: `backend/handlers/panel_aviso_corte.py`
- Modify: `backend/core/panel_aviso_corte/rendering.py`

- [ ] Accept `image_paths` in the handler payload.
- [ ] Resolve disk-backed images into the same normalized image map used by the renderers.
- [ ] Keep base64 support as fallback for browser-like files.
- [ ] Run targeted backend tests.

### Task 4: Verification

**Files:**
- No new files.

- [ ] Run focused frontend and backend test suites.
- [ ] Verify a synthetic export path with hundreds of names does not require base64 for disk-backed files.
- [ ] Inspect the final diff for unrelated changes.
