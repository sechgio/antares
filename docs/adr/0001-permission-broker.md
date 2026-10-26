# 0001. Broker de permisos por canal

- Fecha: 2026-10-25
- Estado: aceptado
- Personas: sechgio

## Contexto

El agente ya pedía aprobación por llamada, pero las decisiones dependían del
criterio del momento y no existía una política persistente por tipo de efecto.
Tampoco había una forma segura de deshacer un efecto local. A la vez, el
terminal debía conservar su excepción: nunca se auto-permite, ni siquiera en
Acceso completo.

## Decisión

Usamos un broker único para los efectos del agente:

- La tarjeta pendiente decide con Permitir o Rechazar una sola llamada.
- Tras ejecutarse, el paso de herramienta deja un recibo persistente con canal,
  fuente de la decisión (`manual`, `rule`, `full` o `cancel`) y, si existe,
  Deshacer.
- Las reglas se evalúan por canal: Terminal, Archivos, Escritorio y navegador,
  Nube y conexiones, MCP, Documentos, Memoria, Agenda y Otros. Hay reglas
  globales y reglas por conversación; la conversación tiene prioridad.
- Terminal y Otros nunca admiten `allow`. El resto admite `ask`, `allow` y
  `deny`.
- `task_schedule`, `memory_remember` y `procedure_learn` son efectos y pasan
  por el broker. `tools_load` y `agent_delegate` siguen siendo operaciones de
  control o lectura y no se gatean.
- Undo solo se ofrece para efectos locales verificables por hash:
  `fs_write`, `fs_edit` y `drafts_save`. El resto se etiqueta «No reversible».
- Cada cambio de regla se registra en un historial de auditoría acotado.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
| --- | --- |
| Un único modo global para todo | No distingue un comando de terminal de una lectura o de una subida a Drive; obliga a elegir entre fricción y riesgo. |
| Reglas solo por conversación | Sirve para un encargo, pero no para una política estable entre chats. Se mantienen ambas con prioridad de sesión. |
| Undo para shell, escritorio o nube | No existe un rollback general y borrar o revertir remoto puede ser más peligroso que no deshacer. |
| Permitir en «Otros» | Es la bolsa de efectos no clasificados; un allow en bloque amplía demasiado la superficie. |

## Consecuencias

- El modo `ask/auto/full` conserva su comportamiento cuando no hay reglas.
- La aprobación manual de una regla rápida guarda primero la regla y solo
  después decide la llamada; si el guardado falla, no se decide.
- Las reglas se evalúan antes de crear la aprobación en Electron. La ruta
  backend `agent_internal_dispatch` registra dispatch, recibo y Undo, pero no
  consulta reglas porque el estado de política vive en Electron.
- Las acciones remotas y los envíos no tienen Undo real; la interfaz lo dice
  explícitamente.
- El terminal sigue pidiendo aprobación incluso con `full` o con una regla
  permisiva.
- La verificación se concentra en `tests/test_agent_undo.py`,
  `tests/test_agent_internal.py`, `tests/test-agent-channels.js`,
  `tests/test-agent-broker.js`, `tests/test-agent-runtime.js`,
  `frontend/src/components/agent/AgentView.test.tsx` y
  `frontend/src/components/agent/AgentTimeline.test.tsx`.
