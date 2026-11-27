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
| Eval conductual del agente | `node scripts/agent-eval.js --provider <p> [--tasks id,...] [--dry-run]` | Ejercita un provider real con las credenciales del entorno y puntúa aserciones conductuales (planificación, evidencia, repeticiones); no corre en CI |

## Cobertura automatizada

| Área | Pruebas de referencia |
| --- | --- |
| Contratos IPC y catálogo | `tests/test_ipc_catalog.py`, `tests/test_ipc.py`, `tests/test_ipc_validation.py`, `tests/test_ipc_structured_errors.py`, `tests/test-electron-ipc-allowlist.js`, `tests/test_adversarial_ipc_stress.py` |
| Arranque y ciclo de vida del backend | `tests/test_backend_main.py`, `tests/test_backend_bootstrap.py`, `tests/test_handler_registry_lazy.py`, la familia `tests/test-backend-spawner-*.js` |
| Ventana, CSP y política de archivos | `tests/test-window-manager-permissions.js`, `tests/test-window-manager-csp.js`, `tests/test-path-allowlist.js`, `tests/test-file-staging.js`, `tests/test-ipc-write-read-path-blocklist.js` |
| Agente: grants, tools y aceptación | `tests/test_agent_acceptance_inventory.py`, `tests/test_agent_resource_grants.py`, `tests/test_agent_skills.py` (reutilización de YAML y edición o borrado de manifests), `tests/test_approval_guard.py`, la familia `tests/test_agent_*.py` y `tests/test-agent-*.js` |
| Agente: preguntas en el chat | `frontend/src/components/agent/AgentView.test.tsx` cubre ubicación, selección por clic y teclado, texto libre, recuperación de errores e historial. `ArtifactCard.test.tsx` comprueba que las letras de la respuesta libre y los atajos con modificadores no activan las opciones |
| Agente: actividad de la conversación | `frontend/src/components/agent/AgentTimeline.test.tsx` comprueba que el avance precede a la actividad, que los pasos se pueden abrir y volver a cerrar y que el avance aparece una sola vez |
| Agente: configuración del perfil | `tests/vitest/agent-profiles.test.js` cubre cambios de alcance de memoria con reversa y reinicio, cancelación de rutinas tras borrar el agente de origen o destino, recuperación de rutinas huérfanas y presentación portable. `tests/test-agent-runtime.js` comprueba que la presentación de un perfil guardado se retoma hasta la confirmación |
| Agente: modo de permisos | `tests/test-ipc-destructive-gates.js` comprueba el cambio directo a Acceso completo y el regreso a Solicitar aprobación. También cubre la confirmación al elevar a Aprobar por mí y al guardar reglas globales que permiten acciones |
| Agente y razonamiento en el chat | `frontend/src/components/agent/AgentView.test.tsx` alterna entre Agentes y Conversaciones en la misma sesión y comprueba la restauración del último acceso. `frontend/src/components/agent/AgentTimeline.test.tsx` verifica que las trazas y notas ocultas no generen filas de actividad, que siga visible el indicador en vivo y que el plan compacto se expanda bajo demanda |
| Carga del historial de conversaciones | `frontend/src/components/agent/AgentView.test.tsx` restaura el historial con proveedores pendientes, cambia de chat con una lectura anterior en curso y comprueba el estado de carga, el descarte de la respuesta tardía y la actualización del historial al volver |
| Agente: encargos con handoff humano | `tests/test-agent-scheduler.js` cubre una pregunta estructurada con `task_report`, la transición `needs_input`→`agent_tasks_respond`→`to_verify`→`agent_tasks_verify`→`delivered` (idempotente), el formato textual anterior, la re-ejecución tras un bloqueo y la continuidad de la cola. `tests/test-agent-tasks.js` verifica el estado `delivered` tras reinicio |
| Agente: encargos dirigidos a otro agente | `tests/test-agent-tasks.js` cubre resolución del destino, un aviso por conversación con el mismo ID, encadenamiento por `task_completed` y permisos del destino. `frontend/src/components/agent/AgentView.test.tsx` comprueba el estado visible y la navegación de ida y vuelta |
| Agente: pasos asignados y evidencia | `tests/test-agent-shared-plan.js` cubre la asignación por ID, el paso ya terminado, el duplicado activo y la evidencia del delegado tras reiniciar, con rechazo de referencias ajenas. `frontend/src/components/agent/AgentView.test.tsx` verifica que el visor abre los archivos con la sesión del plan |
| Agente: memoria compartida y prueba de procedimientos | `tests/test_agent_memory_search.py` comprueba destinatarios, alcance, revocación y revisión de nuevas versiones. `tests/test_ipc_ingress_schema.py` y `tests/test-electron-ipc-allowlist.js` comprueban la frontera IPC. `tests/test-agent-scheduler.js` comprueba que el ensayo admite lecturas, bloquea efectos y habilita programar tras verificar |
| Agente: navegador y computer-use | `tests/test-agent-browser-*.js` (aislamiento entre conversaciones, destino aprobado de descarga, navegación, cancelación y prioridad de controles visibles), `tests/test_computer_use_guard.py`, `tests/test_computer_use_policy.py` |
| Design del Agente | `tests/test_agent_design_canvas.py` verifica la reapertura de ajustes y revisiones y el rechazo de guardados obsoletos. `AgentTimeline.test.tsx` verifica el guardado explícito desde el iframe autorizado. `tests/test-agent-pages-real.js` verifica los enlaces con ratón en Electron con `ANTARES_PAGES_REAL=1`. |
| Reportes → Design | `tests/test_design_reliability.py` cubre la persistencia de cifras y citas y la recuperación ante una corrección inválida. `DesignApp.test.tsx` comprueba lo que muestra el iframe al cambiar de diapositiva y la aplicación de la casilla Notas a la exportación. |
| Agente: panel de agentes y conversaciones | `frontend/src/components/agent/AgentView.test.tsx`: comprueba que las secciones tienen áreas de desplazamiento independientes y comparten el buscador, reabre el historial desde la tarjeta fijada y el selector compacto, limita a una la primera creación simultánea y verifica la acción explícita para iniciar otra. Comprueba que el campo de escritura precede a los controles en el orden de foco, que el modelo y el envío son visibles y que las opciones se abren y cierran con retorno de foco |
| Agente: detener un turno | `frontend/src/components/agent/AgentView.test.tsx` comprueba que Detener está en la barra, que Enviar vuelve al cancelar sin mostrar Reanudar y que los mensajes en cola quedan pendientes de envío explícito |
| Agente: borradores | `frontend/src/components/agent/AgentView.test.tsx` alterna entre conversaciones, comprueba un selector de archivos que termina tarde y verifica que al reabrir solo se restaura texto |
| Agente: historial y streaming | `tests/test-agent-projection.js` comprueba límites y orden de páginas, búsqueda de texto, saltos al origen y que un cambio estructural dentro del debounce exige recarga. `AgentView.test.tsx` aplica actualizaciones consecutivas sin pedir otro snapshot, recupera revisiones perdidas y navega desde búsqueda y entregables. Las pruebas automatizadas no miden latencia de IPC ni FPS |
| Agente: fuentes y tablas Markdown | `MessageMarkdown.test.tsx` cubre referencias al completar el destino, protocolos, énfasis anidado, cercas durante streaming y ampliación de tablas |
| Agente: edición de mensajes y encargos por atender | `AgentView.test.tsx` cubre pausa, reordenación, cancelar y guardar edición y reanudación. `AgentAttentionInbox.test.tsx` comprueba decisiones para dos agentes y el salto a la solicitud |
| Agente: menciones en el compositor | `frontend/src/components/agent/AgentView.test.tsx` comprueba la selección por teclado y clic, el avatar y el nombre en el borrador, la eliminación, la reapertura del borrador y el envío al perfil elegido incluso con nombres repetidos. |
| Canvas | `tests/test_canvas.py` (índice en reposo y detección de cambios externos), `tests/test_canvas_schema_parity.py`, `tests/test_canvas_ipc_e2e.py`, `tests/test-canvas-assets.js` y las suites Vitest de `frontend/src/components/canvas/`. `Artboard.drag.test.tsx` comprueba que el recuadro de selección se actualiza sin commits de React durante el arrastre, selecciona con la posición de soltado y se cancela con Escape. |
| Persistencia y migraciones | `tests/test_json_store_migration.py`, `tests/test_history_migrations.py`, `tests/test_database.py`, `tests/test_dev_persistence_isolation.py` |
| Dominios de reportes y conversión | las familias `tests/test_technical_reports_*.py`, `tests/test_informes_v2_*.py`, `tests/test_conversion_*.py`, `tests/test_renamer*.py` |
| Descarga de Padrones | `frontend/src/components/padron/PadronView.test.tsx` comprueba que cada hoja recibe un alias de imagen único, incluso al pasar al siguiente lote. La prueba simula la captura JPEG y jsPDF. |
| Direcciones de dependencia | `tests/test_spreadsheet_layering.py` controla imports de sintaxis desde core y utils hacia el handler de hojas. `tests/test-canvas-cloud-layering.js` controla imports directos entre el registro, la entrada diferida y el sincronizador de Canvas. Ambos comprueban casos permitidos y prohibidos. |
| Compatibilidad de filas y colas | `tests/test_spreadsheet_parse.py` cubre la precedencia de delimitadores y el corte de UTF-8 en el límite del muestreo. Las pruebas de modelos y paridad de reportes cubren coerción, orden y formatos antiguos. `canvasCloudSync.test.ts` cubre intención de push antes de cargar el runtime y reproducción de borrados después de reiniciar la cola. |
| Pipeline de PR, release y calidad | `tests/test-push-loop.js`, `tests/test-release-loop.js`, `tests/test-review-policy.js`, `tests/test-quality-ratchet.js`, `tests/test-changelog-fragments.js` |
| Empaquetado del backend | `tests/test_lazy_handlers_packaged.py`, `scripts/verify-frozen-backend.js`, `scripts/verify-backend-manifest.js` |

## Límites declarados

Nada de esto tiene cobertura automatizada hoy; verificar un cambio en estas áreas es manual y se reporta como tal:

- **El instalador de Windows de principio a fin**: instalación NSIS en una máquina limpia, updater firmado aplicando una release real y arranque de la build empaquetada con el store del usuario.
- **La calidad de las respuestas del modelo**: `scripts/agent-eval.js` puntúa aserciones conductuales contra un provider real (crear plan en trabajo multi-paso, evidencia en pasos `done`, no repetir llamadas idénticas), pero no corre en CI ni cubre la corrección semántica del contenido.
- **Supabase real**: RLS contra un proyecto vivo, Realtime y Edge Functions desplegadas; solo hay contratos locales (`tests/test_supabase_edge_cors.py`, `test_supabase_schema_audit.py`).
- **Google OAuth y Drive reales**: el flujo de consentimiento y la sincronización contra la API viva se prueban con fakes (`tests/test-autoimg-*.js`).
- **El shell Electron real**: los tests de `electron/` ejercitan los módulos contra fakes de procesos y ventanas, no una instancia Electron viva; el recorrido visual de la UI se verifica a mano (la skill `smoke`, si está instalada, describe el formato).
- **Computer-use sobre el escritorio real**: política y guardas tienen tests, pero el control efectivo de pantalla, ratón y teclado no.

## Extender el mapa

- Un comportamiento nuevo entra en la tabla de cobertura citando la prueba que lo protege; si la prueba no existe, el cambio la trae consigo.
- Una entrada solo sale de los límites cuando existe la automatización que lo cubre de verdad; moverla antes es borrar la señal de riesgo que el mapa da.
