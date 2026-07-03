# 🚀 AutoIMG — Sistema de Gestión y Automatización de Imágenes

> **Proyecto:** ANTARES  
> **App base:** Electron + React + TypeScript + Python Backend  
> **Ubicación:** Feature independiente (nuevo tab en sidebar)  
> **Fuente de imágenes:** Google Drive Compartidos (solo lectura metadata)  
> **Base de datos:** Google Sheets (catálogo maestro)  
> **Sincronización:** Bidireccional app ↔ Google Sheets  
> **Regla sagrada:** 🔴 NO se suben archivos · NO se eliminan originales · NO se modifican originales  
> **Versión:** v4.0 — Multi-carpeta + plan completo funcional  
> **Estado:** 📝 En definición — listo para implementar

---

## 📋 Tabla de Contenidos

1. [Contexto del Proyecto](#contexto-del-proyecto)
2. [Problema](#problema)
3. [Solución Propuesta](#solución-propuesta)
4. [Arquitectura](#arquitectura)
5. [Multi-Carpeta: Escenario Real](#multi-carpeta-escenario-real)
6. [Flujo de Datos](#flujo-de-datos)
7. [Estructura del Google Sheet](#estructura-del-google-sheet)
8. [Registro de Carpetas (Folder Registry)](#registro-de-carpetas-folder-registry)
9. [API IPC — Métodos Completos](#api-ipc--métodos-completos)
10. [Lógica de Procesamiento](#lógica-de-procesamiento)
11. [Eventos IPC en Vivo](#eventos-ipc-en-vivo)
12. [Diseño de UI](#diseño-de-ui)
13. [Integración en ANTARES](#integración-en-antares)
14. [Plan de Implementación Detallado](#plan-de-implementación-detallado)
15. [Roadmap](#roadmap)
16. [Checklist de Validación](#checklist-de-validación)
17. [Anexos](#anexos)

---

## 📌 Contexto del Proyecto

### ¿Qué es ANTARES?
ANTARES es una **app de escritorio** (Electron + React + Python) para gestión de imágenes, conversión, formatos PDF, reportes técnicos y Evidencia Volanteo.

| Capa | Tecnología |
|------|-----------|
| UI | React + TypeScript + TailwindCSS + Vite |
| Backend IPC | Python 3.11 (JSON‑RPC via stdin/stdout) |
| Electron | Main process con contextBridge seguro |
| Testing | pytest (Python) + Vitest (TS) |
| Build | electron-builder + PyInstaller |

### ¿Qué cambia con AutoIMG?
AutoIMG es una **feature 100% independiente**. No hereda nada de otras funcionalidades — tiene su propio tab en la sidebar, sus propios servicios de Google (Sheets + Drive), y su propia lógica centrada en **Google Sheets** como base de datos viva y sincronizada, escaneando **múltiples carpetas** en Drive Compartidos.

---

## 🔴 Problema

### Contexto actual
ACCIONA SJL recibe **fotografías de predios** en carpetas compartidas de Google Drive (Compartidos). Varios técnicos suben imágenes a diferentes carpetas con nombres como `4210801-1.jpg`, donde `4210801` es el **NIS** (Número de Identificación del Suministro) de SEDAPAL.

### El problema real

```
📁 COMPARTIDOS (Google Drive)
│
├── 📁 TECNICO_JUAN/
│   ├── 4210801-1.jpg
│   ├── 4210801-2.jpg
│   └── 4210809-1.jpg
│
├── 📁 TECNICO_PEDRO/
│   ├── 4210833-1.jpg
│   ├── 4210833-2.jpg
│   ├── 4210833-3.jpg
│   └── 4210840-1.jpg
│
├── 📁 FOTOS_NUEVAS_2026-06/
│   ├── 4210901-1.jpg
│   ├── 4210901-2.jpg
│   └── 4210905-1.jpg
│
└── 📁 REVISIONES/
    └── ...
```

Cada carpeta tiene imágenes de distintos NIS. El usuario necesita **escaneas todas las carpetas activas en un solo clic**, cruzar contra el Sheet maestro, y actualizar el estado.

### El dolor 🥴
| Problema | Impacto |
|----------|---------|
| 📁 **Múltiples carpetas** sin gestión centralizada | Se pierde visibilidad de lo que hay en cada una |
| 🔁 **Mismo NIS en varias carpetas** (duplicados) | Contar incorrectamente o procesar doble |
| ✏️ **Errores de tipeo** al renombrar | Imágenes perdidas en carpeta equivocada |
| 📊 **BD desactualizada** | Se procesan NIS que ya estaban completos |
| 💻 **Dependencia de Excel local** | Solo funciona en una PC |
| 🚫 **Sin trazabilidad** | No se sabe quién procesó qué ni cuándo |

---

## ✅ Solución Propuesta

### Filosofía: "Drive es la fuente de imágenes · Sheets es la fuente de datos"

| Principio | Descripción |
|-----------|-------------|
| 🔴 **No modificar originales** | Las fotos en Compartidos NUNCA se tocan, renombran, mueven ni eliminan |
| ✅ **Solo lectura de imágenes** | La app solo LEE nombres y metadata de Drive Compartidos |
| 📊 **Google Sheets como BD** | Toda la metadata vive en un Google Sheet compartido |
| 📁 **Multi-carpeta** | Se registran N carpetas en el Sheet — la app escanea todas en cada ciclo |
| 🔄 **Sync bidireccional** | App escribe en Sheet · Sheet se refleja en app · Edits manuales se sincronizan |
| 🚫 **No subir archivos** | No se suben imágenes a ningún lado — solo se actualiza metadata en el Sheet |
| 📐 **Una sola fuente de verdad** | El Sheet es el catálogo maestro, no hay Excel local |

### ¿Qué hace AutoIMG?

```
 0️⃣  REGISTRAR carpetas activas en CONFIG del Sheet
 1️⃣  LEER metadata de imágenes de TODAS las carpetas registradas
 2️⃣  Analizar nombres → extraer NIS de 7 dígitos
 3️⃣  Buscar mapping NIS→SGIO en Google Sheets
 4️⃣  Contar imágenes por NIS (1, 2, 3...) — si mismo NIS en varias carpetas, se suma
 5️⃣  ACTUALIZAR el Google Sheet con:
       ✅ CANTIDAD total de imágenes encontradas (deduplicada)
       ✅ Estado (🟢=3, 🔴<3, 🟡>3)
       ✅ Carpeta-origen de cada imagen
       ✅ Fecha de última verificación
       ✅ Registro en LOGS
 6️⃣  NO mueve · NO copia · NO sube · NO elimina archivos
```

---

## 🏗️ Arquitectura

### Diagrama de capas

```
┌─────────────────────────────────────────────────────────────────────┐
│                    🖥️ RENDERER (React + TS)                          │
│                                                                       │
│   ┌─────────────────────────────────────────────────────────┐        │
│   │                    AutoIMGApp                             │        │
│   │  ┌──────────┐  ┌─────────────┐  ┌──────────────────┐   │        │
│   │  │ Dashboard │  │ FolderMgmt  │  │ BdImgTable       │   │        │
│   │  │ (cards    │  │ (registro   │  │ (SheetView ·     │   │        │
│   │  │  métricas)│  │  multi-     │  │  colores · col.) │   │        │
│   │  │           │  │  carpeta)   │  │                  │   │        │
│   │  └──────────┘  └─────────────┘  └──────────────────┘   │        │
│   │                                                         │        │
│   │  ┌──────────┐  ┌──────────────┐  ┌───────────────┐    │        │
│   │  │ Scanner  │  │ SyncPanel    │  │ LogsViewer    │    │        │
│   │  │ (progreso│  │ (to/from     │  │ (historial    │    │        │
│   │  │  · per-  │  │  Sheet)      │  │  operaciones) │    │        │
│   │  │  folder) │  │              │  │               │    │        │
│   │  └──────────┘  └──────────────┘  └───────────────┘    │        │
│   └─────────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────────┘
                              ↕ IPC (contextBridge)
┌─────────────────────────────────────────────────────────────────────┐
│                    ⚙️ ELECTRON MAIN PROCESS                          │
│                                                                       │
│   ┌─────────────────────────────────────────────────────────┐        │
│   │  GoogleSheetsService    │  GoogleDriveService           │        │
│   │  ┌─────────────────┐    │  ┌────────────────────────┐  │        │
│   │  │ OAuth2 + tokens  │    │  │ listFiles(folderId)   │  │        │
│   │  │ readRange()      │    │  │ scanFolder(folderId)  │  │        │
│   │  │ writeRange()     │    │  │ scanAllFolders(folder │  │        │
│   │  │ appendRow()      │    │  │   Ids[])              │  │        │
│   │  └─────────────────┘    │  └────────────────────────┘  │        │
│   │                                                         │        │
│   │  ┌─────────────────────────────────────────────────┐    │        │
│   │  │  SyncEngine                                      │    │        │
│   │  │  ┌──────────┐  ┌──────────┐  ┌────────────┐    │    │        │
│   │  │  │ batchScan│  │mergeResults│ │ writeSheet │    │    │        │
│   │  │  │ (all     │  │ (dedup +   │ │ (batch     │    │    │        │
│   │  │  │ folders) │  │  compare)  │ │  writes)   │    │    │        │
│   │  │  └──────────┘  └──────────┘  └────────────┘    │    │        │
│   │  └─────────────────────────────────────────────────┘    │        │
│   │                                                         │        │
│   │  ┌──────────────┐  ┌──────────────────────────────┐    │        │
│   │  │ TokenStorage  │  │ Reporter (LOGS + RESUMEN)   │    │        │
│   │  └──────────────┘  └──────────────────────────────┘    │        │
│   └─────────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────────┘
                              ↕ JSON-RPC (stdin/stdout)
┌─────────────────────────────────────────────────────────────────────┐
│                    🐍 PYTHON BACKEND                                 │
│   handlers/autoimg.py — IPC wrapper (procesos pesados)              │
│   handlers/autoimg_sync.py — Sync engine + batch writes             │
└─────────────────────────────────────────────────────────────────────┘
                              ↕ REST (Google APIs)
┌─────────────────────────────────────────────────────────────────────┐
│                    ☁️ GOOGLE CLOUD                                    │
│                                                                       │
│   🔴 Google Drive (Compartidos)     📊 Google Sheets                │
│   ┌────────────────────────────┐    ┌──────────────────────────┐    │
│   │ 📁 TECNICO_JUAN/       ←──┼─   │ ACCIONA SJL - AutoIMG    │    │
│   │ 📁 TECNICO_PEDRO/      ←──┼─   │ ┌────────────────────┐   │    │
│   │ 📁 FOTOS_NUEVAS_06/   ←──┼─   │ │ BD_IMG (Sheet)     │   │    │
│   │   ...                      │    │ │ FOLDERS (registro) │   │    │
│   │                            │    │ │ BD_ARRASTRE        │   │    │
│   │ 🚫 NO MODIFICAR           │    │ │ LOGS               │   │    │
│   │ 🚫 NO ELIMINAR            │    │ │ CONFIG             │   │    │
│   │ 🚫 NO SUBIR               │    │ │ RESUMEN            │   │    │
│   └────────────────────────────┘    │ └────────────────────┘   │    │
│                                      └──────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### Componentes del sistema

| Componente | Responsabilidad |
|------------|----------------|
| **GoogleSheetsService** | OAuth2 + CRUD sobre Google Sheets API v4 (readRange, writeRange, appendRow) |
| **GoogleDriveService** | Listar archivos en carpetas de Compartidos, escanear múltiples folder IDs |
| **NISParser** | Regex `\d{7}` para extraer NIS de nombres de archivo |
| **SyncEngine** | Escanear todas las carpetas → merge → detectar cambios → escribir al Sheet |
| **FolderRegistry** | Leer/escribir la lista de carpetas activas desde hoja FOLDERS del Sheet |
| **Reporter** | Generar entradas en hoja LOGS + actualizar hoja RESUMEN |
| **Dashboard** | Cards de métricas en tiempo real |
| **BdImgTable** | Vista de la tabla BD_IMG con colores por estado |
| **FolderMgmt** | Panel para agregar/quitar carpetas del registro |

---

## 📁 Multi-Carpeta: Escenario Real

### ¿Por qué múltiples carpetas?

En el flujo de trabajo real de ACCIONA SJL:

1. **Cada técnico** sube fotos a su propia carpeta en Compartidos
2. Hay **carpetas por fecha** (e.g., `FOTOS_NUEVAS_2026-06-30`)
3. Hay **carpetas de revisión** (e.g., `REVISIONES/`, `FALTANTES/`)
4. El número de carpetas **cambia con el tiempo**

AutoIMG debe poder:
- **Registrar** cualquier carpeta como fuente activa
- **Escaneas todas** en un solo ciclo
- Mostrar **resultados por carpeta** y **agregados**
- **Detectar duplicados** (mismo NIS en 2+ carpetas) y contarlos correctamente
- **Agregar/quitar** carpetas sin perder datos

### Registro de Carpetas (Folder Registry)

| Concepto | Cómo funciona |
|----------|--------------|
| 📋 **Hoja FOLDERS** | Nuevo sheet en el Google Sheet que lista todas las carpetas activas |
| ➕ **Agregar** | Usuario pega el Folder ID y un nombre descriptivo → se guarda en FOLDERS |
| ❌ **Quitar** | Se elimina la fila de FOLDERS (no afecta las imágenes en Drive) |
| 🔄 **Scan** | SyncEngine lee FOLDERS → itera cada folderId → acumula resultados |
| 🧩 **Deduplicación** | Si un NIS aparece en N carpetas, se usa el conteo máximo o la suma (configurable) |

### Estrategia de escaneo multi-carpeta

```
INPUT:  [folderId_1, folderId_2, ..., folderId_N]
          │
          ▼
┌─────────────────────────────────────────────┐
│  DriveService.scanAllFolders(folderIds[])    │
│                                              │
│  for each folderId:                          │
│    files = Drive.files.list({ q: query })    │
│    for each file:                            │
│      nis = regex_extract(file.name)          │
│      raw_results.push({ nis, file, folder }) │
│                                              │
│  → AGRUPAR por NIS                          │
│  → Si mismo NIS de carpetas distintas        │
│    → SUMAR cantidad                          │
│    → Registrar origen en columna ORIGEN      │
│                                              │
│  OUTPUT:  { nis -> { count, files[],        │
│                      folders[], estado } }    │
└─────────────────────────────────────────────┘
          │
          ▼
        Merge con BD_IMG (del Sheet)
          │
          ▼
        Escribir resultados al Sheet
```

### Lógica de deduplicación

```
Caso: NIS 4210801 aparece en:
  - TECNICO_JUAN/  → 2 imágenes (4210801-1.jpg, 4210801-2.jpg)
  - REVISIONES/    → 1 imagen  (4210801-3.jpg)
  
Resultado:
  - CANTIDAD = 3 (suma de ambas carpetas)
  - ORIGEN = "TECNICO_JUAN; REVISIONES"
  - IMG_1 = ✅, IMG_2 = ✅, IMG_3 = ✅
  - ESTADO = 🟢 COMPLETO
  - NIS único en BD_IMG (no se duplica la fila)
```

---

## 🔄 Flujo de Datos

### Flujo completo (multi-carpeta vía Google Sheets)

```
 0️⃣  CONFIGURACIÓN INICIAL
     │   → Usuario autentica Google (OAuth2)
     │   → Abre/crea el Sheet "ACCIONA SJL - AutoIMG"
     │   → Agrega carpetas en FolderMgmt (nombre + folderId)
     │   → Cada carpeta se guarda en hoja FOLDERS del Sheet
     │
 1️⃣  USUARIO abre ANTARES → Tab "AutoIMG"
     │
 2️⃣  APP carga datos desde Sheet
     │   → Lee BD_IMG (catálogo maestro)
     │   → Lee FOLDERS (carpetas activas)
     │   → Lee CONFIG (settings)
     │   → Lee RESUMEN (métricas cacheadas)
     │   → Renderiza Dashboard + tabla
     │
 3️⃣  USUARIO hace clic en "🔍 Escaneas Todo"
     │
 4️⃣  APP escanea TODAS las carpetas registradas
     │   → Por cada folderId en FOLDERS:
     │   │   → files.list (solo metadata)
     │   │   → Extrae NIS de nombres
     │   │   → Emite evento IPC progress
     │   → Acumula resultados en memoria
     │   → Deduplica NIS (suma carpetas)
     │
 5️⃣  APP cruza datos vs BD_IMG
     │   → Por cada NIS encontrado:
     │   │   → Busca en BD_IMG (memoria local)
     │   │   → Si existe → prepara update (CANTIDAD, ESTADO, etc.)
     │   │   → Si no existe → marca "NUEVO (sin SGIO)"
     │   → Prepara batch de writes
     │
 6️⃣  APP escribe resultados al Sheet
     │   → Actualiza BD_IMG (batch write, max 10 filas)
     │   → Añade fila a LOGS
     │   → Actualiza RESUMEN
     │
 7️⃣  APP muestra resultado
     │   → Tabla con colores
     │   → Cards de resumen
     │   → Log de la operación
```

### Diagrama de flujo

```
                    ┌──────────────┐
                    │  INICIO      │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  Auth Google  │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  Cargar      │
                    │  Google      │
                    │  Sheet       │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  Leer        │
                    │  FOLDERS     │
                    │  (carpetas   │
                    │   activas)   │
                    └──────┬───────┘
                           │
              ┌────────────▼────────────┐
              │  Escaneas TODAS las      │
              │  carpetas registradas    │
              │  (por cada folderId)     │
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │  Extraer NIS +          │
              │  deduplicar             │
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │  Cruzar vs BD_IMG       │
              │  del Sheet              │
              └────────────┬────────────┘
                           │
                ┌──────────▼──────────┐
                │  ¿Match en BD_IMG?   │
                └──────┬──────┬───────┘
                       │ Sí   │ No
                       ▼      ▼
              ┌──────────┐  ┌──────────────┐
              │ Actualizar│  │ Marcar       │
              │ CANTIDAD  │  │ NUEVO (sin   │
              │ + ESTADO  │  │ SGIO)        │
              └──────┬───┘  └──────┬───────┘
                     │             │
                     └──────┬──────┘
                            │
              ┌─────────────▼─────────────┐
              │  Escribir en Google Sheet │
              │  (batch: BD_IMG + LOGS    │
              │   + RESUMEN)              │
              └─────────────┬─────────────┘
                            │
              ┌─────────────▼─────────────┐
              │  Mostrar resultado en UI  │
              └───────────────────────────┘
```

---

## 📊 Estructura del Google Sheet

### Hoja 1: BD_IMG — Catálogo maestro

| Col | ID | Tipo | Ejemplo | Notas |
|-----|-----|------|---------|-------|
| A | NIS | Texto | 4210801 | ID SEDAPAL, 7 dígitos |
| B | SGIO | Texto | 69656525 | ID ACCIONA |
| C | DESTINO | Texto | IMAGENES DVD 03 | Carpeta destino |
| D | NOMBRE | Texto | CASTILLO HUERTA LIZETH | Nombre del predio |
| E | DIRECCION | Texto | AV. LOS JAZMINES MZ E | Dirección |
| F | IMG_1 | Texto | ✅ / ⬜ | ¿Existe imagen 1? |
| G | IMG_2 | Texto | ✅ / ⬜ | ¿Existe imagen 2? |
| H | IMG_3 | Texto | ✅ / ⬜ | ¿Existe imagen 3? |
| I | CANTIDAD | Número | 3 | Cuenta real (suma de carpetas) |
| J | ESTADO | Texto | 🟢 COMPLETO | 🟢=3, 🔴<3, 🟡>3 |
| K | ORIGEN_CARPETAS | Texto | TECNICO_JUAN; REVISIONES | De qué carpeta(s) vino |
| L | ÚLTIMA_VERIFICACIÓN | Fecha | 2026-07-02 14:30 | Timestamp del último scan |
| M | NOTAS | Texto | Duplicado en DVD 02 | Observaciones |

### Hoja 2: FOLDERS — Registro de carpetas activas (NUEVA)

| Col | ID | Tipo | Ejemplo | Notas |
|-----|-----|------|---------|-------|
| A | NOMBRE | Texto | TECNICO JUAN | Nombre descriptivo |
| B | FOLDER_ID | Texto | 1abc123... | ID de Google Drive |
| C | ACTIVO | Texto | ✅ / ❌ | Si está activa para scan |
| D | ÚLTIMO_SCAN | Fecha | 2026-07-02 | Cuándo se escaneó por última vez |
| E | CANT_ARCHIVOS | Número | 42 | Cuántos archivos tenía en último scan |

```
Ejemplo de hoja FOLDERS:
┌────────────────┬──────────────────────┬────────┬──────────────────┬──────────────┐
│ NOMBRE         │ FOLDER_ID            │ ACTIVO │ ÚLTIMO_SCAN      │ CANT_ARCHIVOS│
├────────────────┼──────────────────────┼────────┼──────────────────┼──────────────┤
│ TECNICO JUAN   │ 1abc123...           │ ✅     │ 2026-07-02 14:30 │ 42           │
│ TECNICO PEDRO  │ 1def456...           │ ✅     │ 2026-07-02 14:00 │ 38           │
│ FOTOS NUEVAS   │ 1ghi789...           │ ✅     │ 2026-07-01 16:00 │ 15           │
│ REVISIONES     │ 1jkl012...           │ ❌     │ 2026-06-30 09:00 │ 4            │
│ ANTIGUO_2025   │ 1mno345...           │ ❌     │ 2025-12-30 00:00│ 120          │
└────────────────┴──────────────────────┴────────┴──────────────────┴──────────────┘
```

### Hoja 3: BD_ARRASTRE — Casos especiales

| Col | Tipo | Ejemplo |
|-----|------|---------|
| NIS | Texto | 4210801 |
| SGIO | Texto | 69656525 |
| MOTIVO | Texto | Arrastre manual |
| FECHA | Fecha | 2026-07-01 |
| OBSERVACION | Texto | Reasignado por supervisor |

### Hoja 4: LOGS — Trazabilidad

| Col | Tipo | Ejemplo |
|-----|------|---------|
| FECHA | Fecha | 2026-07-02 14:30 |
| ACCIÓN | Texto | SCAN_ALL_FOLDERS |
| DETALLE | Texto | 4 carpetas · 95 NIS · 432 completos · 98 faltantes |
| USUARIO | Texto | tecnico1@acciona.pe |
| DURACIÓN_SEG | Número | 12.5 |

### Hoja 5: CONFIG — Configuración global

| Clave | Valor | Descripción |
|-------|-------|-------------|
| SHEET_ID | 1xyz... | ID del Google Sheet (auto-detectado) |
| ULTIMO_SYNC | 2026-07-02 14:30 | Última sincronización exitosa |
| SYNC_INTERVAL_MIN | 5 | Minutos entre sync automático |
| USUARIO | tecnico1@acciona.pe | Usuario de Google autenticado |
| DEDUP_STRATEGY | SUM | Cómo combinar NIS duplicados (SUM/MAX) |
| FORMAT | 7d | Formato de extracción de NIS (7d o 10d) |

### Hoja 6: RESUMEN — Dashboard

| Métrica | Valor | Fecha |
|---------|-------|-------|
| TOTAL NIS | 575 | 2026-07-02 |
| 🟢 COMPLETOS (3/3) | 432 | 2026-07-02 |
| 🔴 FALTANTES (<3) | 98 | 2026-07-02 |
| 🟡 SOBRANTES (>3) | 12 | 2026-07-02 |
| SIN SGIO | 33 | 2026-07-02 |
| CARPETAS ACTIVAS | 3 | 2026-07-02 |
| ÚLTIMO PROCESO | SCAN_ALL_FOLDERS | 2026-07-02 |

---

## 🖥️ Diseño de UI

### Layout general

```
┌──────────────────────────────────────────────────────────────────┐
│  [🔄 AutoIMG] ← nuevo tab independiente (sidebar izquierda)      │
├──────────────────────────────────────────────────────────────────┤
│  Cabecera:                                                        │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │  📊 ACCIONA SJL - AutoIMG              🟢 Conectado          ││
│  │  📁 3 carpetas activas · Último sync: hace 2 min            ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                   │
│  [📊 Dashboard] [📋 BD_IMG] [📁 Carpetas] [🔍 Scan] [📄 Logs]   │
│  ──────────────────────────────────────────────────────────────── │
│                                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │  📊 575  │ │ 🟢 432   │ │ 🔴 98   │ │ 🟡 12    │            │
│  │ Total    │ │ Completos│ │Faltantes │ │Sobrantes │            │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  [🔍 Escaneas TODO (3 carpetas)]  [📤 Sync to Sheet]     │    │
│  │  [📥 Sync from Sheet]            [🔄 Auto: ON]            │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  📋 BD_IMG — Vista en vivo (filtrable)                  │    │
│  │  ┌──────┬────────┬────────┬─┬─┬─┬──┬────────┬─────────┐ │    │
│  │  │ NIS  │ SGIO   │DESTINO │1│2│3│ C│ ESTADO │ ORIGEN  │ │    │
│  │  ├──────┼────────┼────────┼─┼─┼─┼──┼────────┼─────────┤ │    │
│  │  │421080│69656525│ DVD 03 │✅│✅│✅│ 🟢│JUAN;    │ │    │
│  │  │      │        │        │  │  │  │ 3│        │REVIS.  │ │    │
│  │  │421080│69656526│ DVD 03 │✅│✅│⬜│ 🔴│JUAN     │ │    │
│  │  │      │        │        │  │  │  │ 2│        │         │ │    │
│  │  │559675│ —      │ —      │⬜│⬜│⬜│ 🔴│FOTOS    │ │    │
│  │  │      │(nuevo) │        │  │  │  │ 0│        │NUEVAS  │ │    │
│  │  └──────┴────────┴────────┴─┴─┴─┴──┴────────┴─────────┘ │    │
│  │  < Filtro: [Todos] [🟢] [🔴] [🟡] >                       │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

### Panel de Carpetas (FolderMgmt)

```
┌──────────────────────────────────────────────────────────────────┐
│  📁 Carpetas activas                                             │
│                                                                   │
│  ┌──────────────────┬──────────────────────┬────────┬─────────┐  │
│  │ NOMBRE           │ FOLDER_ID            │ ACTIVO │ ARCHIVOS│  │
│  ├──────────────────┼──────────────────────┼────────┼─────────┤  │
│  │ TECNICO JUAN     │ 1abc123...           │ ✅     │ 42      │  │
│  │ TECNICO PEDRO    │ 1def456...           │ ✅     │ 38      │  │
│  │ FOTOS NUEVAS     │ 1ghi789...           │ ✅     │ 15      │  │
│  │ REVISIONES       │ 1jkl012...           │ ❌     │ —       │  │
│  └──────────────────┴──────────────────────┴────────┴─────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ ➕ Agregar carpeta                                            ││
│  │  Nombre: [________________]  Folder ID: [________________]   ││
│  │  [✅ Activa]  [➕ Agregar]                                   ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                   │
│  📝 El Folder ID está en la URL de Drive:                         │
│  https://drive.google.com/drive/folders/1abc123...               │
│                                                                   │
│  💡 Puedes desactivar temporalmente una carpeta sin               │
│     perder su registro.                                           │
└──────────────────────────────────────────────────────────────────┘
```

### Panel de Escaneo (ScannerPanel)

```
┌──────────────────────────────────────────────────────────────────┐
│  [🔍 Escaneas TODAS las carpetas activas]                        │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │  Progreso: ████████████░░░░░░░░░░  62%                        ││
│  │  Escaneando: TECNICO_PEDRO/ (folder 2 de 3)                  ││
│  │  Archivos procesados: 26 de 42                               ││
│  │  NIS encontrados: 18                                         ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                   │
│  Resultados del último scan:                                     │
│  ┌──────────┬──────────┬──────────┬──────────┐                   │
│  │  📁 3    │  📊 38   │  🟢 25   │  🔴 8    │                   │
│  │ Carpetas │ NIS únicos│Completos│Faltantes│                   │
│  └──────────┴──────────┴──────────┴──────────┘                   │
│                                                                   │
│  Detalle por carpeta:                                            │
│  │ 📁 TECNICO JUAN   → 42 archivos · 28 NIS · 18 completos     │
│  │ 📁 TECNICO PEDRO  → 38 archivos · 15 NIS · 10 completos     │
│  │ 📁 FOTOS NUEVAS   → 15 archivos · 8 NIS  · 5 completos      │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🔌 API IPC — Métodos Completos

### Google Sheets Auth
```
autoimg_sheets_auth_url         → { url: string }
autoimg_sheets_auth_callback    ← { code: string }  → { success: boolean }
autoimg_sheets_auth_status      → { authenticated: boolean, email?: string }
autoimg_sheets_auth_revoke      → { success: boolean }
```

### Google Sheets CRUD
```
autoimg_sheets_open             ← { sheet_id: string }  → { success: boolean, name?: string, sheets?: string[] }
autoimg_sheets_read_range       ← { range: string }  → { values: any[][] }
autoimg_sheets_write_range      ← { range: string, values: any[][] }  → { updated: number }
autoimg_sheets_append_row       ← { range: string, values: any[] }  → { row: number }
```

### Google Drive (solo lectura metadata)
```
autoimg_drive_list_folder       ← { folder_id: string }  → { files: Array<{ name, id, modifiedTime }> }
autoimg_drive_scan_nis          ← { folder_id: string }  → { nis_map: Record<string, { count, files[] }> }
```

### AutoIMG Core (multi-folder)
```
autoimg_folders_list            → { folders: Array<{ name, folder_id, activo, ultimo_scan, cant_archivos }> }
autoimg_folders_add             ← { name: string, folder_id: string, activo: boolean }  → { success: boolean }
autoimg_folders_remove          ← { folder_id: string }  → { success: boolean }
autoimg_folders_toggle          ← { folder_id: string, activo: boolean }  → { success: boolean }

autoimg_scan_all                → { results: { folder_summary: {...}[], nis_results: {...}[] }, summary: { total, completos, faltantes, sobrantes, sin_sgio } }
autoimg_sync_to_sheet           → { success: boolean, updated: number, new_rows: number, logs: string[] }
autoimg_sync_from_sheet         → { success: boolean, rows: any[][] }

autoimg_auto_sync_toggle        ← { enabled: boolean }  → { enabled: boolean }

autoimg_status                  → { connected: boolean, sheetName?: string, lastSync?: string, autoSync: boolean, totalNis?: number, completos?: number, faltantes?: number, carpetasActivas?: number }
```

---

## 📦 Plan de Implementación Detallado

### Fase 0 — Setup del proyecto (6h)

| # | Tarea | Tiempo | Detalle |
|---|-------|--------|---------|
| 0.1 | Crear tab AutoIMG en navigation.ts + Sidebar | 1h | Ícono, shortcut Ctrl+Shift+A |
| 0.2 | Estructura autoimg/ en frontend | 1h | AutoIMGApp.tsx + subcomponents |
| 0.3 | Registrar IPC methods en ipc-router.js + ipc-methods.js | 1h | Todos los métodos del API IPC |
| 0.4 | Añadir api.ts endpoints | 1h | Tipos + funciones para cada método |
| 0.5 | Componente raíz con tabs internos | 2h | Dashboard / BD_IMG / Carpetas / Scan / Logs |

**Verificación:** El tab AutoIMG aparece en la sidebar, al hacer clic se ve un placeholder.

### Fase 1 — Google Cloud + OAuth2 + Sheets (30h)

| # | Tarea | Tiempo | Detalle |
|---|-------|--------|---------|
| 1.1 | Crear proyecto en Google Cloud Console | 1h | Habilitar Sheets API + Drive API |
| 1.2 | Credenciales OAuth2 (app desktop) | 1h | Client ID + Secret + redirect URIs |
| 1.3 | OAuth2 flow en Electron | 6h | Ventana de auth → code → tokens → refresh |
| 1.4 | TokenStorage (archivo cifrado local) | 2h | Guardar/leer/refrescar tokens |
| 1.5 | GoogleSheetsService: open | 2h | Abrir Sheet por ID, cachear metadata |
| 1.6 | GoogleSheetsService: readRange | 3h | Leer rangos, parsear header+fila |
| 1.7 | GoogleSheetsService: writeRange | 3h | Escribir batch updates |
| 1.8 | GoogleSheetsService: appendRow | 2h | Append a hoja LOGS |
| 1.9 | GoogleDriveService: listFiles | 3h | Listar archivos por folderId (solo metadata) |
| 1.10 | NISParser: regex + agrupación | 2h | `/\b(\d{7})\b/` + agrupar por NIS |
| 1.11 | Manejo de rate limits + retry | 3h | Exponential backoff + batch writes |
| 1.12 | Tests unitarios | 2h | OAuth2, Sheets, Drive (con mock) |

**Verificación:** 
- ✅ Auth OAuth2 funcional (code → token → refresh)
- ✅ Leer BD_IMG desde Sheet y mostrar en consola
- ✅ Escribir una fila de prueba al Sheet  
- ✅ Listar archivos de una carpeta de Drive

### Fase 2 — Multi-folder + Core Engine (20h)

| # | Tarea | Tiempo | Detalle |
|---|-------|--------|---------|
| 2.1 | FolderRegistry: CRUD hoja FOLDERS | 3h | Listar, agregar, quitar, toggle carpetas |
| 2.2 | DriveService: scanAllFolders | 4h | Iterar todas las carpetas activas → acumular |
| 2.3 | DedupEngine: merge NIS por carpeta | 3h | Mismo NIS → sumar/agrupar/origen |
| 2.4 | CompareEngine: cruzar vs BD_IMG | 2h | Match NIS → detectar cambios |
| 2.5 | SyncEngine: sync_to_sheet | 4h | Batch write BD_IMG + LOGS + RESUMEN |
| 2.6 | SyncEngine: sync_from_sheet | 2h | Leer Sheet → refrescar estado local |
| 2.7 | Auto-sync automático (setInterval) | 2h | Cada N minutos sync_from_sheet |

**Verificación:**
- ✅ 2 carpetas registradas → scan ambas → resultados correctos
- ✅ Mismo NIS en 2 carpetas → cuenta suma correctamente
- ✅ Sheet actualizado con batch write
- ✅ LOGS se generan correctamente

### Fase 3 — Frontend completo (24h)

| # | Tarea | Tiempo | Detalle |
|---|-------|--------|---------|
| 3.1 | GoogleAuthPanel (conectar/reconectar) | 2h | Mostrar URL OAuth2, input para code |
| 3.2 | DashboardCards (métricas) | 2h | 4 cards: total, 🟢, 🔴, 🟡 |
| 3.3 | BdImgTable (tabla BD_IMG viva) | 5h | Columnas, colores, filtros, búsqueda |
| 3.4 | FolderMgmt (gestión de carpetas) | 4h | Tabla de carpetas + add/remove/toggle |
| 3.5 | ScannerPanel (escaneo múltiple) | 4h | Barra de progreso, resultados por carpeta |
| 3.6 | SyncPanel (botones sync) | 2h | Sync to/from Sheet + indicador de estado |
| 3.7 | LogsViewer (historial) | 2h | Tabla de LOGS con colores por acción |
| 3.8 | Loaders, skeletons, estados vacío | 2h | UX: loading, sin datos, errores |
| 3.9 | Traducción ES | 1h | Textos en español |

**Verificación:**
- ✅ Todos los paneles se renderizan sin errores
- ✅ Tabla BD_IMG filtra y colorea correctamente
- ✅ FolderMgmt agrega/quita carpetas
- ✅ ScannerPanel muestra progreso por carpeta

### Fase 4 — Integración + Tests E2E (16h)

| # | Tarea | Tiempo | Detalle |
|---|-------|--------|---------|
| 4.1 | Pruebas con Sheet real (3 carpetas mock) | 3h | Datos de prueba en Compartidos |
| 4.2 | Prueba de sync bidireccional | 2h | App→Sheet→navegador→Sheet→App |
| 4.3 | Prueba de rate limits (100+ archivos) | 2h | Batch writes con 50 filas |
| 4.4 | Prueba de deduplicación multi-carpeta | 2h | Mismo NIS en 2 carpetas |
| 4.5 | Prueba de error handling | 2h | Sin conexión, token expirado, folder inválido |
| 4.6 | Pulir UX/UI | 3h | Transiciones, tooltips, responsive |
| 4.7 | Documentación técnica | 1h | Cómo funciona cada componente |
| 4.8 | Documentación de usuario | 1h | Manual de uso |

**Verificación:**
- ✅ npm test pasa sin errores
- ✅ npm run typecheck:frontend pasa
- ✅ npm run lint:python pasa
- ✅ Flujo completo: Auth → agregar carpeta → escanear → sync → ver resultado

---

## 🗺️ Roadmap

```
          Sem 1     Sem 2     Sem 3     Sem 4     Sem 5
Fase 0    ████░░░░
Fase 1    ░░░░████████░░░░
Fase 2    ░░░░░░░░░░████████░░░░
Fase 3    ░░░░░░░░░░░░░░░░████████░░░░
Fase 4    ░░░░░░░░░░░░░░░░░░░░░░██████

MVP v1.0                                              ◆
```

### Hitos clave

| Hito | Fecha | Entregable |
|------|-------|------------|
| 🏗️ Setup | Día 2 | Tab AutoIMG visible + estructura |
| 🔌 Google APIs | Día 10 | OAuth2 + Sheets CRUD + Drive list |
| 📁 Multi-folder | Día 14 | FolderRegistry + scanAllFolders + dedup |
| 🔄 Sync Engine | Día 18 | Sync bidireccional + batch writes |
| 🖥️ UI completa | Día 25 | Todos los componentes funcionales |
| ✅ Tests E2E | Día 28 | Pruebas con datos reales |
| 🚀 MVP v1.0 | Día 30 | Feature completa y testeada |

---

## ✅ Checklist de Validación

| # | Ítem | Estado |
|---|------|--------|
| 1 | Fotos están en Google Drive Compartidos (varias carpetas) | ✅ Confirmado |
| 2 | No eliminar ni modificar originales | ✅ Regla sagrada |
| 3 | No subir archivos a ningún lado | ✅ Regla sagrada |
| 4 | Google Sheets como base de datos (no BD_IMG.xlsx) | ✅ Confirmado |
| 5 | Múltiples carpetas registrables y escaneables | ✅ Nueva en v4 |
| 6 | Deduplicación de NIS entre carpetas | ✅ Nueva en v4 |
| 7 | Sincronización bidireccional app ↔ Sheets | ✅ |
| 8 | Feature independiente (nuevo tab, no sub-feature) | ✅ |
| 9 | Obtener cuenta Google para OAuth2 | ⬜ Pendiente |
| 10 | Crear proyecto en Google Cloud Console | ⬜ Pendiente |
| 11 | Crear Google Sheet "ACCIONA SJL - AutoIMG" | ⬜ Pendiente |
| 12 | Crear hoja FOLDERS con 2-3 carpetas de prueba | ⬜ Pendiente |
| 13 | Probar con 5+ archivos en 2 carpetas distintas | ⬜ Pendiente |

---

## 📁 Resumen de archivos del módulo

```
frontend/src/components/autoimg/
├── index.tsx                         ← Re-export
├── AutoIMGApp.tsx                    ← Componente raíz (tabs: Dashboard, BD_IMG, Carpetas, Scan, Logs)
├── components/
│   ├── GoogleAuthPanel.tsx           ← Conectar Google Sheets (OAuth2)
│   ├── DashboardCards.tsx            ← Cards con métricas (total, 🟢, 🔴, 🟡)
│   ├── BdImgTable.tsx                ← Tabla BD_IMG con colores, filtros, búsqueda
│   ├── FolderMgmt.tsx                ← Gestión de carpetas registradas (add/remove/toggle)
│   ├── ScannerPanel.tsx              ← Escaneo multi-carpeta con progreso
│   ├── SyncPanel.tsx                 ← Botones sync to/from + auto-sync toggle
│   └── LogsViewer.tsx               ← Historial de LOGS
│
electron/
├── google-sheets-service.js          ← OAuth2 + Sheets API v4 (CRUD)
├── google-drive-service.js           ← Drive API (list, scanNIS, scanAllFolders)
├── autoimg-sync-engine.js            ← Core: scanAllFolders → dedup → merge → write
└── autoimg-token-storage.js          ← Token persistente + refresh automático

backend/handlers/
├── autoimg.py                        ← IPC wrapper (delega a Electron services)
└── autoimg_sync.py                   ← Batch sync + rate limit handling

shared/
└── autoimg-schema.json               ← Definición de columnas de todas las hojas
```

---

## 📝 Anexos

### Glosario

| Término | Significado |
|---------|-------------|
| NIS | Número de Identificación del Suministro (SEDAPAL) — 7 dígitos |
| SGIO | Sistema de Gestión de Incidentes y Ordenes — ID interno ACCIONA |
| DESTINO | Carpeta donde debe ir la imagen (DVD XX, Maquina Balde, etc.) |
| Google Sheets | Tabla en la nube que funciona como base de datos |
| Compartidos | Carpeta de Google Drive compartida por terceros |
| Folder Registry | Hoja FOLDERS que lista todas las carpetas fuente activas |
| Deduplicación | Lógica para combinar el mismo NIS encontrado en múltiples carpetas |
| Sync Bidireccional | App escribe en Sheet · Sheet se refleja en app · Edits manuales se sincronizan |

### APIs Google utilizadas

| API | Uso | Límites |
|-----|-----|---------|
| Google Sheets API v4 | Leer/escribir datos del Sheet | 500 solicitudes/100s por proyecto |
| Google Drive API v3 | Listar archivos en Compartidos | 1000 solicitudes/100s por proyecto |
| Google OAuth2 | Autenticación del usuario | Tokens refresh ilimitados |

### Consideraciones técnicas

```yaml
Rate limits:
  Sheets API:   500 solicitudes / 100 segundos por proyecto
  Drive API:   1000 solicitudes / 100 segundos por proyecto

OAuth tokens:
  Access token:     Expira en 1 hora (refresh automático)
  Refresh token:    Ilimitado (si app verificado, sino 7 días)

Sheet:
  Límite de celdas:   10 millones de celdas por hoja
  Colaboradores:      Hasta 100 edits simultáneos

Estrategia de rate limit:
  - Exponential backoff (1s → 2s → 4s → 8s → max 60s)
  - Batch writes (max 10 filas por request)
  - Cache de fileIds de Drive para evitar re-listings

Multi-folder:
  - Máximo recomendado: 20 carpetas activas
  - Tiempo de scan: ~2s por carpeta + ~0.5s por cada 100 archivos
  - Dedup: suma por defecto, configurable a MAX
```

### Manejo de errores

| Escenario | Respuesta |
|-----------|-----------|
| Token expirado | Refresh automático (sin intervención del usuario) |
| Rate limit excedido | Backoff automático + notificación en UI |
| Folder ID inválido | Marcar carpeta como error en FOLDERS, continuar con las demás |
| Sin conexión a internet | Mostrar estado offline en UI, reintentar en próximo ciclo |
| Sheet modificado externamente | Detectar cambio en última fila/modificación, preguntar sync |

---

> **Documento actualizado:** Julio 2026  
> **Cambios respecto a v3:**
> 1. ✅ **Multi-carpeta**: soporte para N carpetas fuente en Drive Compartidos
> 2. ✅ **Hoja FOLDERS**: registro de carpetas activas con toggle activo/inactivo
> 3. ✅ **Deduplicación**: suma de NIS encontrados en múltiples carpetas
> 4. ✅ **Plan detallado**: tareas desglosadas con verificación por fase
> 5. ✅ **UI completa**: FolderMgmt + ScannerPanel con progreso por carpeta
> 6. ✅ **Eventos IPC**: progress, complete, error con payload completo
> **Próxima acción:** Crear proyecto en Google Cloud Console → Obtener OAuth2 credentials
