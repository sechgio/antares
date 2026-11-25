# Verificación de Antares

Qué superficies automatizadas existen, qué cubren y —con la misma importancia— qué no cubren. La disciplina general está en «Higiene de verificación» de [AGENTS.md](../../AGENTS.md); este archivo es el mapa. Al añadir comportamiento verificable, extiende la cobertura en el cambio mismo; lo que siga sin ella se declara en la sección de límites.

## Doctrina

- La verificación corre contra fixtures aislados, nunca contra el store real del usuario ni contra la app que el usuario tiene viva. `tests/conftest.py` redirige `LOCALAPPDATA`/`XDG_DATA_HOME` a un temporal por proceso antes de que el backend calcule sus rutas, y los subprocesos lo heredan; los tests de Electron falsifican procesos y módulos con `tests/helpers/harness.js`. Un test que necesita el store o la instancia viva del usuario está mal planteado.
- Lo que no se puede verificar se declara. «No pude verificar X en Y» cierra una tarea mejor que una afirmación sin evidencia.

## Superficies y comandos

| Superficie | Comando canónico | Notas |
| --- | --- | --- |
| Suite completa | `bun run test` | Definida en `scripts/run-test-suites.js`: contratos, backend, Electron y frontend |
| Backend pytest | `uv run --locked --extra dev python -m pytest ../tests/test_<x>.py` desde `backend/` | `python -m pytest` y no el launcher `pytest.exe`: en algunos entornos Windows el launcher no puede escribir en `%LOCALAPPDATA%\Temp` y `gettempdir()` cae al cwd, contaminando `backend/` |
| Test Node de shell/scripts | `node tests/test-<x>.js` | Cada archivo es autocontenido, usa `tests/helpers/harness.js` y sale con código no-cero al fallar |
| Frontend Vitest | `bun run test` en `frontend/` | Higiene de la suite en [AGENTS.md](../../AGENTS.md#limpieza-en-pruebas-frontend-vitest) |
| Eval conductual del agente | `node scripts/agent-eval.js --provider <p> [--tasks id,...] [--dry-run]` | Ejercita un provider real con las credenciales del entorno; no corre en CI |

## Cobertura automatizada

| Área | Pruebas de referencia |
| --- | --- |
| Contratos IPC y catálogo | `tests/test_ipc_catalog.py`, `tests/test_ipc.py`, `tests/test_ipc_validation.py`, `tests/test_ipc_structured_errors.py`, `tests/test-electron-ipc-allowlist.js`, `tests/test_adversarial_ipc_stress.py` |
| Arranque y ciclo de vida del backend | `tests/test_backend_main.py`, `tests/test_backend_bootstrap.py`, `tests/test_handler_registry_lazy.py`, la familia `tests/test-backend-spawner-*.js` |
| Ventana, CSP y política de archivos | `tests/test-window-manager-permissions.js`, `tests/test-window-manager-csp.js`, `tests/test-path-allowlist.js`, `tests/test-file-staging.js`, `tests/test-ipc-write-read-path-blocklist.js` |
| Agente: grants, tools y aceptación | `tests/test_agent_acceptance_inventory.py`, `tests/test_agent_resource_grants.py`, `tests/test_agent_skills.py`, `tests/test_approval_guard.py`, la familia `tests/test_agent_*.py` y `tests/test-agent-*.js` |
| Agente: navegador y computer-use | `tests/test-agent-browser-*.js`, `tests/test_computer_use_guard.py`, `tests/test_computer_use_policy.py` |
| Canvas | `tests/test_canvas.py`, `tests/test_canvas_schema_parity.py`, `tests/test_canvas_ipc_e2e.py`, `tests/test-canvas-assets.js` y las suites Vitest de `frontend/src/components/canvas/` |
| Persistencia y migraciones | `tests/test_json_store_migration.py`, `tests/test_history_migrations.py`, `tests/test_database.py`, `tests/test_dev_persistence_isolation.py` |
| Dominios de reportes y conversión | las familias `tests/test_technical_reports_*.py`, `tests/test_informes_v2_*.py`, `tests/test_conversion_*.py`, `tests/test_renamer*.py` |
| Pipeline de PR, release y calidad | `tests/test-push-loop.js`, `tests/test-release-loop.js`, `tests/test-review-policy.js`, `tests/test-quality-ratchet.js`, `tests/test-changelog-fragments.js` |
| Empaquetado del backend | `tests/test_lazy_handlers_packaged.py`, `tests/test_editor_packaged.py`, `scripts/verify-frozen-backend.js`, `scripts/verify-backend-manifest.js` |

## Límites declarados

Nada de esto tiene cobertura automatizada hoy; verificar un cambio en estas áreas es manual y se reporta como tal:

- **El instalador de Windows de principio a fin**: instalación NSIS en una máquina limpia, updater firmado aplicando una release real y arranque de la build empaquetada con el store del usuario.
- **La calidad de las respuestas del modelo**: `scripts/agent-eval.js` muestrea comportamiento contra un provider real, pero no hay aserciones de calidad ni cobertura en CI.
- **Supabase real**: RLS contra un proyecto vivo, Realtime y Edge Functions desplegadas; solo hay contratos locales (`tests/test_supabase_edge_cors.py`, `test_supabase_schema_audit.py`).
- **Google OAuth y Drive reales**: el flujo de consentimiento y la sincronización contra la API viva se prueban con fakes (`tests/test-autoimg-*.js`).
- **El shell Electron real**: los tests de `electron/` ejercitan los módulos contra fakes de procesos y ventanas, no una instancia Electron viva; el recorrido visual de la UI se verifica a mano (la skill `smoke`, si está instalada, describe el formato).
- **Computer-use sobre el escritorio real**: política y guardas tienen tests, pero el control efectivo de pantalla, ratón y teclado no.

## Extender el mapa

- Un comportamiento nuevo entra en la tabla de cobertura citando la prueba que lo protege; si la prueba no existe, el cambio la trae consigo.
- Una entrada solo sale de los límites cuando existe la automatización que lo cubre de verdad; moverla antes es borrar la señal de riesgo que el mapa da.
