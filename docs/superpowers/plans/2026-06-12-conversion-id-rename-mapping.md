# Plan: Renombrado Simple por Excel {ID → RENOMBRE} en Conversión

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplificar la lógica de renombrado de la herramienta `CONVERSION` para que el usuario solo tenga que cargar un Excel con dos columnas (`ID` y `RENOMBRE`) y los archivos se renombren directamente, sin necesidad de configurar patrones, separadores, ni columnas de plantilla.

**Architecture:** Añadir un nuevo modo de renombrado "Mapeo directo (ID → RENOMBRE)" basado en un Excel de dos columnas, montado **encima** del motor actual `RenamerEngine`. El backend expone un parser que toma una ruta `.xlsx`, valida la estructura (`ID`, `RENOMBRE`), y devuelve un `dict[ID_normalizado -> RENOMBRE_limpio]`. El frontend detecta automáticamente este modo cuando el Excel importado tiene exactamente esas dos columnas y omite los pasos 2 y 3 del `RenameCard`. La conversión real sigue usando `RenamerEngine.aplicar()` con un patrón generado dinámicamente (`{renombre}{ext}`) por compatibilidad, pero el motor principal es un `lookup` directo ID→RENOMBRE que reemplaza el flujo basado en `parse_filename_parts` + `key_column` + `buscar_por_columna`.

**Tech Stack:** Python 3.10+ (pandas + openpyxl), Electron + React + TypeScript + Vite, SQLite (catálogo actual intacto), Vitest, pytest.

---

## Contexto del problema

Hoy, en `frontend/src/components/conversion/RenameCard.tsx`, el flujo guiado exige tres decisiones cuando hay un Excel cargado:

1. Elegir la **columna clave** (`key_column`) donde está el nombre actual del archivo.
2. Elegir las **columnas para renombrar** (chips seleccionables).
3. Elegir el **separador** (`_`, `-`, ` `, pegado).

El backend (`backend/handlers/conversion.py` + `backend/core/renamer.py`) espera un `patron` con placeholders `{campo}` y hace matching indirecto: parsea el nombre con `parse_filename_parts` (busca `grupo_secuencia.ext`) y luego busca el código en la BD con `buscar_por_columna`.

Esto es confuso para usuarios cuyo caso real es:

> "Tengo 200 archivos llamados `IMG_0001.jpg` … `IMG_0200.jpg` y un Excel que dice `IMG_0001.jpg → foto_fachada_norte.jpg`."

No quieren patrones. Quieren un mapeo 1-a-1.

---

## Cambios propuestos (resumen ejecutivo)

| Capa | Cambio | Archivo principal |
|------|--------|-------------------|
| Backend | Nuevo handler `db_parse_mapping` (parsea Excel `{ID, RENOMBRE}` y devuelve dict) | `backend/handlers/database.py` |
| Backend | Función pura `parse_id_rename_mapping(excel_path)` con validación y normalización | `backend/core/database.py` |
| Backend | `RenamerEngine.aplicar` con `modo='mapping'` que omite la lógica de `patron` y hace lookup directo | `backend/core/renamer.py` |
| Backend | `_prepare_chunk_tasks` y `preview` aceptan `mapping` opcional que toma precedencia sobre `key_column` | `backend/handlers/conversion.py` |
| Frontend | Nuevo tipo de payload `ProcessBody.mapping` y `PreviewBody.mapping` | `frontend/src/api.ts` |
| Frontend | Auto-detección del modo mapeo: si el Excel importado tiene solo 2 columnas llamadas `id` y `rename` (o `ID` y `RENOMBRE`), ocultar pasos 2-3 y mostrar una previsualización de tabla 1:1 | `frontend/src/components/conversion/RenameCard.tsx` |
| Frontend | Botón "Cargar mapeo (ID → RENOMBRE)" en el `Dropzone` que abre directamente un Excel de mapeo sin tocar la BD del catálogo | `frontend/src/components/conversion/ConversionView.tsx` |
| Frontend | Tabla de validación previa: muestra archivos sin mapeo, mapeos huérfanos (filas del Excel sin archivo) y conflictos | `frontend/src/components/conversion/RenameCard.tsx` |
| Tests | Pruebas unitarias para `parse_id_rename_mapping` (válido, faltante, columnas mal nombradas, IDs duplicados) | `tests/test_database_mapping.py` |
| Tests | Pruebas del flujo completo de `preview` con `mapping` | `tests/test_conversion_mapping.py` |
| Tests | Tests de UI: detección automática, tabla de validación, botón "Cargar mapeo" | `frontend/src/components/conversion/RenameCard.mapping.test.tsx` |
| Docs | Actualizar `README.md` con el nuevo flujo simplificado | `README.md` |

---

### Task 1: Backend — Parser de Excel `{ID, RENOMBRE}`

**Files:**
- Modify: `backend/core/database.py`
- Modify: `backend/handlers/database.py`
- Modify: `backend/ipc_protocol.py` (no — basta con registrar el handler)
- Test: `tests/test_database_mapping.py`

- [ ] Agregar `parse_id_rename_mapping(excel_path: str) -> dict[str, str]` en `backend/core/database.py`.
  - Lee el Excel con `pd.read_excel(excel_path, dtype=str, engine="openpyxl")`.
  - Normaliza encabezados con `_normalize_excel_columns` ya existente.
  - Valida que existan exactamente 2 columnas llamadas `id` y `renombre` (case-insensitive, sin acentos: `ID`, `id`, `Id` → `id`; `RENOMBRE`, `renombre`, `Rename` → `renombre`).
  - Lanza `ValueError` con mensaje claro si las columnas no coinciden, si hay duplicados, o si alguna celda está vacía.
  - Devuelve `dict[ID.strip() -> RENOMBRE.strip()]` con normalización de whitespace y `sanitizar_nombre` aplicado al RENOMBRE.
- [ ] Registrar el método en el handler `database.py`:
  - `db_parse_mapping(params)` que valida `path` con `@validate_params("path")` y retorna `{"mapping": dict}`.
  - Añadir la entrada `"db_parse_mapping": db_parse_mapping` al `HANDLERS` dict.
- [ ] Tests `tests/test_database_mapping.py`:
  - Test: Excel válido con `ID, RENOMBRE` produce dict correcto.
  - Test: Encabezados con mayúsculas/minúsculas se normalizan.
  - Test: Columnas extra (ej. `Notas`) → `ValueError`.
  - Test: Fila con `ID` vacío → `ValueError` con número de fila.
  - Test: `ID` duplicado → `ValueError`.
  - Test: Espacios al inicio/fin en IDs y renombres se trimean.

**Acceptance criteria:**
- `api.db_parse_mapping({path: excel})` retorna `{mapping: {"IMG_0001.jpg": "fachada_norte.jpg", ...}}`.
- Errores vienen con mensaje en español y número de fila cuando aplica.

---

### Task 2: Backend — Modo `mapping` en `RenamerEngine`

**Files:**
- Modify: `backend/core/renamer.py`
- Test: `tests/test_renamer_mapping.py`

- [ ] Extender `RenamerEngine.aplicar()` con parámetro opcional `mapping: dict[str, str] | None = None`.
  - Si `mapping` está presente y `ruta_origen.name` (con `Path(ruta_origen).name` normalizado) está en `mapping`, retornar `mapping[stem_con_ext] + ext_original`.
  - Match debe ser tolerante: primero `ruta.name`, luego `ruta.stem` (por si el usuario puso el ID sin extensión), luego comparación insensible a mayúsculas.
  - Si no hay match, hacer fallback al comportamiento actual basado en `patron`.
- [ ] Agregar helper estático `RenamerEngine.build_mapping_patron(mapping_keys: list[str])` que retorna el patrón interno por compatibilidad (no se usa en el flujo mapeo real, solo en logs/tests).
- [ ] No modificar el comportamiento default (backward compatibility).
- [ ] Tests:
  - Test: `mapping={"IMG_0001.jpg": "fachada_norte"}` aplicado a `IMG_0001.jpg` retorna `fachada_norte.jpg` con la extensión original.
  - Test: Match tolerante sin extensión: `mapping={"IMG_0001": "fachada"}` aplicado a `IMG_0001.jpg` también funciona.
  - Test: Match case-insensitive: `mapping={"img_0001.jpg": "fachada"}` aplicado a `IMG_0001.jpg` funciona.
  - Test: Si no hay match, no falla — usa fallback de `patron` o retorna el nombre original sanitizado.
  - Test: `mapping` vacío `{}` se ignora.

**Acceptance criteria:**
- `RenamerEngine(patron="{codigo}{ext}").aplicar("IMG_0001.jpg", mapping={"IMG_0001.jpg": "fachada_norte"})` retorna `"fachada_norte.jpg"`.

---

### Task 3: Backend — Cablear `mapping` en `preview` y `_run_conversion_job`

**Files:**
- Modify: `backend/handlers/conversion.py`
- Test: `tests/test_conversion_mapping.py`

- [ ] Agregar `mapping` opcional a `preview(params)`:
  - Si viene, llamar `engine.preview_lote(files, mapping=mapping, ...)` en lugar de pasar `lookup_fn`.
  - Orden de precedencia: `mapping` > `key_column` > `use_column_rename` > default.
- [ ] Agregar `mapping` opcional a `ProcessBody` (param del job) en `_run_conversion_job`.
- [ ] Modificar `_prepare_chunk_tasks` para que cuando `engine` y `mapping` estén presentes, **no consulte la BD** y pase el `mapping` al `engine.aplicar`.
- [ ] Validación al inicio del job: si `mapping` viene, validar que `len(mapping) > 0` y que cada valor sea string no vacío.
- [ ] Reportar en logs: `"Modo: Renombrado por mapeo directo (N entradas)"` cuando se usa `mapping`.
- [ ] Tests:
  - Test: `preview` con `mapping` retorna nuevos nombres correctos sin consultar BD.
  - Test: `_run_conversion_job` con `mapping` y `conversion_enabled=false` solo renombra (no convierte).
  - Test: Precedencia: `mapping` toma precedencia sobre `key_column` aunque ambos estén presentes.

**Acceptance criteria:**
- `api.preview({files, mapping})` retorna `preview[]` con `en_bd=true` para todas las entradas con match.
- `api.process_start({files, destino, formato, conversion_enabled: false, mapping, patron: ""})` renombra en lote usando el mapeo.

---

### Task 4: Frontend — Tipos y método de API

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/types.ts`

- [ ] Agregar `dbParseMapping: (path: string) => _invoke<{ mapping: Record<string, string> }>('db_parse_mapping', { path })` al objeto `api`.
- [ ] Agregar `mapping?: Record<string, string>` a `PreviewBody` y `ProcessBody`.
- [ ] Agregar `MappingResult` interface a `types.ts`:
  ```ts
  export interface MappingResult {
    mapping: Record<string, string>;
    totalEntries: number;
    matchedFiles: number;
    unmatchedFiles: string[];
    orphanEntries: string[]; // IDs del Excel que no tienen archivo
  }
  ```
- [ ] Extender `dbParseMapping` para que retorne `MappingResult` (calcular `matchedFiles`, `unmatchedFiles`, `orphanEntries` en el handler backend).

**Acceptance criteria:**
- `await api.dbParseMapping(rutaExcel)` retorna `{ mapping, totalEntries, matchedFiles, unmatchedFiles, orphanEntries }`.

---

### Task 5: Frontend — Auto-detección y UI simplificada en `RenameCard`

**Files:**
- Modify: `frontend/src/components/conversion/RenameCard.tsx`
- Modify: `frontend/src/components/conversion/helpers.ts`
- Test: `frontend/src/components/conversion/RenameCard.mapping.test.tsx`

- [ ] En `RenameCard`, agregar estado local:
  ```ts
  const [mappingMode, setMappingMode] = useState(false);
  const [mappingResult, setMappingResult] = useState<MappingResult | null>(null);
  ```
- [ ] Función `detectMappingMode(columns: string[]): boolean` en `helpers.ts`:
  - Retorna `true` si `columns.length === 2` y los nombres normalizados (lowercase, sin acentos) son `id` y `renombre`.
- [ ] `useEffect` que observe `dbColumns` y active `mappingMode` automáticamente cuando se cumple la condición.
- [ ] Cuando `mappingMode === true`:
  - **Ocultar** los pasos 2 (columnas para renombrar) y 3 (separador).
  - **Mostrar** una nueva sección "Mapeo directo detectado" con:
    - Resumen: `123 archivos coincidirán • 5 archivos sin mapeo • 0 entradas huérfanas`.
    - Tabla compacta con scroll (3 columnas: `Actual`, `→`, `Nuevo nombre`) — primeras 10 filas + "ver todas".
    - Badge de advertencia si hay `unmatchedFiles > 0` o `orphanEntries > 0`.
  - **Generar internamente** el `patron` como `{renombre_mapeado}{ext}` (placeholder interno) y mantener la columna de BD en `keyColumn = "id"` por compatibilidad.
- [ ] Cuando `mappingMode === false` (caso actual), mantener la UI actual intacta.
- [ ] Test: con `dbColumns = ['id', 'renombre']`, el componente renderiza la sección de mapeo directo y oculta los pasos 2-3.
- [ ] Test: con `dbColumns = ['codigo', 'nombre', 'categoria']`, el componente renderiza la UI actual.
- [ ] Test: la tabla muestra los primeros 10 matches y un link "ver todas".

**Acceptance criteria:**
- Al importar un Excel con 2 columnas `ID` y `RENOMBRE`, el `RenameCard` muestra automáticamente la vista simplificada.
- El componente sigue funcionando con Excels de 3+ columnas (flujo actual intacto).

---

### Task 6: Frontend — Botón "Cargar mapeo" en `ConversionView`

**Files:**
- Modify: `frontend/src/components/conversion/ConversionView.tsx`
- Modify: `frontend/src/components/conversion/Dropzone.tsx`

- [ ] Agregar estado:
  ```ts
  const [mapping, setMapping] = useState<MappingResult | null>(null);
  ```
- [ ] Nueva función `loadMappingExcel()`:
  - Llama `api.dialogFiles()`.
  - Llama `api.dbParseMapping(ruta)` que retorna `MappingResult`.
  - Actualiza `mapping`, `dbColumns` (con `['id', 'renombre']`), y desactiva el `RenameCard` (se auto-activa `mappingMode`).
  - Toast de éxito: `"Mapeo cargado: 200 archivos coincidirán"`.
  - Si hay errores, toast de error con detalle (fila con problema, etc.).
- [ ] Pasar nueva prop `onLoadMapping?: () => void` al `Dropzone`.
- [ ] Renderizar botón "Cargar mapeo (ID → RENOMBRE)" en la barra de acciones del `Dropzone` con icono `ArrowRightLeft` de lucide-react.
- [ ] Distinguir visualmente el botón: el "Base de datos" carga al catálogo SQLite (flujo actual), el "Cargar mapeo" carga el Excel de mapeo directo (nuevo flujo).
- [ ] Test: al hacer click en "Cargar mapeo" y seleccionar un Excel válido, `mapping` se setea y la UI cambia al modo mapeo.

**Acceptance criteria:**
- El usuario puede elegir entre "Base de datos" (flujo complejo) o "Cargar mapeo" (flujo simple) sin perder acceso al flujo actual.
- Un Excel de mapeo no contamina la tabla `imagenes` de SQLite (es solo lectura).

---

### Task 7: Frontend — Pasar `mapping` en `preview` y `startProcess`

**Files:**
- Modify: `frontend/src/components/conversion/ConversionView.tsx`

- [ ] En `doProcess()`, agregar al body de `startProcess`:
  ```ts
  mapping: mapping?.mapping,
  ```
  Solo si `mappingMode` está activo.
- [ ] En el `useEffect` que carga la DB inicial, después de `api.getDbColumns()`:
  - Si las columnas son `['id', 'renombre']`, no llamar `setFields(columns)` (no queremos pisar los `fields` de configuración).
  - Activar el flag interno de "modo mapeo detectado".
- [ ] Para `preview` (cuando se implemente en otra tarea, dejar la integración lista): si `mapping` está presente, llamar `api.preview({files, mapping, ...})`.

**Acceptance criteria:**
- `startProcess` envía `mapping` solo cuando el usuario cargó un Excel de mapeo.
- El botón "Iniciar renombrado" / "Iniciar conversión" funciona end-to-end con el nuevo flujo.

---

### Task 8: Verificación final

**Files:**
- Run: `python -m pytest tests/test_database_mapping.py tests/test_renamer_mapping.py tests/test_conversion_mapping.py -v`
- Run: `cd frontend && npx vitest run src/components/conversion/RenameCard.mapping.test.tsx`
- Run: `cd frontend && npx tsc --noEmit`
- Run: `python -m pytest -q` (regresión completa)

- [ ] Todos los tests nuevos pasan.
- [ ] `tsc --noEmit` no muestra errores.
- [ ] La regresión completa no rompe ningún test existente.
- [ ] Smoke test manual (documentado en el PR):
  1. Crear Excel con 5 filas: `IMG_0001.jpg → fachada.jpg`, etc.
  2. Abrir Antares → Conversión.
  3. Click "Cargar mapeo" → seleccionar el Excel.
  4. Verificar que la UI muestra la tabla con 5 entradas y oculta pasos 2-3.
  5. Seleccionar 5 archivos con esos nombres en el sistema.
  6. Click "Iniciar renombrado" → verificar que los archivos se renombran según el mapeo.

---

## Criterios de éxito globales

1. **Reducción de pasos**: el usuario pasa de 3 decisiones (columna ID, columnas a renombrar, separador) a **0 decisiones** — solo cargar el Excel.
2. **No-regresión**: el flujo actual de 3+ columnas sigue funcionando exactamente igual.
3. **Aislamiento**: el Excel de mapeo no toca la BD SQLite ni los `fields` configurados.
4. **Robustez**: errores con mensajes claros en español (columna faltante, ID duplicado, ID vacío en fila N).
5. **Backward compatibility**: la API acepta `mapping` opcional, y todos los clientes existentes siguen funcionando sin ese campo.

## Out of scope (no se hace en este plan)

- Editor visual del mapeo (drag & drop, renombrar en línea).
- Mapeo fuzzy / búsqueda aproximada (ej. "IMG_001" → "IMG_0001").
- Soporte para múltiples archivos por ID (1 → N).
- Persistencia del mapeo entre sesiones (se recarga cada vez).
- Export del mapeo resultante a Excel.
