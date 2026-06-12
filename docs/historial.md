# Historial — Contrato técnico y política de compatibilidad

> Documento vivo que define el contrato del módulo **Historial** de ANTARES.
> Cualquier cambio de esquema en `historial` o en la API debe cumplir las
> reglas de compatibilidad aquí descritas.

## Tabla `historial`

Diagrama lógico (los nombres coinciden con columnas reales):

```
historial
├── id                  INTEGER PK AUTOINCREMENT
├── run_type            TEXT NOT NULL DEFAULT 'conversion'   -- ver RUN_TYPE_REGISTRY
├── timestamp           TEXT NOT NULL                       -- ISO 8601, lexicográficamente ordenable
├── files_json          TEXT NOT NULL                       -- JSON array de strings (rutas/identificadores)
├── options_json        TEXT NOT NULL                       -- JSON object; validado contra options_schema del run_type
├── patron              TEXT                                -- solo usado por run_type = 'conversion'
├── formato             TEXT                                -- etiqueta corta (JPEG, PDF-A4, …)
├── calidad             INTEGER                             -- 1..100; 0 si no aplica
├── resize              TEXT                                -- libre; null si no aplica
├── ok_count            INTEGER DEFAULT 0
├── err_count           INTEGER DEFAULT 0
├── schema_version      INTEGER DEFAULT 0                   -- 0 = legacy; 1 = con registry RunType
├── app_version         TEXT                                -- __version__ del backend al guardar
└── duration_ms         INTEGER                             -- tiempo total de la corrida; null si no se mide
```

Cada nueva columna se añade con `DEFAULT NULL` / `0` y nunca se hace `DROP COLUMN`
(SQLite < 3.35 no lo soporta; los dumps y las instalaciones en producción lo
agradecen). Las columnas se proyectan explícitamente en `list_runs` /
`list_runs_by_ids` y nunca se hace `SELECT *` desde la UI.

## Tabla `_schema_migrations`

Lleva el registro de migraciones aplicadas:

```
_schema_migrations
├── id          TEXT PK
├── description TEXT
└── applied_at  TEXT NOT NULL
```

Las migraciones se declaran en `backend/core/history.py::HISTORIAL_MIGRATIONS`
y se aplican en orden con `MigrationManager.apply_all`, que es idempotente
(`ALTER TABLE ... ADD COLUMN` se tolera aunque la columna ya exista).

Migraciones actuales:

| Id | Descripción |
|----|-------------|
| `001_historial_baseline` | Tabla base + columna `run_type` legacy |
| `002_historial_metadata` | `schema_version`, `app_version`, `duration_ms` |
| `003_historial_indexes` | Índices `idx_historial_ts`, `idx_historial_run_type` |

## Política de compatibilidad (reglas inquebrantables)

1. **Columnas nuevas:** siempre `NULL`-able y con `DEFAULT NULL`/`0`. Nunca
   `NOT NULL` sin default en producción.
2. **Columnas eliminadas:** se ignoran en lectura (no se hace `SELECT *` crudo
   y se proyectan solo las columnas conocidas). Nunca `DROP COLUMN`.
3. **Renombrados:** nueva columna con sufijo `_v2`; la vieja se deja de
   escribir pero se sigue leyendo durante 2 minor versions.
4. **Cambios de tipo:** nueva columna con sufijo `_v2`; la vieja se deja de
   escribir pero se sigue leyendo.
5. **Bumps de versión (`patch`/`minor`/`major`):** la app **nunca** borra ni
   trunca `historial`. La migración es *forward-only* y aditiva.
6. **Nuevos `run_type`:** se registran en `backend/core/run_types.py` y en
   `frontend/src/components/history/runTypes.ts`. No se tocan handlers ni
   componentes. Los labels / colores / stats / schemas vienen del registry.
7. **Validación de payload:** al guardar, `validate_run_payload` corre los
   JSON Schemas declarados en el registry. Registros legacy sin schema
   siguen aceptándose con `schema_version=0`.
8. **`schema_version`:** columna en `historial`. Versión 0 = legacy. Cada
   migración compatible lo incrementa. Bumps de schema rompen este número.

## Contrato de `RunType`

Definido en `backend/core/run_types.py` (canónico) y espejado en
`frontend/src/components/history/runTypes.ts`. Cada tipo declara:

| Campo            | Significado                                                              |
|------------------|--------------------------------------------------------------------------|
| `id`             | Identificador estable. Se serializa como string en `historial.run_type`. |
| `label_key`      | Llave i18n (es/en) para el label visible.                                |
| `description_key`| Llave i18n para el tooltip / descripción.                                |
| `color_token`    | Variable CSS para badges / acentos.                                      |
| `options_schema` | JSON Schema draft-07 para `options_json`.                                |
| `files_schema`   | JSON Schema para `files_json`.                                           |
| `stats`          | Lista de `StatField` (label_key + resolver) renderizados en detalle.    |
| `show_patron`    | Si el detalle debe mostrar el campo `patron`.                            |
| `show_options`   | Si el detalle debe mostrar los `options` parseados.                      |
| `filter_group`   | `"default"` o `"hidden"`. Determina si aparece en la barra de filtros.   |
| `reexecute`      | Si el detalle expone el botón "Re-ejecutar".                             |

### Añadir un nuevo `run_type`

1. Backend (`backend/core/run_types.py`): agregar entrada al `RUN_TYPE_REGISTRY`
   con todos los campos. Definir `options_schema` y `files_schema` aunque sean
   permisivos (`{"type": "object", "additionalProperties": True}`).
2. Frontend (`frontend/src/components/history/runTypes.ts`): agregar entrada al
   `RUN_TYPES` con `labelKey`, `descriptionKey`, `colorClass`, `badgeClass`,
   `stats`, y demás flags. Consumir `t(meta.labelKey)` y similares.
3. Locales (`frontend/src/locales/es.json` y `en.json`): agregar
   `history.runTypes.<id>` y `history.runTypes.<id>Desc` en ambos idiomas.
4. Tests: ampliar `tests/test_run_types.py` (cobertura del backend) y
   `frontend/src/components/history/runTypes.test.ts` (cobertura del
   frontend).
5. La nueva entrada aparece automáticamente en:
   - filtros (siempre que `filterGroup !== 'hidden'`),
   - badges en `RunList`,
   - stats en `RunDetail`,
   - exportación CSV (la columna `run_type` se serializa tal cual).

## Procedimiento de bump-version

`scripts/bump-version.js` actualiza `package.json`, `frontend/package.json`,
`backend/version.py` y `pyproject.toml`. Después de bumpear:

1. Si el cambio añade una columna a `historial`: agregar una `Migration` nueva
   en `backend/core/history.py::HISTORIAL_MIGRATIONS` y bumpear
   `CURRENT_HISTORIAL_SCHEMA_VERSION`. La nueva columna debe ser `NULL`-able
   con `DEFAULT NULL`/`0`.
2. Si el cambio añade un `run_type`: ver "Añadir un nuevo `run_type`".
3. Si el cambio renombra una columna o cambia un tipo: introducir una columna
   `_v2` y dejar la vieja legible durante 2 minor versions.
4. Correr `pytest` y `npm test`. Ambas suites deben pasar.
5. Smoke test manual: ver abajo.

## Procedimiento de rollback

**No hay rollback.** Por diseño, las migraciones son *forward-only* y
aditivas. Si un bump causa problemas en producción, se distribuye una versión
nueva con otra migración correctiva (no se revierte la base de datos).

## Smoke test manual

Antes de cada release que toque historial:

1. Crear 3 ejecuciones de tipos distintos (`conversion`, `formato`, `image_optimizer`).
2. Cerrar y reabrir la app — los registros siguen visibles.
3. Bumpear versión (`npm run bump:patch -- --push` y reinstalar) — los
   registros siguen visibles y aparecen con `app_version` igual a la versión
   anterior.
4. Borrar una ejecución con el botón "Eliminar" — desaparece.
5. Seleccionar 2 ejecuciones y pulsar "Eliminar (2)" — ambas desaparecen
   tras la confirmación.
6. Pulsar "Exportar CSV" — se descarga `historial-YYYY-MM-DD.csv` con
   encabezado correcto que abre sin errores en Excel / LibreOffice.
7. Filtrar por rango de fechas — la lista refleja el filtro.

## API expuesta

Handlers IPC (registrados en `backend/handlers/history.py`):

| Método                  | Descripción                                                 |
|-------------------------|-------------------------------------------------------------|
| `history_list`          | Lista paginada con filtros opcionales (`run_type`, `date_from`, `date_to`). |
| `history_get`           | Devuelve un run por id, con `files` y `options` parseados. |
| `history_save`          | Persiste una ejecución nueva (valida payload, graba `app_version`). |
| `history_delete`        | Elimina un run por id.                                      |
| `history_delete_many`   | Elimina varios runs por id.                                 |
| `history_schema`        | Devuelve el registry de run types + `current_version`.     |
| `history_export`        | Devuelve CSV en base 64 de los runs filtrados o por ids.   |

## Frontend

Componentes en `frontend/src/components/history/`:

- `runTypes.ts` — single source of truth para tipos, labels, colores, stats.
- `HistoryView.tsx` — vista principal (filtros + lista + detalle + export).
- `RunList.tsx` — lista lateral con soporte de selección múltiple.
- `RunDetail.tsx` — panel de detalle que consume el registry (sin if/else por tipo).
- `historyEvents.ts` — bus de eventos para "Re-ejecutar".

Los strings UI pasan todos por `react-i18next` (`useTranslation`). Cero string
duro en `components/history/*.tsx`.
