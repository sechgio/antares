# Plan: Historial profesional, versionado y durable

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implementar este plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactorizar la sección **HISTORIAL** para que sea **profesional** (UI consistente, accesible, i18n completa, tipado fuerte, cobertura de tests) y **durable** a través de versiones (esquema versionado, migraciones idempotentes, contrato único para nuevos `run_type`, y cero pérdida de datos en `bump:patch/minor/major`).

**Architecture:**

1. **Backend** introduce un *registry* de `RunType` (metadata, validador, esquema JSON) + sistema de **migraciones versionadas** de SQLite con tabla `_schema_migrations` y columna `schema_version` en `historial`. Cada `run_type` declara un JSON Schema que valida `options_json` y `files_json` al guardar.
2. **Frontend** introduce `frontend/src/components/history/runTypes.ts` como *single source of truth* (tipos, labels i18n, colores, renderers, filtros). El componente consume el registro: añadir un nuevo `run_type` = 1 entrada en el registro, **sin tocar** `HistoryView`, `RunList` ni `RunDetail`.
3. **Capa de integración** (handlers + api + i18n) sincroniza automáticamente las llaves, valida payloads, expone `history_schema` para que la UI pueda renderizar campos dinámicamente, y mantiene compatibilidad hacia atrás con `options_json` libre cuando el `schema_version` es `null` o `0`.
4. **Política de compatibilidad:** añadir columnas es siempre *aditivo* y *nullable*; eliminar columnas nunca ocurre (se ignoran al leer). Renombrar columnas o cambiar tipos requiere migración versionada que preserve datos. La app **nunca** borra registros al actualizar versión.

**Tech Stack:** Python 3.10+ (sqlite3 stdlib, sin ORMs), Electron + React 18 + TypeScript + Vite, Vitest, pytest, `react-i18next` (ya implícito por `locales/`).

---

## Contexto del problema (estado actual)

Inspección del código al 2026-06-12:

| Archivo | Líneas relevantes | Problema |
|---|---|---|
| `backend/core/history.py` | tabla `historial` con columnas fijas; migración ad-hoc con `try/except ALTER TABLE` para `run_type` | No hay `schema_version`, ni tabla de migraciones, ni CHECK constraint; cualquier columna nueva repite el patrón frágil |
| `backend/core/history.py` | `ALL_RUN_TYPES` lista de strings | No hay metadata (label, schema); añadir un tipo requiere editar el core + 3 archivos frontend |
| `backend/handlers/history.py` | `HANDLERS` con 4 métodos | `history_list` y `history_save` no validan `run_type`; `options_json` se guarda sin validar forma |
| `frontend/src/components/history/HistoryView.tsx` | `TYPE_FILTERS` hardcoded (9 entries) | Si se añade `informe_tecnico` al backend pero no a este array, el filtro lo ignora silenciosamente |
| `frontend/src/components/history/RunList.tsx` | `RUN_TYPE_LABELS` y `RUN_TYPE_COLORS` | Duplicado respecto a `RunDetail.tsx`; un sub-tipo nuevo rompe `RUN_TYPE_LABELS[type]` con `undefined` |
| `frontend/src/components/history/RunDetail.tsx` | `RUN_TYPE_LABELS`/`RUN_TYPE_COLORS` repetidos + bloque `if/else` para stats | Cadena `if/else` por tipo (9 ramas); un tipo nuevo cae al *fallback* "volante" sin avisar |
| `frontend/src/locales/es.json` + `en.json` | Llaves `history.*` básicas | Faltan labels específicos (`formato`, `sellador`, `padron`, etc.); strings en componentes están en español hardcoded (ej. `"Cargando historial..."`) |
| `tests/test_pagination.py` | Solo `run_type="conversion"` | No hay cobertura para filtro por otros tipos ni para migración de esquema |
| `frontend/src/components/history/HistoryView.test.tsx` | Solo simula `makeRun` con `run_type: 'conversion'` | Cero cobertura de los otros tipos |
| `package.json` (`bump:patch` etc.) | Bumpea versión y reinstala | La base SQLite del usuario **no se migra**; un cambio de esquema en `historial` puede romper la app al subir versión |

Resultado: cada `bump:minor` que añada un `run_type` o una columna nueva requiere edición manual sincronizada en 5+ archivos, con riesgo alto de regresión silenciosa.

---

## Cambios propuestos (resumen ejecutivo)

| Capa | Cambio | Archivo principal |
|---|---|---|
| Backend | Tabla `_schema_migrations` + `schema_version` en `historial` + migraciones idempotentes | `backend/core/migrations.py` (nuevo) |
| Backend | `backend/core/history.py` refactorizado: registry de `RunType`, validación de payload, columna `app_version` y `duration_ms` | `backend/core/history.py` |
| Backend | `backend/core/run_types.py` (nuevo): metadata, JSON Schema por tipo, label i18n, factory | `backend/core/run_types.py` |
| Backend | Handlers registran `history_schema` y `history_migrations_status` | `backend/handlers/history.py` |
| Frontend | `frontend/src/components/history/runTypes.ts` (nuevo): mirror tipado del registry, consume i18n | `frontend/src/components/history/runTypes.ts` |
| Frontend | `HistoryView`, `RunList`, `RunDetail` consumen el registry; cero hardcodes de tipos | `frontend/src/components/history/*.tsx` |
| Frontend | i18n completo: nuevas llaves `history.runTypes.*`, `history.filters.*`, `history.empty.*` | `frontend/src/locales/{es,en}.json` |
| Frontend | Búsqueda por rango de fechas + selector múltiple + export CSV | `frontend/src/components/history/HistoryView.tsx` |
| API | `api.historySchema()` y `api.historyRunTypes()` para auto-descubrimiento | `frontend/src/api.ts` |
| Tests | pytest para migraciones v0→vN, validación de payload, registry | `tests/test_history_migrations.py`, `tests/test_run_types.py` |
| Tests | Vitest para registry-driven UI, i18n keys, búsqueda avanzada | `frontend/src/components/history/HistoryView.test.tsx`, `runTypes.test.ts` |
| Docs | `docs/historial.md` con contrato de RunType y política de compatibilidad | `docs/historial.md` (nuevo) |

---

## Compatibilidad y política de versionado

Reglas inquebrantables que aplican a todo cambio de esquema de `historial` desde este plan en adelante:

1. **Columnas nuevas:** siempre `NULL`-able y con `DEFAULT NULL`. Nunca `NOT NULL` sin default en producción.
2. **Columnas eliminadas:** se ignoran en lectura (no se hace `SELECT *` crudo, se proyectan las columnas conocidas). Nunca `DROP COLUMN` (SQLite no lo soporta en versiones antiguas y rompe dumps).
3. **Renombrados:** nueva columna + copia + deprecación de lectura de la vieja; ambas viven juntas 2 minor versions antes de marcar la vieja como ignorada.
4. **Cambios de tipo:** nueva columna con sufijo `_v2`; la vieja se deja de escribir pero se sigue leyendo.
5. **Bumps de versión (`patch`/`minor`/`major`):** la app **nunca** borra ni trunca `historial`. La migración es *forward-only* y aditiva.
6. **Nuevos `run_type`:** se registran en `backend/core/run_types.py` + `frontend/src/components/history/runTypes.ts`. Sin tocar handlers ni componentes.
7. **Validación de payload:** al guardar, `schema_validator.validate(options_json, run_type)` con un JSON Schema por tipo. Registros legacy (sin schema) se siguen aceptando con `schema_version=0`.
8. **`schema_version`:** columna en `historial`. Versión 0 = legacy (formato actual). Cada migración lo incrementa.

---

## Milestones (orden de ejecución)

- **M0 — Spec freeze** (este documento aprobado por el usuario).
- **M1 — Backend foundation:** migraciones + registry + `app_version`/`duration_ms`/`schema_version`. Tests pytest. *No cambia UI.*
- **M2 — Frontend registry-driven UI:** `runTypes.ts`, refactor de `HistoryView`/`RunList`/`RunDetail`, i18n. Tests Vitest. *No cambia comportamiento todavía.*
- **M3 — New features:** export CSV, búsqueda por rango de fechas, selección múltiple. Tests.
- **M4 — Hardening:** lint, typecheck, `npm test` y `pytest` verdes, e2e manual documentado en `docs/historial.md`.

---

## Tasks

### Task 1: Backend — Sistema de migraciones versionadas

**Files:**
- Create: `backend/core/migrations.py`
- Modify: `backend/core/database.py` (exponer `get_connection` ya existe; no debería cambiar)
- Test: `tests/test_history_migrations.py`

- [ ] Crear `backend/core/migrations.py` con `MigrationManager`:
  - `__init__(conn)` toma una conexión sqlite3.
  - `_ensure_table()` crea `CREATE TABLE IF NOT EXISTS _schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`.
  - `current_version() -> int` lee la fila más alta de la tabla; devuelve `0` si vacía.
  - `apply(migration_id: str, sql: list[str])` ejecuta cada `sql` en orden, dentro de una transacción; si la migración ya está en `_schema_migrations`, la salta.
  - `applied() -> list[str]` lista los IDs aplicados.
- [ ] Mover la creación de `historial` y la migración de `run_type` a un *migration script* `m_001_baseline.py` con `id="001_baseline"`:
  - Crea tabla con las columnas actuales (id, run_type, timestamp, files_json, options_json, patron, formato, calidad, resize, ok_count, err_count).
  - Inserta fila `("001_baseline", datetime.now().isoformat())` en `_schema_migrations`.
- [ ] Migración `m_002_history_metadata.py` con `id="002_history_metadata"`:
  - `ALTER TABLE historial ADD COLUMN schema_version INTEGER DEFAULT 0;` (idempotente con `try/except OperationalError`).
  - `ALTER TABLE historial ADD COLUMN app_version TEXT;`
  - `ALTER TABLE historial ADD COLUMN duration_ms INTEGER;`
  - `UPDATE historial SET schema_version = 0 WHERE schema_version IS NULL;` (defensivo).
- [ ] Refactor `backend/core/history.py::_ensure_table()`:
  - Reemplazar la creación ad-hoc por `MigrationManager(get_connection(db))` que aplica todas las migraciones de un *registry* local `_MIGRATIONS: list[tuple[str, list[str]]]`.
  - Mantener **idéntica** la firma pública (`save_run`, `list_runs`, `get_run`, `delete_run`).
- [ ] Test `tests/test_history_migrations.py`:
  - `test_apply_once`: correr el manager dos veces; la segunda no-op.
  - `test_idempotent_columns`: ALTER TABLE sobre columna existente no rompe.
  - `test_baseline_then_metadata`: aplicar `001` y `002` en orden; `schema_version` y `app_version` existen.
  - `test_existing_data_preserved`: insertar filas con el esquema viejo antes de migrar, verificar que siguen legibles.

**Acceptance criteria:**
- `_schema_migrations` contiene las filas aplicadas.
- `historial` tiene las 3 columnas nuevas (`schema_version`, `app_version`, `duration_ms`).
- Registros previos al cambio siguen siendo visibles en `list_runs()`.
- `pytest tests/test_history_migrations.py -v` verde.

---

### Task 2: Backend — Registry de RunType con JSON Schema

**Files:**
- Create: `backend/core/run_types.py`
- Modify: `backend/core/history.py` (validar al guardar)
- Modify: `backend/handlers/history.py` (exponer `history_schema`)
- Test: `tests/test_run_types.py`

- [ ] Crear `backend/core/run_types.py`:
  - Definir `RUN_TYPE_REGISTRY: dict[str, RunTypeMeta]` con un `RunTypeMeta` por cada `run_type` existente.
  - Cada `RunTypeMeta` tiene: `id`, `label_key` (i18n), `color_token` (referencia a variable CSS), `schema: dict` (JSON Schema draft-07 para `options_json` + `files_json`), `stats: list[StatField]`, `description_key`.
  - Reexportar `ALL_RUN_TYPES = list(RUN_TYPE_REGISTRY.keys())`.
- [ ] `validate_run_payload(run_type, options, files) -> None`:
  - Si `run_type` no está en el registry, `ValueError("Unknown run_type: {x}")`.
  - Valida `options` y `files` con `jsonschema` (agregar a `requirements.txt` si no está; usar la lib stdlib sólo si `jsonschema` ya estaba; si no, *skip* validación y dejar TODO con `FIXME: agregar jsonschema`).
  - Si `jsonschema` no está disponible, registrar warning y no fallar (degradación controlada).
- [ ] Modificar `save_run` en `backend/core/history.py`:
  - Llamar `validate_run_payload(run_type, options, files)` antes del INSERT.
  - Insertar `app_version = __version__` y `schema_version = 1`.
  - Parámetro nuevo opcional `duration_ms: int | None = None`.
- [ ] Handler nuevo `history_schema(params)`:
  - Devuelve `{"run_types": [...], "current_version": "0.10.3"}` con metadata serializable (sin funciones).
  - Registrar en `HANDLERS`.
- [ ] Test `tests/test_run_types.py`:
  - `test_registry_has_all_types`: para cada `ALL_RUN_TYPES` actual hay metadata.
  - `test_validate_known_type`: `conversion` con options válidas pasa.
  - `test_validate_unknown_type`: `ValueError`.
  - `test_validate_invalid_options`: opción requerida faltante → `ValidationError`.
  - `test_schema_endpoint`: handler retorna shape correcto.

**Acceptance criteria:**
- `api.history_schema()` retorna la metadata de todos los tipos.
- Guardar un `run_type` desconocido desde el frontend falla con error claro.
- `pytest tests/test_run_types.py -v` verde.

---

### Task 3: Frontend — `runTypes.ts` como single source of truth

**Files:**
- Create: `frontend/src/components/history/runTypes.ts`
- Modify: `frontend/src/components/history/RunList.tsx` (consumir registry)
- Modify: `frontend/src/components/history/RunDetail.tsx` (consumir registry)
- Modify: `frontend/src/components/history/HistoryView.tsx` (consumir registry)
- Test: `frontend/src/components/history/runTypes.test.ts` (nuevo)

- [ ] Crear `frontend/src/components/history/runTypes.ts`:
  - `export const RUN_TYPES = { conversion: { ... }, formato: { ... }, ... } as const;`
  - `export type RunTypeId = keyof typeof RUN_TYPES;`
  - `export interface RunTypeMeta { id; labelKey; descriptionKey; colorVar; stats: StatField[]; filterGroup?; }`
  - Helper `getRunType(id: string): RunTypeMeta` con fallback a un `UNKNOWN` meta.
  - Helper `formatRunStats(run, t): Stat[]` que delega en `meta.stats` (cada StatField es `{key, labelKey, resolve: (run) => string | number, colorVar?}`).
- [ ] Reemplazar `TYPE_FILTERS` en `HistoryView.tsx` por `Object.values(RUN_TYPES).filter(r => r.filterGroup !== 'hidden').map(r => ({ value: r.id, label: t(r.labelKey) }))`.
- [ ] Reemplazar `RUN_TYPE_LABELS` y `RUN_TYPE_COLORS` en `RunList.tsx` y `RunDetail.tsx` por `getRunType(id).labelKey` y `getRunType(id).colorVar`.
- [ ] Refactor `RunDetail.tsx`:
  - Eliminar la cadena `if/else` para `stats`. Reemplazar por `getRunType(type).stats.map(stat => ({label: t(stat.labelKey), value: stat.resolve(run), color: stat.colorVar}))`.
  - La sección "Opciones" muestra los `options` que estén declarados en el schema del meta; los que no estén, se ocultan (en lugar de mostrarlos todos en JSON plano).
  - `run.patron` solo se muestra si `meta.id === 'conversion'` (decisión ahora vive en `meta.showPatron: boolean`).
- [ ] Reemplazar `RunType` type en `RunList.tsx` por `RunTypeId`.
- [ ] Test `runTypes.test.ts`:
  - `test_registry_includes_all_backend_types`: para cada id que el backend expone, existe en `RUN_TYPES`.
  - `test_unknown_fallback`: `getRunType('inventado')` retorna `UNKNOWN` meta (no lanza).
  - `test_stats_resolution`: para cada tipo, las stats se resuelven con la función del registry.

**Acceptance criteria:**
- `grep -r 'RUN_TYPE_LABELS' frontend/src` no encuentra nada.
- `grep -r 'TYPE_FILTERS' frontend/src` solo aparece como `Object.values(RUN_TYPES)...`.
- Typecheck verde: `npm run typecheck:frontend`.

---

### Task 4: i18n completo para Historial

**Files:**
- Modify: `frontend/src/locales/es.json`
- Modify: `frontend/src/locales/en.json`

- [ ] Añadir bloque `history.runTypes` con llaves por cada `RunTypeId`:
  - `history.runTypes.conversion`, `.formato`, `.sellador`, `.padron`, `.volante`, `.imageOptimizer`, `.reporteCampo`, `.panelAvisoCorte`, `.informeTecnico`.
  - `history.runTypes._unknown` para fallback.
- [ ] Añadir `history.filters.all = "Todos"` / `"All"`.
- [ ] Añadir `history.search.placeholder` y `history.search.placeholder` (es/en) (ya existe como texto duro, mover).
- [ ] Añadir `history.actions.exportCsv`, `history.actions.deleteSelected`, `history.actions.confirmDeleteMany`.
- [ ] Añadir `history.empty.noRuns`, `history.empty.noMatches`, `history.empty.selectPrompt` (algunos ya existen; consolidar).
- [ ] Reemplazar todos los strings hardcoded en `HistoryView.tsx`/`RunList.tsx`/`RunDetail.tsx` por `t('history.*')`. Usar el hook `useTranslation` (verificar disponibilidad; si no existe, instalar `react-i18next` y agregar `i18n.ts` con init).
- [ ] Test snapshot/manual: cambiar `i18n.language` a `en` y verificar labels en inglés.

**Acceptance criteria:**
- `grep -nE '"Cargando|"Eliminar|"Re-ejecutar' frontend/src/components/history/*.tsx` no devuelve resultados (todos pasan por i18n).
- `npm run typecheck:frontend` verde.
- Cambiar idioma en Apariencia cambia los labels de Historial.

---

### Task 5: UI enhancements (búsqueda por fecha, selección múltiple, export CSV)

**Files:**
- Modify: `frontend/src/components/history/HistoryView.tsx`
- Create: `frontend/src/utils/csv.ts`
- Modify: `backend/handlers/history.py` (nuevo `history_export`)
- Test: `frontend/src/components/history/HistoryView.export.test.tsx` (nuevo)

- [ ] Añadir `dateFrom` y `dateTo` al estado del filtro. Pasar como query a `historyList` (extender handler para aceptar `date_from` y `date_to` ISO).
- [ ] Checkbox por run en `RunList` con estado `selectedIds: Set<number>`. Barra inferior con "Eliminar (N)" y "Exportar CSV".
- [ ] `historyExport` handler:
  - Params: `{ids?: number[]; run_type?: string; date_from?: string; date_to?: string}`.
  - Retorna `{"csv": "<string base64>"}` con columnas: `id, run_type, timestamp, formato, calidad, ok_count, err_count, duration_ms, app_version, schema_version`.
  - Usa `csv` stdlib de Python.
- [ ] Frontend: `api.historyExport(...)` y descarga con `<a href="data:text/csv;base64,..." download="historial.csv">`.
- [ ] Test:
  - Click "Exportar CSV" sin selección → exporta todo el set actual.
  - Click "Exportar CSV" con 2 seleccionados → exporta esos 2.
  - Backend test: ids inexistentes se ignoran, ids válidos se incluyen.

**Acceptance criteria:**
- Filtro por fecha funciona y se combina con `run_type`.
- Selección múltiple permite borrar N registros en una sola confirmación.
- CSV se descarga con el nombre correcto y se abre en Excel/LibreOffice sin errores de encoding.

---

### Task 6: Endurecimiento y verificación final

**Files:**
- Modify: `backend/core/history.py` (asegurar que `save_run` siempre graba `app_version`)
- Modify: `docs/historial.md` (nuevo)
- Test: e2e manual documentado

- [ ] `save_run` registra `app_version = from backend.version import __version__`. Confirmar en pytest que el campo se persiste.
- [ ] Crear `docs/historial.md` con:
  - Diagrama ER de la tabla.
  - Contrato de `RunTypeMeta` (campos y su semántica).
  - Política de compatibilidad (las 8 reglas de arriba).
  - Procedimiento de bump-version: qué migraciones añadir y dónde.
  - Procedimiento de rollback (no hay, por diseño; explicitar).
- [ ] Correr `npm run lint:python`, `npm run typecheck:frontend`, `npm test`. Todo verde.
- [ ] Smoke test manual (documentado en `docs/historial.md`):
  - Crear 3 runs de tipos distintos.
  - Cerrar y reabrir la app: siguen ahí.
  - `bump:patch` y reinstalar: siguen ahí.
  - Borrar uno: desaparece.
  - Exportar CSV: archivo válido.

**Acceptance criteria:**
- `npm test` y `pytest` verdes.
- `docs/historial.md` explica el contrato completo.
- Smoke test manual pasa.

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| `jsonschema` no está en `requirements.txt` | Task 2 verifica primero; si no, degradación controlada (warning + skip) con TODO marcado. No bloquea el plan. |
| Migración rompe base de usuario en producción | Las 3 columnas añadidas son `NULL`-able con `DEFAULT NULL`/`0`. SQLite no permite `DROP COLUMN` en versiones < 3.35, por eso la política prohíbe drops. Smoke test en instalación limpia + instalación con datos pre-existentes. |
| i18n incompleta deja UI en fallback | Task 4 exige `grep` de strings duros como criterio de aceptación. |
| Frontend se desincroniza con backend (tipo nuevo) | `history_schema` endpoint permite auto-descubrimiento; Task 3 obliga a consumir el registry. Si backend expone un id desconocido en frontend, cae a `UNKNOWN` meta en lugar de crashear. |
| Performance degrada con muchos runs | Índices: `CREATE INDEX IF NOT EXISTS idx_historial_ts ON historial(timestamp DESC);` en migración `m_003_indexes.py` (añadir si las queries se sienten lentas en QA). |

---

## Out of scope (explícito)

- Reemplazar SQLite por Postgres/DuckDB.
- Sync en la nube del historial.
- Tags/notas libres en cada run (puede ser Task futuro; el schema no lo impide porque `options_json` es libre).
- Re-ejecutar runs que no sean `conversion` (ya el botón solo aparece para `conversion`; expandir requiere handlers nuevos por tipo, fuera de scope).
- Cambiar el `run_type` por defecto de legacy a `0` (se mantiene `0` para compat).

---

## Definition of Done (DoD)

- [ ] Las 8 reglas de compatibilidad escritas en `docs/historial.md` y respetadas por código.
- [ ] `pytest` y `npm test` verdes.
- [ ] `npm run typecheck:frontend` verde.
- [ ] `npm run lint:python` verde.
- [ ] Smoke test manual pasa.
- [ ] Cero string duro en `frontend/src/components/history/*.tsx` que no pase por i18n.
- [ ] Cero referencia a `ALL_RUN_TYPES` o `TYPE_FILTERS` hardcoded fuera de los registries.
- [ ] PR con título `feat(history): registry, schema versioning, i18n, CSV export` y descripción enlazando este plan.
