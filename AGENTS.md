# Repository Guidelines

Antares es una aplicación de escritorio para Windows que convierte, renombra y genera documentos e informes a partir de imágenes, hojas de cálculo y PDFs. El repositorio combina una UI React, un proceso principal Electron, un backend Python local y servicios Supabase opcionales.

Estas reglas describen el estado real del proyecto auditado. Para valores que cambian con frecuencia, la fuente de verdad es el archivo de configuración o script que se menciona, no una copia de la versión en este documento.

## Fuente de verdad y alcance

- `package.json`, `frontend/package.json`, `pyproject.toml`, `uv.lock`, `package-lock.json`, `frontend/package-lock.json` y `.node-version` definen versiones, dependencias y comandos.
- `backend/`, `electron/`, `frontend/`, `shared/` y `supabase/` son código de producto. `scripts/` contiene automatización de calidad, build, publicación y base de datos.
- El worktree puede contener cambios ajenos a la tarea. Inspecciona `git status` antes de editar, conserva esos cambios y no uses `git reset --hard` ni `git checkout --` para limpiar.
- No uses el `README.md` para inferir versiones actuales sin comprobar los manifests; puede quedarse atrás respecto del código.

## Stack y estructura

- Requisitos: Windows para el producto empaquetado, Node `>=22.12.0` (`.node-version` fija `22.12.0`), Python `>=3.10` y uv `0.11.19` en CI.
- UI: React 19, TypeScript estricto, Vite 5, TailwindCSS y Vitest/Testing Library. La UI vive en `frontend/src/`.
- Shell: Electron 44 en `electron/`. `main.js` coordina ventana, backend, updater, observabilidad y cierre seguro; `preload.js` expone el bridge; `ipc-router.js` aplica allowlist, timeouts, reintentos y backpressure.
- Backend: Python en `backend/`. `main.py` implementa JSON-RPC 2.0 delimitado por líneas sobre stdin/stdout; las respuestas van por stdout y los logs por stderr. `handlers/` enruta métodos y `core/` contiene procesamiento, catálogo, trabajos, formatos, informes, Canvas y observabilidad.
- Contratos compartidos: `shared/` contiene el esquema Canvas, sanitizador HTML, clasificación de métodos IPC y budgets de bundles. Cuando cambia un contrato compartido, actualiza todos sus consumidores y pruebas.
- Cloud: `supabase/` contiene `config.toml`, migraciones, seed y Edge Functions administrativas. `frontend/src/components/espacios/` usa Auth, Postgres/RLS y Realtime; las herramientas locales deben seguir funcionando sin sesión.
- Recursos: `assets/`, `data/`, `formatos/` y `backend/templates/` contienen recursos o plantillas empaquetables. `docs/` se reserva para documentación permitida, y `tests/` contiene suites Python, Node y las pruebas frontend dentro de `frontend/src/`.

### Mapa funcional

- Conversión y catálogo: `frontend/src/components/conversion/`, `backend/core/converter.py`, `renamer.py`, `database.py`, `jobs.py` e `history.py`.
- Plantillas y generación: `formatos/`, `backend/core/formatos.py`, `format_strategies/`, `frontend/src/components/formatos/`.
- Herramientas documentales: `sellador`, `padron`, `volantes`, `reportes-campo`, `preview-panel`, `technical-reports`, `informes-v2`, `fichas-tecnicas`, `panel-aviso-corte`, `ubicaciones`, `evidencia-volanteo` e `image-optimizer`.
- Integración externa: `autoimg/` coordina Google OAuth, Drive, Sheets, sincronización y renombrado; `espacios/` coordina colaboración cloud; `canvas/` es el editor A4 local-first con espejo cloud opcional.
- La navegación y los nombres de tabs están centralizados en `frontend/src/navigation.ts`; las vistas se cargan de forma diferida desde `frontend/src/App.tsx`.

## Arquitectura y límites entre procesos

### Backend Python

- `backend/handlers/__init__.py` usa un `HandlerRegistry` lazy. Los handlers core se calientan antes de emitir `ready`; Canvas y conversión se calientan después, y el resto se carga bajo demanda.
- `backend/core/scheduler.py` separa lanes `sync`, `light` y `heavy`, con límites de workers, backpressure y reducción dinámica por presión de memoria.
- La lista `HEAVY_METHODS` de `backend/main.py` es la autoridad para el lane pesado del backend. Actualmente incluye, entre otros, `canvas_get`, `canvas_save`, `canvas_save_history` y `canvas_export_cmyk_pdf`.
- `shared/heavy-ipc-methods.json` es otra clasificación: controla el timeout pesado del bridge y actualmente contiene `process_start`, `spreadsheet_parse` y `html_to_pdf`. `shared/long-running-methods.json` controla timeouts largos. No confundas estas listas con los lanes del scheduler.
- `process_start` inicia un trabajo en segundo plano mediante `JobManager`; no lo conviertas en una operación bloqueante del lector IPC.
- stdout del backend es un protocolo, no un canal de debug. Todo logging debe ir a stderr mediante las utilidades existentes.

### Electron y bridge

- La ruta normal es `frontend/src/api.ts` → `preload.js`/`window.electronAPI` → `ipc-router.js` → handler nativo o backend Python. No importes Electron, Node ni módulos del proceso principal directamente desde React.
- Un método nuevo o modificado suele requerir revisar `frontend/src/api.ts`, `electron/ipc-methods.js`, `electron/preload.js`, `electron/ipc-router.js` y el registro de `backend/handlers/`, además de sus pruebas de paridad.
- El router usa 30 s por defecto, 300 s para métodos largos y 900 s para métodos pesados. Solo reintenta lecturas explícitamente idempotentes; no marques escrituras como reintentables sin demostrar idempotencia.
- El spawner espera el handshake `ready`, hace health checks y autorrecuperación acotada. En desarrollo ejecuta `backend/main.py` usando primero `venv312` si existe y luego Python del sistema; en producción ejecuta `AntaresBackend.exe` empaquetado.
- La ventana usa `contextIsolation: true`, `nodeIntegration: false`, sandbox y CSP. Mantén la validación del sender, la allowlist de métodos y las restricciones de navegación.

### Frontend

- `App.tsx` mantiene un shell con lazy loading, Error Boundaries y providers de toast/dialog. `AuthGate` solo es obligatorio para `espacios`; conversión, informes y demás herramientas locales no deben depender de Supabase.
- Canvas puede quedar montado hasta 60 s al cambiar de tab para conservar estado; el flush de Canvas participa en el cierre de la aplicación. No desmontes ni cambies ese ciclo de vida sin actualizar sus pruebas.
- El HTML que viaja a preview/PDF debe pasar por `shared/html-sanitizer.js` y respetar `shared/html-sanitizer-spec.json`. No agregues HTML no sanitizado ni recursos externos que contradigan la CSP.

## Persistencia y seguridad de archivos

- Usa `backend/utils/paths.py` para resolver rutas. En Windows, el root de datos de usuario es `%LOCALAPPDATA%\Antares`; los helpers también contemplan otros sistemas para desarrollo y pruebas.
- El catálogo SQLite vive en datos de usuario; `repository.py` gestiona conexiones/pools y WAL. Los stores JSON de informes pueden usar `data/` en desarrollo y datos de usuario en una build congelada. No hardcodees rutas ni asumas que `data/` es el origen persistente universal.
- Canvas guarda documentos en `%LOCALAPPDATA%\Antares\canvas\documents`, historial en `canvas\history`, assets en `canvas\assets` y spill/recovery en los directorios hermanos definidos por `paths.py`. Los documentos antiguos de `data/canvas/documents` solo se migran según la lógica de `canvas/store.py`.
- Las plantillas bundled son recursos de aplicación; las plantillas del usuario se resuelven desde el directorio de datos de usuario. No sobrescribas recursos bundled durante la ejecución.
- El renderer nunca debe enviar rutas absolutas arbitrarias para leer archivos. Usa tokens de capacidad (`file_token`), diálogos nativos aprobados o staging binario; las escrituras deben pasar por roots/tokens de escritura. Se rechazan traversal, symlinks y paths no permitidos.
- Conserva el flujo de `dialog-handlers.js`, `file-capabilities.js`, `ipc-file-policy.js` y `path-allowlist.js`. No devuelvas secretos, service-role keys ni credenciales a la UI; las variables `VITE_*` son configuración pública del cliente, no un lugar para secretos.

## Canvas

Canvas es un editor A4 Figma-style local-first: el JSON local es la fuente inmediata de verdad y Supabase es un espejo best-effort.

- Backend: `backend/core/canvas/` normaliza modelos y mantiene store atómico con locks, recovery e historial. `backend/handlers/canvas.py` expone nueve métodos: `canvas_list`, `canvas_get`, `canvas_save`, `canvas_create`, `canvas_delete`, `canvas_duplicate`, `canvas_export_cmyk_pdf`, `canvas_get_history` y `canvas_save_history`.
- Electron añade `canvas_asset_put`, `canvas_asset_get` y `canvas_asset_gc` para assets binarios. Los documentos usan referencias `canvas-asset:`; no vuelvas a embutir blobs grandes en JSON salvo que el contrato lo exija.
- El contrato compartido es `shared/canvas-schema.json`: `DOCUMENT_VERSION = 2`, página A4 de 210 × 297 y 22 tipos (`text`, `image`, `frame`, `component`, `field`, `logo`, `imageSlot`, `rect`, `grid`, `group`, `table`, `checkbox`, `signature`, `line`, `ellipse`, `arrow`, `polygon`, `star`, `diamond`, `hexagon`, `pentagon`, `boolean`). TypeScript y Python mantienen tipos espejo y normalizan en carga; frontend actualiza v1→v2, backend reestampa la versión y ambos acotan `pageIndex`.
- `useCanvasHistory` distingue `setDocument` (edición discreta), `updateSilent` (preview vivo) y `commitFromBaseline` (una entrada por gesto). `gestureRaf` y `pointerGestureSession` coalescen drag/pointer events y abortan correctamente en undo, cancel o unmount. El historial RAM está limitado a 30 entradas y el historial por documento se persiste en disco.
- El autosave ocurre por cambios y durante los cambios de documento, duplicado, borrado, pérdida de foco/unmount y cierre; no dependas únicamente de Ctrl+S.
- RGB PDF usa `runtime/renderHtml.ts` y `html_to_pdf`, con mayor paridad visual. CMYK usa `canvas_export_cmyk_pdf` y el renderer Python; algunas capas complejas tienen fallback a bounding box. Prefiere RGB cuando la fidelidad de tabla, grid, checkbox, firma o formas complejas sea importante.
- `canvasCloudSync.ts` aplica LWW por `updatedAt`, empuja mediante RPC cuando está disponible, mantiene fallback compatible, agrupa pushes por documento y usa timeout de 30 s. Los errores cloud no deben inutilizar el modo local.
- Canvas usa Realtime privado para eventos de guardado, presencia y pulls dirigidos, con debounce/reintentos. No existe merge operacional por capa ni coedición de operaciones: si el editor local está dirty aparece conflicto y la resolución es conservar local o usar remoto; los snapshots concurrentes terminan en LWW.
- El primer sync está protegido para no borrar o sobrescribir silenciosamente documentos locales. Un pull remoto más nuevo solo reemplaza un documento limpio; reemplazarlo reinicia las pilas de undo/redo en memoria.
- Los budgets de Canvas están en `shared/budgets.json`: incremento permitido de 500 KB y vendors prohibidos en el chunk inicial (`vendor-jspdf`, `vendor-dnd`, `vendor-pdfjs`, `vendor-data`, `vendor-fullcalendar`, `vendor-supabase`). El shell también prohíbe Supabase, Framer, jsPDF, PDF.js y FullCalendar en modulepreload.

## Supabase y datos cloud

- Las migraciones en `supabase/migrations/` son la fuente de verdad del esquema. Incluyen perfiles/roles, `espacios`, `proyectos`, `tareas`, `board_columns`, `canvas_documents` y versiones Canvas, junto con RLS, triggers LWW, Realtime privado e invocadores RPC restringidos.
- Toda funcionalidad nueva debe conservar RLS, least privilege y la separación de funciones privadas. No soluciones un problema de permisos exponiendo tablas o funciones privilegiadas al cliente.
- Las Edge Functions `supabase/functions/admin-create-user` y `admin-delete-user` son administrativas y requieren el modelo de credenciales existente; no las llames desde la UI con secretos.
- Para aplicar migraciones remotas usa únicamente el flujo revisado de `scripts/supabase-db-push.ps1`, con `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` y el project ref autorizado por el script. No pongas credenciales en el repo ni ejecutes un push remoto como sustituto de pruebas locales.

## Instalación, desarrollo y comandos

Desde la raíz del repositorio:

```powershell
npm ci
npm ci --prefix frontend
uv sync --locked --extra dev
```

Variables del cliente cloud, cuando sean necesarias para una tarea, se configuran fuera del repositorio (`VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`).

- `npm run dev` — inicia Vite en `:5173` y Electron.
- `npm run preview:unpacked` — construye una distribución sin instalador y la ejecuta.
- `npm run build:frontend` — ejecuta typecheck y build Vite.
- `npm run build:backend` — empaqueta PyInstaller; el flujo soportado es Windows y valida recursos bundled.
- `npm run build:win` — construye backend/frontend y el instalador Windows con electron-builder.
- `npm test` — ejecuta sincronización de versión/workflows, tests Python, integraciones Node/Electron y `frontend` `test:all`; pytest excluye la marca `slow` por defecto.
- `npm run test:frontend` — Vitest frontend; `npm run test:stress` — `tests/test_stress_conversion.py` con la marca `slow`.
- `npm run lint:python` / `npm run lint:fix` — Ruff sobre backend, tests y scripts.
- `npm run typecheck:backend` — mypy; `npm run typecheck:frontend` — `tsc --noEmit`.
- `npm run check:any` — guard contra nuevas anotaciones `dict[str, Any]` en backend; una excepción debe ser explícita y justificada según el script.
- `npm run check:budgets` — valida budgets de chunks y modulepreload; puede construir frontend si faltan artefactos.
- `npm run audit:python` / `npm run audit:node` — pip-audit y npm audit con severidad alta.
- `npm run ci` — quality gate completo: lint, typecheck, guard `Any`, audits, budgets y `npm test`.
- `npm run bump:patch|minor|major` — actualiza versión siguiendo los scripts del repo; revisa `CHANGELOG.md` antes de release.

## Estilo y reglas de implementación

- Python: indentación de 4 espacios, Ruff (`E,F,W,I,UP,B,SIM,RUF`), line length 120, type hints nuevos, nombres `snake_case` y clases `PascalCase`.
- TypeScript/React: 2 espacios, strict TypeScript, componentes `PascalCase`, hooks `use*`, utilidades puras cuando sea posible y Tailwind/tokens existentes para estilos. No agregues CSS global ad hoc sin necesidad.
- Mantén responsabilidades únicas, nombres descriptivos y la mínima complejidad. No introduzcas abstracciones, dependencias o configuraciones sin una necesidad demostrable.
- Antes de codificar, explicita supuestos y tradeoffs si hay ambigüedad. Si una interpretación puede cambiar el resultado o permisos, detente y pregunta.
- Practica cirugía de precisión: no reformatees ni refactorices código adyacente no relacionado. Elimina únicamente imports, variables o funciones que tus cambios hayan dejado huérfanos.
- Todo cambio de comportamiento debe incluir o actualizar pruebas. Un cambio en IPC, schema, timeout, permisos o serialización requiere revisar ambos extremos del contrato y las pruebas de integración correspondientes.
- Commits usan Conventional Commits (`feat:`, `feat(scope):`, `fix:`, `refactor:`, `perf:`, `chore:`). Nunca incluyas secretos, `.env`, `dist/`, `release/`, caches o `__pycache__`.

## Testing y verificación

- Tests Python: `tests/test_*.py`, configurados en `pyproject.toml`; usa `-m slow` solo para pruebas explícitamente lentas.
- Tests Node/Electron: `tests/test-*.js`; cubren allowlists, rutas, staging, CSP, spawner, router, AutoIMG, Canvas assets y contratos nativos.
- Tests frontend: `frontend/src/**/*.test.ts` y `*.test.tsx`, especialmente `frontend/src/components/canvas/__tests__/` para operaciones puras, gestos, componentes, history y cloud sync.
- Para una modificación, verifica primero el test más cercano y después los checks afectados. Antes de entregar una rama, ejecuta al menos `npm run lint:python`, `npm run typecheck:backend`, `npm run typecheck:frontend` y `npm test`; para cambios de build/IPC/seguridad ejecuta `npm run ci` si el entorno lo permite.
- Si un check falla por cambios preexistentes o por el entorno, reporta el comando, el error concreto y si el fallo está dentro o fuera del alcance de la tarea.

## Git, PR y releases

- El flujo es PR-first: no hagas push directo a `main`. Trabaja en una feature branch (prefijo `codex/` por defecto salvo instrucción distinta), publica la rama y crea/actualiza un PR hacia `main`.
- `npm run push:dry-run` inspecciona el flujo; `npm run push:ship` hace commit/push y crea o actualiza el PR; `npm run push:merge` además espera checks y solicita merge. En modo ship, proporciona el mensaje requerido por el script cuando haya cambios. Usa los flags y mensajes del script, no una secuencia manual que omita validaciones.
- El release loop real tiene 7 pasos: validar `gh`/remote/branch/árbol limpio y sincronización con `origin/main`; comprobar versión/tag/release; validar `CHANGELOG.md`; ejecutar `npm run ci`; opcionalmente construir local; crear tag anotado; empujar el tag. GitHub Actions construye y publica la release.
- `npm run release:dry-run` valida sin crear ni empujar tag (puede hacer `fetch` para comprobar sincronización); `npm run release:ship` crea y empuja el tag; `npm run release:full` añade el build local. Los releases requieren branch `main`, worktree limpio, HEAD exactamente en `origin/main`, entrada de changelog con fecha/sección y tag no duplicado.
- Antes de solicitar review, incluye propósito, issue/PR relacionado, evidencia de tests y screenshots si hay cambios de UI. No borres cambios ajenos para conseguir un árbol limpio: resuélvelo con la rama/PR adecuada.

## Restricción de archivos Markdown (HARD RULE)

Está estrictamente prohibido hacer `commit` o `push` de archivos `.md`, salvo:

- `AGENTS.md`
- `CHANGELOG.md`
- `CLAUDE.md`
- `README.md`
- `CONTEXT.md`
- `docs/adr/*.md` y `docs/adr/README.md`

Todo otro Markdown —incluyendo documentación temporal, planes, notas, drafts, reportes, `scratch/*.md` y `docs/*.md` fuera de ADR— debe permanecer local, añadirse a `.gitignore` o eliminarse antes del commit/PR. Esta regla no se omite.
