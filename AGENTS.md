# Repository Guidelines

Antares is a desktop image converter and renamer. This document explains how to work on it efficiently.

## Project Structure & Module Organization

- `backend/` — Python service (IPC + image processing): `main.py`, `ipc_protocol.py`, `bootstrap.py`, with `core/`, `handlers/`, `utils/`, `locales/`, `templates/`.
- `frontend/` — React + TypeScript + Vite + TailwindCSS UI in `frontend/src/` (`components/`, `hooks/`, `locales/`, `utils/`, `api.ts`, `App.tsx`).
- `electron/` — Electron main process: `main.js`, `ipc-router.js`, `backend-spawner.js`, `dialog-handlers.js`, `preload.js`, `window-manager.js`, `auto-updater.js`.
- `tests/` — Python suites (`test_*.py`, run via `pytest`) plus Node integration scripts (`test-*.js`).
- `scripts/` — Build/clean/version/release helpers; optional manual `generate_brand_assets.py` (requires `antares/favicon1.png` + `favicon2.png` masters; regenerates `frontend/public` favicons and `assets/icon.ico`).
- `docs/`, `assets/` (Windows `icon.ico`), `data/`, `formatos/`, `scratch/` — reference data and generated assets.

## Canvas Subsystem

The Canvas is a Figma-style A4 document editor layered onto Antares. It is **local-first**: the on-disk JSON file is the source of truth; cloud sync is a best-effort background mirror.

### Layout

- **Backend** (`backend/core/canvas/`): `models.py` (schema normalization — `CanvasDocument` in `types.py`, `DOCUMENT_VERSION = 2`, `normalize_document`) + `store.py` (file-backed JSON under `%LOCALAPPDATA%\Antares\canvas\documents\<id>.json`, atomic writes, `RLock`; undo stacks under a sibling history dir). `backend/handlers/canvas.py` exposes **9** IPC endpoints: `canvas_list / get / save / create / delete / duplicate / export_cmyk_pdf / get_history / save_history`.
- **Transport**: JSON-RPC 2.0 over stdio (line-delimited) between the Python backend and Electron; the Electron layer (`electron/ipc-router.js`) is canvas-agnostic (canvas methods are plain allowlist entries). Canvas ops run on the **light** scheduler lane (never in `HEAVY_METHODS`).
- **Frontend** (`frontend/src/components/canvas/`): orchestrator `CanvasView.tsx` → `editor/` (`DesignStage` owns zoom/pan; `Artboard` is the gesture surface; `LeftSidebar` Capas panel; `RightPanel` inspector; `LayerNode` memoized per-layer renderer) → `ops/` (~37 mostly-stateless pure-logic modules — the testable core) + `hooks/` (`useCanvasHistory`, `useCanvasSync`, `useSmoothViewport`, `usePinchZoom`, …) + `runtime/` (`renderHtml.ts` export engine) + `export/` + `sync/canvasCloudSync.ts` (frontend-only Supabase LWW sync). App keep-alive keeps Canvas mounted while hidden; focus sync and window shortcuts run only when the tab is active.

### Data flow

- Frontend edits live in `useCanvasHistory`; the backend only sees a doc on explicit `canvas_save` (Ctrl+S) or **implicit autosave-on-switch** (`onOpenDoc`/`onNew`/`onDuplicate`/`onDeleteDoc` all save the current doc first).
- Undo/redo stacks are **persisted per document** via `canvas_get_history` / `canvas_save_history` (disk); RAM still caps at `MAX_HISTORY = 30`. A cloud pull that triggers `replaceDocument` clears the in-memory stacks (disk history for that id remains until overwritten).
- Cloud sync (`sync/canvasCloudSync.ts`): Supabase `canvas_documents` table, **Last-Writer-Wins by `updatedAt`**, fire-and-forget push after every save, focus-triggered poll when Canvas is visible. Open dirty docs never get silently overwritten (conflict bar). Supabase calls are bounded by a 30s timeout; overlapping syncs coalesce one retry after unlock. Push errors are swallowed (local remains usable).
- There is **no real-time collaboration** for canvas (unlike the `espacios` feature). Concurrent users won't see each other until one refocuses the window; the last saver wins LWW.

### State & gesture contract

- `useCanvasHistory` (`hooks/useCanvasHistory.ts`, `MAX_HISTORY = 30`): `setDocument` (discrete edit, pushes to `past`), `updateSilent` (live preview, no history), `commitFromBaseline` (gesture coalescing — push a pre-edit snapshot without changing current).
- Gesture coalescing: `ops/gestureRaf.ts` (latest-event-wins, one `requestAnimationFrame` apply) + `ops/pointerGestureSession.ts` (window `pointermove`/`pointerup`/`pointercancel`, abort on undo/unmount). `Artboard` pairs `onPreviewLayers` + `onCommitGesture` so a 60fps drag produces exactly one undo entry; mid-drag undo aborts the session without re-commit.

### Schema

- `DOCUMENT_VERSION = 2`; frontend `types.ts` and backend `canvas/types.py` + `models.py` mirror each other (no shared source yet). `normalize_document` (backend) / `normalizeDocument` (frontend) re-validate on load; the frontend performs the v1→v2 upgrade (`types.ts`), the backend re-stamps the version. Layer types are stringly-typed (**22** types including `frame`); per-type `meta` validation on the backend is by key-sniffing in `_normalize_meta`. Both sides clamp layer `pageIndex` into the valid page range.

### Export / Generar

- **RGB PDF** (primary): HTML via `runtime/renderHtml.ts` → `htmlToPdf` — full layer parity.
- **CMYK PDF** (print path): `canvas_export_cmyk_pdf` → `backend/core/cmyk_pdf/renderer.py`. Native vector for rect/frame/ellipse/line/arrow/text/field/image/logo/imageSlot; other types (clipped shapes, table, grid, checkbox, signature) fall back to a filled/stroked bounding box so they are not silently omitted. Path-edited lines still draw as a midline (no `meta.path` yet). Prefer RGB when fidelity of complex layers matters.

### Tests

- Backend: `tests/test_canvas.py` (store + models + handlers) + `tests/test_canvas_ipc_e2e.py` (spawned-backend CRUD for the six core methods; history/CMYK covered by unit tests) + `tests/test_cmyk_pdf.py`.
- Frontend: `frontend/src/components/canvas/__tests__/` (Vitest) — pure-logic ops + RTL component tests + cloud sync + keep-alive.
## Build, Test, and Development Commands

Run from repo root (Node 22.12+, Python 3.10+ and uv 0.11.19 required).

- `npm run dev` — Vite dev server on `:5173` + Electron main process.
- `npm run build:frontend` / `npm run build:backend` — Bundle the renderer and PyInstaller-pack the Python backend.
- `npm run build:win` — Full Windows installer build via `electron-builder` (Antares is Windows-only).
- `npm test` — Runs `pytest` and every Node integration test in `tests/`.
- `npm run lint:python` / `npm run lint:fix` — Ruff checks.
- `npm run typecheck:frontend` — `tsc --noEmit`.
- `npm run bump:patch|minor|major` — Version bump (triggers release workflow on push).

## Coding Style & Naming Conventions

- Python: 4-space indent, Ruff (`E,F,W,I,UP,B,SIM,RUF`), line-length 120, type hints on new code. Mypy in lenient mode. `snake_case` modules/functions, `PascalCase` classes.
- TypeScript/React: 2-space indent, strict TS, function components with PascalCase files (`ConversionView.tsx`), `use*` hooks in `frontend/src/hooks/`.
- TailwindCSS utility classes; avoid ad-hoc global CSS.
- Commits use Conventional Commits: `feat:`, `feat(scope):`, `fix:`, `refactor:`, `perf:`, `chore:`. Releases: `release: vX.Y.Z`.

## Principio de Simplificación (HARD RULE)

La simplicidad es primordial. Escribe el código más simple que cumpla con los requisitos, siempre que el proyecto permanezca funcional.

### Reglas de enforce

| Regla | ¿Skipeable? |
|-------|-------------|
| Código limpio y organizado — estructura clara, sin duplicación, nombres descriptivos | ❌ No |
| Funcionalidad existente no debe romperse — validar antes y después de cada cambio | ❌ No |
| Mínima complejidad — no agregar abstracciones, patrones ni configuraciones innecesarias | ❌ No |

### Prácticas

- **Una sola responsabilidad**: cada módulo, función o clase debe tener un propósito único y bien definido.
- **Código auto-documentado**: el código debe explicarse por sí mismo. Solo agregar comentarios donde la lógica no sea evidente.
- **Menos es más**: eliminar código muerto, dependencias sin uso y comentarios redundantes. Cada línea debe tener un propósito.
- **Estructura consistente**: seguir los patrones y convenciones del proyecto. No reinventar lo que ya funciona.

## Pensar Antes de Codificar

**No asumas. No escondas confusión. Superficie tradeoffs.**

Antes de implementar:
- Expresa tus suposiciones explícitamente. Si no estás seguro, pregunta.
- Si hay múltiples interpretaciones, preséntalas — no elijas en silencio.
- Si existe un enfoque más simple, dilo. Cuestiona cuando sea necesario.
- Si algo no está claro, detente. Nombra lo que es confuso. Pregunta.

## Cirugía de Precisión

**Toca solo lo que debas. Limpia solo tu propio desorden.**

Al editar código existente:
- No "mejores" código, comentarios o formato adyacente no relacionado.
- No refactorices cosas que no están rotas.
- Respeta el estilo existente, aunque lo harías diferente.
- Si encuentras código muerto no relacionado, menciónalo — no lo borres.

Cuando tus cambios creen huérfanos:
- Elimina imports/variables/funciones que TUS cambios dejaron sin usar.
- No elimines código muerto preexistente a menos que te lo pidan.

## Ejecución Orientada a Metas

**Define criterios de éxito. Itera hasta verificar.**

Transforma tareas en objetivos verificables:
- "Agregar validación" → "Escribir tests para inputs inválidos, luego hacerlos pasar"
- "Corregir bug" → "Escribir un test que lo reproduzca, luego hacerlo pasar"
- "Refactorizar X" → "Asegurar que los tests pasen antes y después"

Para tareas multi-paso, declara un plan breve:
```
1. [Paso] → verificar: [qué revisar]
2. [Paso] → verificar: [qué revisar]
3. [Paso] → verificar: [qué revisar]
```

## Testing Guidelines

- Python tests in `tests/test_*.py` (config in `pyproject.toml`, testpaths = `tests`).
- Node integration tests (`tests/test-*.js`) are executed by `npm test` after pytest.
- Frontend unit tests use Vitest + Testing Library (`frontend/src/__tests__/`).
- Add or update tests for every behavior change; cover IPC contract changes in both Python and TS layers.

## Commit & Pull Request Guidelines

- One logical change per commit; reference issues in the body when relevant.
- PRs target `main`. Include: purpose summary, linked issue, test evidence (`npm test` output), and screenshots for UI changes.
- Ensure `npm run lint:python`, `npm run typecheck:frontend`, and `npm test` pass locally before requesting review.
- Never commit secrets, `.env`, or build artifacts (`dist/`, `release/`, `__pycache__/`).
- **Siempre crear PR** — no hacer push directo a `main`. Commits locales están bien, pero los cambios llegan a `main` vía PR revisado.

## Restricción de Archivos Markdown (HARD RULE)

Está **ESTRICTAMENTE PROHIBIDO** hacer `commit` o `push` de archivos `.md` a excepción de los siguientes archivos permitidos:

- `AGENTS.md`
- `CHANGELOG.md`
- `CLAUDE.md`
- `README.md`
- `CONTEXT.md`
- `docs/adr/*.md` (y `docs/adr/README.md`)

Todo otro archivo `.md` — incluyendo documentación temporal, planes, notas de implementación, drafts, reportes, `local://*.md`, `scratch/*.md`, `docs/*.md` no listado, etc. — **NUNCA** debe ser commiteado ni pusheado. Si generas un `.md` auxiliar durante el desarrollo, mantenlo local, agrégalo a `.gitignore` o elimínalo antes del commit/PR.

| Regla | ¿Skipeable? |
|-------|-------------|
| No commitear/pushear `.md` fuera de `AGENTS.md`, `CHANGELOG.md`, `CLAUDE.md`, `README.md`, `CONTEXT.md`, `docs/adr/*.md` | ❌ **HARD RULE — No** |

---

## Release Pipeline Loop (HARD RULE)

Antares usa un **release loop de 8 pasos** para garantizar que cada release sea seguro y reproducible.

### Cuándo se ejecuta

- **Manual**: cuando ejecutas `node scripts/release-loop.js --ship`
- **Dry-run**: `node scripts/release-loop.js` (sin side effects)

### Proceso

```
① Validar entorno → gh auth, remote origin, branch=main, clean tree, up-to-date
② Detectar versión → package.json, sin tag/release duplicado
③ Validar CHANGELOG → entry con fecha y secciones (HARD RULE — no saltable)
④ Quality Gate → lint python + typecheck backend/frontend + test + audit
⑤ [Opcional] Build local → backend (PyInstaller) + frontend (Vite)
⑥ Crear git tag → git tag vX.Y.Z
⑦ Push tag → git push origin vX.Y.Z → activa CI
⑧ Crear GitHub Release → gh release create con notas del changelog
```

### Reglas de enforce

| Regla | ¿Skipeable? |
|-------|-------------|
| Working tree limpio | ❌ No |
| Branch = main | ❌ No |
| Up-to-date con origin/main | ❌ No |
| CHANGELOG entry existe | ❌ **HARD RULE** |
| Quality gate pasa | ❌ No |
| Tag no duplicado | ❌ No |

### Comandos

```bash
# Dry-run (prueba todas las validaciones)
npm run release:dry-run

# Release real (después de verificar dry-run)
npm run release:ship

# Release con build local
npm run release:full
```
