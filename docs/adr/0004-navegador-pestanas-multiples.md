# 0004. Navegador del agente con pestañas múltiples

- Fecha: 2026-10-27
- Estado: aceptado
- Personas: sechgio

## Contexto

El ADR 0002 fijó dos pestañas, «Agente» y «Tú». Con una sola pestaña propia el
usuario no puede consultar varias páginas a la vez mientras el agente trabaja,
y el panel no se parecía al de Claude Desktop, que es la referencia de la UI.
Claude Desktop (3.1623, `PreviewContext` del bundle) usa una `WebContentsView`
por pestaña con la misma sesión, identificadores `tab-N`, un tope de pestañas y,
al cerrar la visible, activa la de la derecha o, si no hay, la de la izquierda.

## Decisión

Mantenemos la pestaña «Agente» fija y permitimos que el usuario abra y cierre
hasta ocho pestañas propias (`tab-N`, más la inicial `user`), cada una con su
`WebContentsView` y la misma sesión. El panel adopta la disposición de Claude
Desktop: tira de pestañas con «+», menú de opciones, expandir y cerrar; debajo,
atrás, adelante, recargar y la barra de URL.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
| --- | --- |
| Seguir con dos pestañas fijas | No permite consultar varias páginas a la vez. |
| Pestañas sin tope | Cada vista es un renderer completo; sin tope crecen la memoria y el coste de reparentar. |
| Que el agente use cualquier pestaña | Rompe la separación usuario/agente del ADR 0002 y el lease por conversación. |
| Particiones de sesión por pestaña | Obliga a iniciar sesión en cada pestaña; se conserva la sesión compartida. |

## Consecuencias

- Las herramientas `web_*` siguen operando solo en la pestaña «Agente», que no
  se puede cerrar; las pestañas del usuario no tienen lease ni gracia de entrada
  para el agente.
- El canal `agent_browser` añade las acciones `new` y `close`; `tab` acepta
  cualquier identificador abierto. Cerrar el navegador restaura las pestañas
  iniciales.
- Las pestañas del usuario no se persisten entre reinicios.

## Verificación

- `tests/test-agent-browser-tabs.js`: crear, cambiar, cerrar con vecina, tope de
  ocho, la pestaña del agente no se cierra y `close()` restaura el estado.
- `frontend/src/components/agent/AgentBrowserPanel.test.tsx`: tira de pestañas,
  «+», cierre, tope, menú de opciones y estado vacío «Explorar la web».
