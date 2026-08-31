# IPC File Token Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate renderer file inputs to read capabilities so the strict IPC path contract protects the real conversion, seal, panel, evidence, and report flows.

**Architecture:** Native open dialogs return display paths plus read-capability tokens aligned by index. Renderer-owned `File` objects are staged only when a request needs their bytes. The IPC router resolves tokens at the boundary into the paths expected by Python and validates only declared path-bearing values, leaving filenames, base64, and data URIs untouched.

**Tech Stack:** Electron IPC, Node.js CommonJS handlers, React/TypeScript renderer, Vitest, Node regression tests.

## Global Constraints

- Raw absolute read paths are rejected by the IPC router; renderer backend payloads use `antares-read_*` tokens.
- Write paths remain governed by dialog-selected roots or `antares-write_*` capabilities.
- `register_local_path` remains deprecated and is not used for backend reads.
- Staged file capabilities are cleaned after the IPC operation; multi-step renderer flows stage fresh tokens per request.
- Browser-only fallbacks may continue using bounded base64/data URLs where no filesystem capability exists.

---

### Task 1: Define and test the dialog read-token contract

**Files:**
- Modify: `electron/dialog-handlers.js`
- Modify: `frontend/src/api.ts`
- Modify: `tests/test-electron-dialogs.js`
- Modify: `frontend/src/__tests__/api.test.ts`

**Interfaces:**
- Produces `dialog_files -> { paths: string[], file_tokens: string[] }` and `dialog_folder -> { paths: string[], file_tokens: string[], folder?: string }`.
- `file_tokens[index]` is the read capability for `paths[index]`; cancelled or `pickOnly` dialogs return an empty token list.

- [x] **Step 1: Write the failing test**

```js
const selected = await handleDialogCall('dialog_files', {}, dialog, win);
assert(selected.result.file_tokens.length === selected.result.paths.length,
  'dialog_files debe devolver un token por archivo seleccionado');
assert(/^antares-read_/.test(selected.result.file_tokens[0]),
  'dialog_files debe devolver tokens de lectura');
```

- [x] **Step 2: Run test to verify it fails**

Run: `node tests/test-electron-dialogs.js`

Expected: FAIL because the dialog result currently contains `paths` only.

- [x] **Step 3: Write minimal implementation**

```js
function readTokensForPaths(paths, webContentsId) {
  return paths.map((filePath) => createFileCapability({
    filePath,
    mode: 'read',
    webContentsId,
    name: path.basename(filePath),
  }).token);
}
```

Call the helper after `_registerDialogPaths(result.paths)` and include `file_tokens` in the two dialog results without changing the existing `paths` field.

- [x] **Step 4: Run test to verify it passes**

Run: `node tests/test-electron-dialogs.js`

Expected: PASS, including existing path, folder, and cancellation assertions.

- [ ] **Step 5: Commit** *(deferred; changes remain uncommitted for user review)*

```bash
git add electron/dialog-handlers.js frontend/src/api.ts tests/test-electron-dialogs.js frontend/src/__tests__/api.test.ts
git commit -m "feat(ipc): return read tokens from file dialogs"
```

### Task 2: Resolve declared nested read fields without false positives

**Files:**
- Modify: `electron/file-capabilities.js`
- Modify: `electron/ipc-router.js`
- Modify: `tests/test-ipc-router-write-validation.js`

**Interfaces:**
- `_maybeResolveFileTokens(params, win)` resolves token values in `files[]`, `path`, `excelPath`, `pdf_path`, `stamp_path`, `mapping_path`, `image_paths{}`, and `images_by_id{ ... path }`.
- Values under `filename`, `content_b64`, arbitrary mapping data, and `data:` URLs are not interpreted as paths.

- [x] **Step 1: Write the failing test**

```js
const resolved = router._maybeResolveFileTokens({
  files: [readToken],
  image_paths: { 'a.jpg': readToken },
  images_by_id: { report: [{ path: readToken, name: '../display-name.jpg' }] },
  files_for_optimizer: [{ filename: '../name.jpg', content_b64: 'abc' }],
  localImagePaths: { 'antares-local-image:x': 'data:image/jpeg;base64,Li4v' },
}, win);
assert(resolved.files[0] === sourcePath, 'files[] token se resuelve');
assert(resolved.image_paths['a.jpg'] === sourcePath, 'image_paths token se resuelve');
assert(resolved.images_by_id.report[0].path === sourcePath, 'images_by_id.*.path token se resuelve');
assert(resolved.files_for_optimizer[0].filename === '../name.jpg', 'filename no se valida como path');
```

- [x] **Step 2: Run test to verify it fails**

Run: `node tests/test-ipc-router-write-validation.js`

Expected: FAIL because the router currently resolves only scalar token keys and `localImagePaths`.

- [x] **Step 3: Write minimal implementation**

```js
const READ_TOKEN_FIELDS = new Set(['path', 'excelPath', 'pdf_path', 'stamp_path', 'mapping_path']);

function resolveReadToken(value, label, webContentsId) {
  if (typeof value !== 'string' || !value.startsWith('antares-read_')) return value;
  try { return resolveCapability(value, 'read', webContentsId).path; }
  catch (error) { throw new Error(`invalid file token for ${label}: ${error.message}`); }
}
```

Use explicit visitors for each declared field and recurse only into `files[]`, `image_paths{}`, and `images_by_id{...path}`. Keep `localImagePaths` data URLs unchanged and retain staged-token collection over the same declared locations.

- [x] **Step 4: Run test to verify it passes**

Run: `node tests/test-ipc-router-write-validation.js`

Expected: PASS with raw absolute paths still rejected in declared read positions.

- [ ] **Step 5: Commit** *(deferred; changes remain uncommitted for user review)*

```bash
git add electron/file-capabilities.js electron/ipc-router.js tests/test-ipc-router-write-validation.js
git commit -m "fix(ipc): resolve nested read capabilities by schema"
```

### Task 3: Migrate conversion and sellador inputs

**Files:**
- Modify: `frontend/src/components/conversion/ConversionView.tsx`
- Modify: `frontend/src/components/conversion/Dropzone.tsx`
- Modify: `frontend/src/components/sellador/SelladorView.tsx`
- Modify: `frontend/src/components/sellador/PdfPagePreview.tsx`
- Modify: `frontend/src/components/sellador/previewRender.ts`
- Modify: `frontend/src/utils/stageFile.ts`
- Modify: related conversion and sellador tests

**Interfaces:**
- UI state keeps display paths separate from `file_tokens` used in backend payloads.
- File drops stage the original `File` before each backend request; native dialog selections use returned `file_tokens`.
- Sellador sends `pdf_path` and `stamp_path` as capability tokens, while base64 remains the browser fallback.

- [x] **Step 1: Write the failing test**

```ts
expect(mockApi.preview.mock.calls[0][0].files).toEqual(['antares-read_input']);
expect(mockApi.startProcess.mock.calls[0][0].files).toEqual(['antares-read_input']);
expect(mockApi.selladorInspectPdf).toHaveBeenCalledWith({ pdf_path: 'antares-read_pdf' });
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- ConversionView.preview.test.tsx`

Expected: FAIL because current callers pass absolute display paths.

- [x] **Step 3: Write minimal implementation**

```ts
const filePaths = result.paths;
const fileTokens = result.file_tokens ?? [];
setFiles(filePaths);
setFileTokens(fileTokens);
```

Build `PreviewBody`, `ProcessBody`, and mapping payloads from the token array, and stage `File` drops immediately before the corresponding API call.

- [x] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- ConversionView.preview.test.tsx SelladorView.test.tsx`

Expected: PASS with no raw read path in the inspected IPC payloads.

- [ ] **Step 5: Commit** *(deferred; changes remain uncommitted for user review)*

```bash
git add frontend/src/components/conversion frontend/src/components/sellador frontend/src/utils/stageFile.ts
git commit -m "fix(renderer): migrate conversion and seal inputs to tokens"
```

### Task 4: Migrate panel, evidence, and reports export payloads

**Files:**
- Modify: `frontend/src/components/panel-aviso-corte/utils/exportPdf.ts`
- Modify: `frontend/src/components/evidencia-volanteo/utils/exportDocument.ts`
- Modify: `frontend/src/components/informes-v2/exportPdf.ts`
- Modify: `frontend/src/components/informes-v2/InformesV2App.tsx`
- Modify: corresponding Vitest tests

**Interfaces:**
- `image_paths` and `images_by_id.*.path` carry read tokens in Electron.
- HTML/data URI fallbacks remain inline only for browser rendering paths.

- [x] **Step 1: Write the failing test**

```ts
expect(payload.imagePaths['disk.jpg']).toMatch(/^antares-read_/);
expect(payload.imagePaths['disk.jpg']).not.toMatch(/^[A-Za-z]:[\\/]/);
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- panel-aviso-corte/utils/exportPdf.test.ts evidencia-volanteo/utils/exportDocument.test.ts informes-v2/exportPdf.test.ts`

Expected: FAIL because export helpers currently place raw local paths in image maps.

- [x] **Step 3: Write minimal implementation**

```ts
const token = await stageFileForIpc(image.file);
if (token) imagePaths[exportKey] = token;
else imagesBase64[exportKey] = await fileToBase64(image.file);
```

Use the same token-producing helper for `images_by_id` and pass the resulting map directly to the API.

- [x] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- panel-aviso-corte/utils/exportPdf.test.ts evidencia-volanteo/utils/exportDocument.test.ts informes-v2/exportPdf.test.ts`

Expected: PASS for tokenized Electron payloads and browser fallbacks.

- [ ] **Step 5: Commit** *(deferred; changes remain uncommitted for user review)*

```bash
git add frontend/src/components/panel-aviso-corte frontend/src/components/evidencia-volanteo frontend/src/components/informes-v2
git commit -m "fix(renderer): tokenize image export inputs"
```

### Task 5: Full verification and findings audit

**Files:**
- Modify: no production files unless a verification failure identifies a regression.
- Test: existing Node, Vitest, typecheck, and IPC tests.

- [x] **Step 1: Run focused Node security tests**

Run: `node tests/test-electron-dialogs.js; node tests/test-ipc-router-write-validation.js; node tests/test-electron-ipc-allowlist.js`

Expected: exit code 0.

- [x] **Step 2: Run frontend tests and typecheck**

Run: `npm run typecheck:frontend; npm run test:frontend`

Expected: TypeScript and Vitest exit code 0.

- [x] **Step 3: Re-scan the renderer for deprecated/raw read calls**

Run: `rg -n "registerLocalPath|registerLocalPaths|api\.(preview|startProcess|dbParseMapping|selladorInspectPdf|selladorApply|panelAvisoCorteRenderPdf|evidenciaVolanteoRender|informesV2RenderConsolidatedHtml)" frontend/src`

Expected: no backend payload uses a raw absolute read path; remaining path variables are display-only, write destinations, or native thumbnail inputs with their own allowlist.

- [x] **Step 4: Verify the reported medium findings against HEAD**

Run: `rg -n "file_token_read_chunk|isTrustedThumbnailUrl" electron frontend tests`

Expected: if absent, document both as not reproducible in this revision rather than adding speculative behavior.

- [x] **Step 5: Review the final diff**

Run: `git diff --check; git status --short`

Expected: no whitespace errors and only intended files changed.
