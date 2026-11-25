# Instrucciones para agentes

Antares es una aplicación de escritorio Windows con UI React, shell Electron, backend Python local y servicios Supabase opcionales.

## Reglas innegociables y defaults

Las reglas **innegociables** protegen los datos del usuario, los contratos publicados y la seguridad. Solo cambian por decisión explícita del desarrollador, y la decisión queda anotada aquí con su fecha:

- **Los datos del usuario sobreviven a cada actualización.** El catálogo SQLite, los documentos Canvas con su historial, las plantillas del usuario y el estado en disco conviven con cada versión nueva de la app sin pérdida. Toda migración conserva cada esquema origen publicado; nunca asumas que existe una copia de seguridad. El updater firmado instala cada release sin intervención del usuario: una release que pierde datos no tiene deshacer.
- **Los contratos compartidos no cambian de significado.** `shared/ipc-method-catalog.json`, `shared/canvas-schema.json` y las respuestas IPC conservan su semántica para las builds ya instaladas; una evolución añade campos opcionales o métodos nuevos, no reinterpreta los existentes.
- **La frontera renderer–main se mantiene:** `contextIsolation`, `nodeIntegration: false`, sandbox, CSP, validación del sender, allowlist de métodos IPC, política de archivos y sus pruebas.
- **RLS y least privilege en Supabase.** Un problema de permisos nunca se resuelve exponiendo tablas o funciones privilegiadas al cliente.
- **Los secretos no entran al repo, a la UI ni a los logs.** Credenciales, `.env` y service-role keys permanecen fuera del renderer, de los commits y de cualquier exportación de diagnóstico.

Todas las demás reglas de este archivo y de `CODING_STANDARDS.md` son **defaults**: sigue la preferencia del desarrollador cuando la declare para la tarea, y di qué default dejaste de lado. No argumentes citando este archivo.

## Antes de editar

1. Inspecciona `git status` y `git worktree list`. Conserva los cambios ajenos; no uses `git reset --hard` ni `git checkout --` para limpiar. Busca, lee y edita solo en el worktree asignado, excluyendo los demás checkouts de `.worktrees/`.
2. Localiza el punto de integración y declara archivo, símbolo y línea antes de escribir código. Declara los archivos que tocarás y la razón técnica de cada uno. Anuncia cualquier acompañante imprescindible antes de añadirlo al alcance.
3. Si una ambigüedad cambia el resultado o los permisos, explicita los supuestos y tradeoffs y pregunta antes de implementar esa parte.
4. Lee las secciones de [CODING_STANDARDS.md](CODING_STANDARDS.md) indicadas por la tabla antes de trabajar en el área correspondiente. Aplica todas las filas que coincidan con la tarea.
5. Consulta [CONTEXT.md](CONTEXT.md) al nombrar un tipo, tabla, método IPC, clave o texto de producto nuevo, y cuando un término del código difiera de la UI. Usa el vocabulario canónico en código, tests y PRs; evita los sinónimos marcados como _Avoid_.
6. En trabajo de más de unos pocos pasos, lleva la checklist en `TASKS.md` en la raíz del worktree (git lo ignora): marca cada item al completarlo y añade los que descubras. El archivo sigue disponible después de que el contexto se compacte.

| Si la tarea toca… | Lee… |
| --- | --- |
| Python, handlers, arranque del backend o scheduler | [Backend](CODING_STANDARDS.md#backend) |
| IPC, bridge, timeouts, serialización, `shared/`, seguridad de ventana Electron o arranque/empaquetado del backend | [IPC y contratos](CODING_STANDARDS.md#ipc-y-contratos) |
| React, controles, navegación, textos, preview o HTML/PDF | [Frontend](CODING_STANDARDS.md#frontend) |
| Rutas, lectura/escritura, salidas generadas, plantillas, assets o credenciales | [Persistencia y seguridad](CODING_STANDARDS.md#persistencia-y-seguridad) |
| Canvas, historial, gestos, exportación, sync, montaje en `App.tsx` o flush de cierre | [Canvas](CODING_STANDARDS.md#canvas) |
| Agente del producto: herramientas, skills, memoria, permisos, navegador, computer-use, delegación o `shared/agent-*.json` | [Agente](CODING_STANDARDS.md#agente) |
| Auth, conectividad cloud, Supabase, RLS, migraciones o Edge Functions | [Supabase](CODING_STANDARDS.md#supabase) |
| Instalación, build, calidad o configuración de herramientas | [Entorno y calidad](CODING_STANDARDS.md#entorno-y-calidad) |
| Pruebas pytest, harness de Node o aislamiento del store de usuario en tests | [Pruebas](CODING_STANDARDS.md#pruebas) |
| Commit, PR, publicación, fixes de CI o release | [Git, PR y releases](CODING_STANDARDS.md#git-pr-y-releases) |

## Política de cambios mínimos (HARD RULE)

Resuelve la petición con el diff correcto más pequeño. Esta política prevalece sobre las demás instrucciones del repositorio y las skills: ninguna skill autoriza cambios fuera del alcance ni elimina las confirmaciones exigidas aquí. Un refactor, limpieza o rediseño pedido explícitamente define su propio alcance; declara los archivos y qué queda fuera.

El diff puede contener únicamente:

- La funcionalidad pedida y su cableado en el punto de integración.
- Ajustes imprescindibles para compilar y pasar lint, tipos y tests: firmas usadas por la nueva llamada, exports, campos de interfaces, casos de unions y registro IPC.
- Acompañantes obligatorias: catálogo IPC, revisión de `frontend/src/api.ts`, `electron/preload.js` y pruebas de paridad; consumidores y pruebas de contratos compartidos; pruebas del comportamiento modificado; `changelog.d/<rama>.md` cuando lo exija la plantilla de PR; lockfiles regenerados por cambios de dependencias.
- Ajustes de `shared/budgets.json` o `.quality-baseline.json` solo si un check falla por este cambio y no existe una vía mínima para cumplir el techo. Justifica cualquier aumento de techo en el PR.
- Imports, variables, funciones o archivos que este cambio deje huérfanos.

Entre soluciones válidas, elige la que toque menos archivos y líneas. Fuera del alcance quedan renombrados, movimientos, divisiones, reescrituras, reordenamientos, formato o lint de líneas ajenas; modernizaciones; tipos o validaciones añadidos a firmas existentes; abstracciones cuando basta el código en el sitio; unificación con archivos vecinos; refactors preparatorios y bugs o deuda observados de paso.

Conserva el comportamiento observable ajeno a la petición: salidas, formatos, orden, mensajes, valores por defecto, JSON, PDF, SQLite, localStorage, IPC y props. Reporta la deuda vecinal con archivo y línea al entregar, sin arreglarla.

### Excepción para cambios amplios

Úsala solo cuando la funcionalidad pedida no pueda funcionar con un cambio mínimo. Limpieza, mantenibilidad y convenciones modernas no bastan.

1. Antes de implementar, declara `cambio amplio: <archivos o líneas> — <motivo técnico por el que no existe vía mínima> — <riesgo> — <verificación>` y repítelo en el commit o PR.
2. Si toca contratos de `shared/`, IPC, esquema Canvas, migraciones o RLS, o elimina/reemplaza APIs existentes, detente y pide confirmación antes de escribir.
3. Separa los commits: primero el movimiento estructural sin cambio de comportamiento y con checks verdes; después la funcionalidad.

Para diffs de más de 400 líneas efectivas, `cambio amplio:` o la etiqueta `size/exempt` declara el alcance ante `review-policy`. El control de tamaño bloquea desde 2000 líneas efectivas. La etiqueta `size/exempt` convierte ese bloqueo en un aviso.

## Antes de entregar

- Todo cambio de comportamiento incluye o actualiza pruebas. Para IPC, schema, timeout, permisos o serialización, revisa ambos extremos y las pruebas de integración.
- Ejecuta primero el test más cercano y los checks afectados. Antes de entregar una rama, ejecuta `bun run lint:python`, `bun run typecheck:backend`, `bun run typecheck:frontend` y `bun run test`. Para build, IPC o seguridad, ejecuta `bun run ci` si el entorno lo permite. Reporta comando, error concreto y si cada fallo es de la tarea, preexistente o del entorno.
- Revisa `git diff` y `git diff --stat` hunk por hunk. Retira cambios que no respondan a la petición; si retirarlos rompe un check, ajusta el diff mínimo o reporta el conflicto. Recorta o explica cualquier desviación respecto al alcance declarado.
- Trabaja en una feature branch con prefijo `feat/` por defecto y entrega mediante PR hacia `main`; nunca hagas push directo a `main`. Stagea solo los archivos declarados con `git add -- <archivos>`, nunca `git add -A` ni `git add .`. Revisa `git status` y `git diff --cached` antes de commitear.
- Los commits usan Conventional Commits. Mantén secretos, `.env`, `dist/`, `release/`, caches y `__pycache__` fuera de los commits.

## Higiene de verificación

- Marca cada afirmación que no pudiste confirmar y di dónde buscaste. «No pude verificar X en Y» es un resultado válido; afirmarlo sin evidencia no.
- Un comando de comprobación sin salida significa tanto «limpio» como «pregunta mal formulada». Antes de confiar en un silencio (grep sin coincidencias, lint sin avisos, lista vacía, test que «pasa» sin assertions), prueba que el comando todavía habla: ejecútalo sobre un caso que sabes que produce un hit, o confirma que una lista que esperas larga no sale vacía.
- Comprueba las acciones reversas de cada cambio de estado: activar/desactivar, pausar/reanudar, revocar/reconectar, silenciar/reactivar, bloquear/desbloquear. Si el cambio toca estado persistido, incluye un reinicio de la app en la verificación.
- Para un cambio de comportamiento visible, verifica en la app real además de en tests: arranca con `bun run dev:app` (o `bun run preview:unpacked` para el flujo empaquetado) y recorre el camino del usuario con su acción reversa. La skill `smoke`, si está instalada, describe el formato del plan y del reporte.
- Debilitar una prueba de la que depende una comprobación es en sí mismo un riesgo: si un diff toca tests de paridad, de migraciones o de seguridad, revisa esos hunks con el mismo cuidado que el código que protegen.
- La cobertura automatizada y sus límites declarados se mapean en [docs/verification/README.md](docs/verification/README.md): al añadir comportamiento verificable extiende la cobertura, y lo que siga sin ella se declara allí.

## Procesos locales

- Nunca mates procesos por patrón (`taskkill //IM electron`, `taskkill //IM node`, `pkill -f`, `Stop-Process -Name electron`): `electron.exe` y `node.exe` los usan también otras aplicaciones del usuario y otros worktrees. Detén solo PIDs que tú iniciaste, o pregunta.
- Reutiliza una instancia de desarrollo viva antes de arrancar otra, y al terminar detén solo las instancias que tú arrancaste.

## Limpieza en pruebas frontend (Vitest)

La suite corre con `isolate: false`, orden aleatorio (`shuffle`) y `mockReset: true`: el estado compartido debe quedar como estaba al terminar cada archivo y cada test.

- Declara las impls por defecto en la fábrica `vi.fn(impl)`; `mockReset` borra las impls encadenadas con `.mockReturnValue()`/`.mockResolvedValue()`.
- Restablece en `beforeEach` el estado mutable de `vi.hoisted`; `vi.clearAllMocks()` limpia llamadas pero no restaura implementaciones.
- Captura todos los listeners de `onNotify` en un array y despacha en fan-out: componentes lazy (p. ej. el tab por defecto) pueden suscribirse entre dos notificaciones y una captura de "último gana" se traga eventos.
- Precarga con `await import` los módulos mockeados que la app importa dinámicamente antes de disparar el flujo; importaciones concurrentes de un módulo cuya fábrica mock sigue evaluándose pueden resolver el módulo real.
- No asignes stubs directos a prototipos DOM (`Element`/`HTMLElement.prototype`) ni a métricas de `window` sin restaurar el descriptor original; `test-setup` repone los baselines al cerrar cada archivo.
- Espera efectos observables con `waitFor` en vez de asumir que el handler terminó: `onNotify` no propaga la promesa del callback.

## Restricción de Markdown (HARD RULE)

Solo se permite commit o push de estos Markdown: `AGENTS.md`, `CODING_STANDARDS.md`, `CHANGELOG.md`, `CLAUDE.md`, `README.md`, `CONTEXT.md`, `changelog.d/*.md`, `docs/adr/*.md`, `docs/adr/README.md`, `docs/verification/*.md` y `.github/pull_request_template.md`.

Cualquier otro Markdown, incluidos planes, notas, drafts y reportes temporales, debe permanecer local, añadirse a `.gitignore` o eliminarse antes del commit/PR.
