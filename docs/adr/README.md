# Arquitectura de Antares

## Dependencias y fuentes de verdad

```text
React → api/core → preload → ipc-router → handlers Electron
                                         → JSON-RPC stdio → HandlerRegistry → handlers Python → core → stores
                                         → catálogo IPC compartido ← proyección Python
React Espacios / sincronización Canvas → cliente Supabase → RLS y RPC
```

| Área | Interfaz y dueño |
| --- | --- |
| UI y navegación | [App](../../frontend/src/App.tsx) monta vistas diferidas. [navigation](../../frontend/src/navigation.ts) define la navegación. [Primitivas UI](../../frontend/src/components/ui), [Tailwind](../../frontend/tailwind.config.js) y [tema base](../../shared/default-theme.json) son los puntos de extensión visual. React conserva el estado de edición y preferencias de presentación. |
| IPC y arranque | [Catálogo](../../shared/ipc-method-catalog.json) define métodos, lanes, timeouts, idempotencia y política de archivos. [Router](../../electron/ipc-router.js) protege la frontera renderer–main y [backend-spawner](../../electron/backend-spawner.js) gestiona el proceso. [main.py](../../backend/main.py) enruta al [registro lazy](../../backend/handlers/__init__.py) y al [scheduler](../../backend/core/scheduler.py). |
| Conversión, Renombrado, Formatos | [JobManager](../../backend/core/jobs.py) conserva estado de ejecución. [Converter](../../backend/core/converter.py), [Renamer](../../backend/core/renamer.py) y [Format Registry](../../backend/core/format_registry.py) aplican las reglas de cada dominio. [Repository](../../backend/core/repository.py) posee las conexiones del catálogo SQLite y [MigrationManager](../../backend/core/migrations.py) su evolución. |
| Reportes y documentos | Los modelos y plantillas por dominio preservan sus propios formatos. [ReportStore](../../backend/core/report_store.py) y [JsonDocumentStore](../../backend/core/json_store.py) gestionan persistencia de informes y fichas. [Tabular Report Import](../../backend/core/tabular_report_import.py) coordina el parsing común. [SpreadsheetResultBuilder](../../backend/core/spreadsheet_spill.py) gestiona resultados grandes de hojas. |
| Canvas | [Esquema](../../shared/canvas-schema.json), [store JSON](../../backend/core/canvas/store.py) e [historial en memoria](../../frontend/src/components/canvas/hooks/useCanvasHistory.ts). [Assets](../../electron/canvas-assets.js) poseen binarios. [Sincronizador](../../frontend/src/components/canvas/sync/canvasCloudSync.ts) replica por LWW. [Operaciones pendientes](../../frontend/src/components/canvas/sync/pendingCloudOperations.ts) conserva la intención local antes de cargar el sincronizador. |
| Design | El [esquema](../../shared/design-schema.json) y el store [Design](../../backend/core/design/store.py) poseen sus documentos. Sus modelos, renderizadores y recursos siguen flujos distintos a Canvas. |
| Agente | [Runtime Electron](../../electron/agent-runtime.js) coordina turnos, sesiones y notificaciones. [Estado compartido](../../electron/agent-shared.js) contiene mapas vivos de ejecución. [Backend agente](../../backend/core/agent) posee documentos, memoria y grants locales. Los catálogos `shared/agent-*.json` definen proyecciones interproceso y las herramientas se registran en `agent_tools.py`. |
| AutoIMG, conectores, Ubicaciones | [AutoIMG](../../electron/autoimg-sync-engine.js) coordina sincronización, [user-scope](../../electron/autoimg-user-scope.js) aísla identidades y [user-store](../../electron/autoimg-user-store.js) persiste configuración. [Sesiones de conectores](../../electron/connections-session.js) enlazan el estado Electron al [vault Python](../../backend/core/integrations/vault.py). [Ubicaciones](../../backend/core/ubicaciones) separa proveedor, composición y caché. |
| Autenticación y permisos | [AuthContext](../../frontend/src/auth/AuthContext.tsx) proyecta la sesión a React. [Persistencia de sesión](../../electron/supabase-session-handlers.js) pasa por Electron. [Supabase](../../supabase/migrations) posee el esquema, las políticas RLS y los RPC. [Política de archivos](../../electron/ipc-file-policy.js) y [grants](../../backend/core/agent/resource_grants.py) son controles independientes. |
| Configuración y telemetría | [Paths](../../backend/utils/paths.py) distingue recursos bundled de datos de usuario. [JsonConfigStore](../../backend/core/config_store.py) gestiona configuración local. [Contrato de observabilidad](../../shared/observability-contract.json), [Python](../../backend/core/observability.py) y [Electron](../../electron/app-log.js) definen y emiten eventos. stdout de Python transporta el protocolo. |
| Pruebas y entrega | [Mapa de verificación](../verification/README.md), [runner](../../scripts/run-test-suites.js), [CI](../../.github/workflows/ci.yml), [budgets](../../shared/budgets.json) y [empaquetado Windows](../../electron-builder.yml). |

## Auditoría de dependencias

En `bca2f8ca`, el análisis de código Python, JS y TS versionado registró 1.037 fuentes y 3.889 referencias locales. Incluyó imports de tipo, diferidos y dentro de funciones. Al limitar el grafo a imports de ejecución de nivel superior, no detectó ciclos. Al incluir los diferidos aparecieron cuatro grupos. La eliminación del ciclo de Canvas deja tres.

| Grupo | Evidencia y trabajo pendiente |
| --- | --- |
| Electron, 44 archivos | [Router](../../electron/ipc-router.js) entrega llamadas a conectores y al agente. Sus llamadas internas vuelven al router por `_callBackend`. Extraer el transporte exige caracterizar el handshake, las notificaciones y la política de reintentos. |
| Agente Python, 8 archivos | [agent.py](../../backend/core/agent/agent.py) y sus tools se resuelven entre sí en tiempo de llamada. Separar acceso a stores de registro de herramientas exige inventario de consumidores y pruebas de carga diferida. |
| Ubicaciones, 2 archivos | [cache.py](../../backend/core/ubicaciones/cache.py) importa funciones de [composer.py](../../backend/core/ubicaciones/composer.py), que llama al caché mediante imports diferidos. El corte propuesto deja composición pura por debajo de la orquestación. |
| Canvas, resuelto | El registro de operaciones pendientes quedó debajo de la entrada diferida y del sincronizador. [ADR](0006-ownership-of-local-state.md) |

La búsqueda por cuerpos Python idénticos detectó cuatro grupos. Se unificó el normalizador de diámetros. Los tres restantes son adaptadores CRUD de Informe Técnico e Informes V2 con stores y métodos IPC propios. Las pruebas conservan ambos contratos. El rastreo de referencias estáticas no cubre dispatch por cadenas, resolución dinámica de plugins, SQL ni recursos bundled. Los catálogos, migraciones, manifest y pruebas de paridad documentan esas rutas.

## Decisiones

- [0006. Dueños del estado local y adaptadores de entrada](0006-ownership-of-local-state.md)
- [0007. Políticas compartidas de reportes y CSV](0007-report-and-csv-policy.md)
