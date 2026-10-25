# 0001. Navegador del agente con dos pestañas

- Fecha: 2026-10-25
- Estado: aceptado
- Personas: sechgio

## Contexto

El navegador aislado del Agent era una única `WebContentsView` compartida por el
agente y el usuario. Cualquier clic, rueda o tecla del usuario bloqueaba las
navegaciones del agente durante una gracia de cinco segundos; si el usuario
seguía leyendo, el agente no podía abrir otra página. El freno de repeticiones
del harness convertía esos fallos transitorios en un bloqueo permanente de la
misma llamada. Además, dos conversaciones o tareas programadas compartían la
misma página sin ningún tipo de propiedad.

## Decisión

Usamos dos pestañas fijas, «Agente» y «Tú», con dos `WebContentsView` y la misma
sesión y cookies. La pestaña activa se monta en el panel de la ventana principal;
la inactiva queda viva en la ventana anfitriona. Las herramientas web del agente
siempre operan sobre la pestaña «Agente»; la barra de direcciones y los controles
del panel operan sobre la pestaña activa. La gracia de entrada y el control son
por pestaña. La pestaña «Agente» se reserva por conversación mediante un lease
que se libera al terminar el turno.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
| --- | --- |
| Mantener una sola vista y esperar más tiempo | No permite concurrencia real: el usuario y el agente siguen compitiendo por la misma página. |
| Pestañas ilimitadas con crear, cerrar y reordenar | Requiere más estado, UI, límites de memoria y pruebas; no era necesario para resolver la concurrencia usuario/agente. |
| Particiones de sesión separadas para agente y usuario | Evita compartir cookies, pero obliga a iniciar sesión dos veces y rompe el caso de uso de compartir una sesión autenticada. |
| Pestaña del agente por conversación | Aísla por completo, pero multiplica las vistas y complica el panel fijo; se prefiere el lease y dejar la evolución a un ADR posterior. |

## Consecuencias

- El agente puede navegar, leer y actuar en su pestaña mientras el usuario usa la
  suya; cambiar de pestaña conserva página, historial y sesión.
- Las dos pestañas comparten cookies, service workers y login. Es intencional:
  el usuario puede iniciar sesión en una y el agente la reutiliza. No se debe
  asumir aislamiento entre «Agente» y «Tú».
- El agente no lee ni hace clic en «Tú»; para eso debe abrir la URL en su propia
  pestaña.
- El lease por conversación evita que dos turnos naveguen a la vez en la pestaña
  del agente. Si otra conversación intenta usarla, recibe un error recuperable;
  al terminar el turno o cumplirse el TTL, la pestaña queda libre.
- Son dos pestañas fijas: no hay creación, cierre ni reordenación. Cualquier
  crecimiento a pestañas arbitrarias requiere otro ADR.

## Verificación

- `tests/test-agent-native-tools.js`: dos vistas, reparentado, control y espera
  por pestaña, concurrencia usuario/agente y lease entre conversaciones.
- `tests/test-agent-runtime.js`: avance de `web_click` cuando cambia la página,
  límite al repetir en la misma página y liberación del lease al terminar.
- `frontend/src/components/agent/AgentBrowserPanel.test.tsx`: barra de pestañas,
  controles por pestaña y estados vacíos.
- Catálogo IPC (`tests/test_ipc_catalog.py` y paridad de allowlist) y suite
  frontend completa.

La prueba real con Electron (dos `WebContentsView`, reparentado, entrada en una
pestaña, navegación concurrente, lease y guard local) pasó en el entorno de
desarrollo. La UI completa de Antares no se recorrió manualmente: el panel se
verifica con pruebas de componente y la mecánica nativa con esa prueba de
Electron.
