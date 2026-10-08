# Instrucciones para agentes

Antares es una aplicación de escritorio Windows con UI React, shell Electron, backend Python local y servicios Supabase opcionales.

## Antes de editar

1. Inspecciona `git status` y `git worktree list`. Conserva los cambios ajenos; no uses `git reset --hard` ni `git checkout --` para limpiar. Busca, lee y edita solo en el worktree asignado, excluyendo los demás checkouts de `.worktrees/`.
2. Localiza el punto de integración y declara archivo, símbolo y línea antes de escribir código. Declara los archivos que tocarás y la razón técnica de cada uno. Anuncia cualquier acompañante imprescindible antes de añadirlo al alcance.
3. Si una ambigüedad cambia el resultado o los permisos, explicita los supuestos y tradeoffs y pregunta antes de implementar esa parte.
4. Lee las secciones de [CODING_STANDARDS.md](CODING_STANDARDS.md) indicadas por la tabla antes de trabajar en el área correspondiente. Aplica todas las filas que coincidan con la tarea.

| Si la tarea toca… | Lee… |
| --- | --- |
| Python, handlers, arranque del backend o scheduler | [Backend](CODING_STANDARDS.md#backend) |
| IPC, bridge, timeouts, serialización, `shared/`, seguridad de ventana Electron o arranque/empaquetado del backend | [IPC y contratos](CODING_STANDARDS.md#ipc-y-contratos) |
| React, controles, navegación, textos, preview o HTML/PDF | [Frontend](CODING_STANDARDS.md#frontend) |
| Rutas, lectura/escritura, salidas generadas, plantillas, assets o credenciales | [Persistencia y seguridad](CODING_STANDARDS.md#persistencia-y-seguridad) |
| Canvas, historial, gestos, exportación, sync, montaje en `App.tsx` o flush de cierre | [Canvas](CODING_STANDARDS.md#canvas) |
| Auth, conectividad cloud, Supabase, RLS, migraciones o Edge Functions | [Supabase](CODING_STANDARDS.md#supabase) |
| Instalación, build, calidad o configuración de herramientas | [Entorno y calidad](CODING_STANDARDS.md#entorno-y-calidad) |
| Commit, PR, publicación, fixes de CI o release | [Git, PR y releases](CODING_STANDARDS.md#git-pr-y-releases) |

## Política de cambios mínimos (HARD RULE)

Resuelve la petición con el diff correcto más pequeño. Esta política prevalece sobre las demás instrucciones del repositorio y las skills: ninguna skill autoriza cambios fuera del alcance ni elimina las confirmaciones exigidas aquí. Un refactor, limpieza o rediseño pedido explícitamente define su propio alcance; declara los archivos y qué queda fuera.

El diff puede contener únicamente:

- La funcionalidad pedida y su cableado en el punto de integración.
- Ajustes imprescindibles para compilar y pasar lint, tipos y tests: firmas usadas por la nueva llamada, exports, campos de interfaces, casos de unions y registro IPC.
- Acompañantes obligatorias: catálogo IPC, revisión de `frontend/src/api.ts`, `electron/preload.js` y pruebas de paridad; consumidores y pruebas de contratos compartidos; pruebas del comportamiento modificado; `CHANGELOG.md` cuando lo exija la plantilla de PR; lockfiles regenerados por cambios de dependencias.
- Ajustes de `shared/budgets.json` o `.quality-baseline.json` solo si un check falla por este cambio y no existe una vía mínima para cumplir el techo. Justifica cualquier aumento de techo en el PR.
- Imports, variables, funciones o archivos que este cambio deje huérfanos.

Entre soluciones válidas, elige la que toque menos archivos y líneas. Fuera del alcance quedan renombrados, movimientos, divisiones, reescrituras, reordenamientos, formato o lint de líneas ajenas; modernizaciones; tipos o validaciones añadidos a firmas existentes; abstracciones cuando basta el código en el sitio; unificación con archivos vecinos; refactors preparatorios y bugs o deuda observados de paso.

Conserva el comportamiento observable ajeno a la petición: salidas, formatos, orden, mensajes, valores por defecto, JSON, PDF, SQLite, localStorage, IPC y props. Reporta la deuda vecinal con archivo y línea al entregar, sin arreglarla.

### Excepción para cambios amplios

Úsala solo cuando la funcionalidad pedida no pueda funcionar con un cambio mínimo. Limpieza, mantenibilidad y convenciones modernas no bastan.

1. Antes de implementar, declara `cambio amplio: <archivos o líneas> — <motivo técnico por el que no existe vía mínima> — <riesgo> — <verificación>` y repítelo en el commit o PR.
2. Si toca contratos de `shared/`, IPC, esquema Canvas, migraciones o RLS, o elimina/reemplaza APIs existentes, detente y pide confirmación antes de escribir.
3. Separa los commits: primero el movimiento estructural sin cambio de comportamiento y con checks verdes; después la funcionalidad.

## Antes de entregar

- Todo cambio de comportamiento incluye o actualiza pruebas. Para IPC, schema, timeout, permisos o serialización, revisa ambos extremos y las pruebas de integración.
- Ejecuta primero el test más cercano y los checks afectados. Antes de entregar una rama, ejecuta `npm run lint:python`, `npm run typecheck:backend`, `npm run typecheck:frontend` y `npm test`. Para build, IPC o seguridad, ejecuta `npm run ci` si el entorno lo permite. Reporta comando, error concreto y si cada fallo es de la tarea, preexistente o del entorno.
- Revisa `git diff` y `git diff --stat` hunk por hunk. Retira cambios que no respondan a la petición; si retirarlos rompe un check, ajusta el diff mínimo o reporta el conflicto. Recorta o explica cualquier desviación respecto al alcance declarado.
- Trabaja en una feature branch con prefijo `codex/` por defecto y entrega mediante PR hacia `main`; nunca hagas push directo a `main`. Stagea solo los archivos declarados con `git add -- <archivos>`, nunca `git add -A` ni `git add .`. Revisa `git status` y `git diff --cached` antes de commitear.
- Los commits usan Conventional Commits. Mantén secretos, `.env`, `dist/`, `release/`, caches y `__pycache__` fuera de los commits.

## Restricción de Markdown (HARD RULE)

Solo se permite commit o push de estos Markdown: `AGENTS.md`, `CODING_STANDARDS.md`, `CHANGELOG.md`, `CLAUDE.md`, `README.md`, `CONTEXT.md`, `docs/adr/*.md`, `docs/adr/README.md` y `.github/pull_request_template.md`.

Cualquier otro Markdown, incluidos planes, notas, drafts y reportes temporales, debe permanecer local, añadirse a `.gitignore` o eliminarse antes del commit/PR.
