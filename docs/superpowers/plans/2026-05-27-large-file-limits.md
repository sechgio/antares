# Large File Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove practical large-file blockers for PDF generation, ZIP export, IPC payloads, and history browsing.

**Architecture:** Keep existing base64 IPC responses for backward compatibility, but route large downloads through direct-to-disk saves so JSON-RPC only returns small metadata. Keep ZIP creation local/streamed where possible and make frontend history consume the backend offset interface page by page.

**Tech Stack:** Python IPC backend, Electron main/preload bridge, React/Vite frontend, Vitest, pytest.

---

### Task 1: Direct-To-Disk Formatos PDF Export

**Files:**
- Modify: `backend/handlers/formatos.py`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/components/formatos/FormatosView.tsx`
- Test: `tests/test_formatos_handlers.py`
- Test: `frontend/src/components/formatos/FormatosView.test.tsx`

- [x] Add optional `output_path` to `formatos_generate`.
- [x] Write generated PDFs to `output_path` and return `{ saved_path, filename }` without `pdf_base64`.
- [x] Keep legacy `{ pdf_base64, filename }` response when no `output_path` is provided.
- [x] Update Formatos download flow to call `dialog_save` before generation.
- [x] Add backend and frontend regression tests.

### Task 2: ZIP Export Memory Path

**Files:**
- Modify: `backend/handlers/optimizer.py`
- Modify: `frontend/src/components/image-optimizer/zip.ts`
- Test: `tests/test_optimizer_handler.py`
- Test: `frontend/src/components/image-optimizer/zip.test.ts`

- [x] Decode base64 entries into ZIP entries by streaming writes.
- [x] Add optional `output_path` for direct-to-disk backend ZIP creation.
- [x] Keep legacy base64 ZIP response for compatibility.
- [x] Deduplicate colliding archive basenames in frontend ZIP export.
- [x] Add 1000-entry stress tests.

### Task 3: IPC Budgets

**Files:**
- Modify: `backend/ipc_protocol.py`
- Modify: `electron/ipc-router.js`
- Modify: `frontend/src/api.ts`

- [x] Make backend payload limit configurable through `ANTARES_IPC_MAX_PAYLOAD_SIZE`.
- [x] Raise default backend payload allowance from 10 MB to 64 MB for previews and metadata.
- [x] Raise long-running operation timeout from 5 minutes to 15 minutes in Electron and frontend.

### Task 4: History Pagination

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/components/history/HistoryView.tsx`
- Test: `frontend/src/components/history/HistoryView.test.tsx`

- [x] Add `offset` to the frontend history API type.
- [x] Fetch `PAGE_SIZE + 1` records to infer whether another page exists.
- [x] Append additional pages through a “Cargar más” control.
- [x] Reset pagination when the run-type filter changes.
- [x] Add a UI regression test proving offset pagination is used.

### Task 5: Verification

**Files:**
- Run: `python -m pytest tests/test_formatos_handlers.py tests/test_optimizer_handler.py tests/test_pagination.py -q`
- Run: `cd frontend && npx vitest run src/components/formatos/FormatosView.test.tsx src/components/history/HistoryView.test.tsx src/components/image-optimizer/zip.test.ts src/__tests__/api.test.ts`
- Run: `cd frontend && npx tsc --noEmit`

- [x] Run targeted backend tests.
- [x] Run targeted frontend tests.
- [x] Run frontend typecheck.
