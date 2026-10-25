# 0001. Compactación de contexto del agente

- Fecha: 2026-10-24
- Estado: propuesto
- Personas: sechgio

## Contexto

Los turnos largos del agente de Antares mueren cuando el historial agota la
ventana del modelo: el proveedor rechaza la petición y el turno termina sin
reanudarse. Además la UI no mostraba cuánto contexto queda, así que el agotamiento
era siempre una sorpresa. El runtime (`@earendil-works/pi-durable`) ya trae un
motor de compactación duradera —corta el tramo antiguo, pide un resumen y coloca
el corte en un punto seguro, nunca entre una llamada a herramienta y su
resultado— pero Antares no lo configuraba ni aportaba política propia: sin
umbrales, con el resumidor genérico en inglés, sin protección de secretos y sin
registro auditable.

Restricciones: no cambiar el modelo de permisos; sin dependencias nuevas
(tokentizadores); el contenido de herramientas, archivos y web es DATO y nunca
puede ascender a instrucción dentro de un resumen; los secretos no pueden
quedar en el resumen, el registro ni el diagnóstico; una compactación no puede
ocurrir con una acción con efectos en curso o una aprobación pendiente.

## Decisión

Configuramos la compactación de pi-durable con una política propia de Antares
(`electron/agent-compaction.js`) compuesta por:

**Medición.** La ventana se toma de `model.contextWindow`, con retroceso a
`capabilities.context_window` del proveedor y a un valor por defecto de 128 000
tokens. El uso real se lee del contador del proveedor cuando lo reporta
(`usage.context`); si no, el consumo se estima por el volumen del historial. La
medición es del contexto total: no se desglosan por separado sistema, memoria,
historial y resultados de herramientas en la UI.

**Umbrales** (sobre la ventana del modelo, configurables en
`<datos de usuario>/ai-agent/compaction.json`):

| Umbral | Fórmula | Efecto |
| --- | --- | --- |
| Aviso (UI) | `ventana − reserveTokens − backgroundTokens` | el anillo de contexto cambia a amarillo |
| Compactación | `ventana − reserveTokens` | pi-durable compacta (bloqueante) y el turno continúa |
| Límite duro | `ventana` | el proveedor rechaza; rescate por desbordamiento: compactar y reintentar una vez |

Por defecto `reserveTokens = 16384` (margen de respuesta) y
`backgroundTokens = 32768` (antelación del aviso). El aviso aparece antes que la
compactación y esta antes del límite duro: la estimación es deliberadamente
conservadora.

**Lista sagrada y política de resumen.** El resumidor de Antares
(`SUMMARY_SYSTEM_PROMPT`, en español) exige secciones fijas: encargo actual,
instrucciones y correcciones del usuario, decisiones tomadas con su por qué,
acciones ejecutadas con resultado, archivos y entregables generados, pendientes
y bloqueos, y datos clave para continuar. Perder una corrección del usuario
(«cambió de idea») es un fallo grave por definición. Los bloques de contexto
reinyectado (`[Contexto de Antares]`, memoria) no se resumen: vuelven solos.

**Puntos seguros.** El hook `beforeCompact` rechaza la compactación si hay una
herramienta en curso o una aprobación pendiente (el rechazo es barato y la
comprobación del umbral se reintenta). pi-durable garantiza además que el
resumen se coloca en un límite de conversación, nunca entre una llamada y su
resultado, y que el tramo a resumir queda congelado antes de crearse la tarea.

**Barrera dato/directriz y secretos.** Todo lo transcrito para el resumen pasa
por `redactSecrets` (patrones de claves API, JWT, claves privadas, tokens
bearer). Tras generar el resumen, `guardDataDirectives` reescribe como cita
etiquetada cualquier línea imperativa cuyo texto proceda literalmente de un
resultado de herramienta: un dato infiltrado no puede ascender a instrucción.

**Fallo visible.** Si el modelo no produce un resumen utilizable, se genera un
resumen de emergencia mecánico y marcado. Si la tarea de compactación falla, el
turno se detiene (queda reanudable, con `last_error` en la sesión) en lugar de
continuar con un contexto corrupto; un fallo por caída emite además un aviso en
la conversación. Cada compactación y cada rechazo quedan en el registro JSONL
`compactions-log.jsonl` del directorio de estado.

La UI (`ContextUsage`) muestra la ventana real del modelo, el porcentaje frente
a los umbrales y el estado «Compactando…»; la proyección de mensajes añade una
entrada «🗜 Contexto compactado» con el motivo y el resumen, para que el usuario
vea qué se conservó.

**Coexistencia con el guardián mecánico.** Antares además compacta cada petición
individual de forma mecánica y sin modelo (`compactMessages`/`requestBudget`,
mismo módulo, capas 1 y 2): recorta resultados antiguos, textos e imágenes y
pliega turnos viejos para que ninguna llamada única se pase del presupuesto,
respetando el emparejamiento llamada/resultado y sin tocar el mensaje actual.
Esa capa es transitoria y por petición; la política duradera de esta decisión
(es el resumen que persiste en la conversación) actúa sobre umbrales distintos y
ambas conviven: la mecánica evita el pico puntual, la política evita el agotamiento
progresivo del contexto.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
| --- | --- |
| Contar tokens por componente con un tokenizador propio | Requiere dependencia nueva y diverge del contador real del proveedor; se mide el contexto total con los umbrales como red de seguridad conservadora. |
| Compactar solo a petición del usuario | El objetivo es que las tareas largas no mueran solas; queda el aviso previo y el rescate por desbordamiento. |
| Pausar y preguntar al usuario al llegar al umbral | Rompe tareas desatendidas; se compensa con puntos seguros (rechazo con herramienta/aprobación en curso) y fallo visible. |
| Motor de compactación propio fuera de pi-durable | pi-durable ya garantiza cortes en puntos seguros y reanudación duradera; duplicarlo arriesga cortes inseguros. |
| Promoción automática a memoria/procedimientos en la compactación | Una escritura automática en memoria desde un resumen puede ascender datos a hechos duraderos; se deja como pista («Memoria candidata») para el agente, sin escritura forzada. |

## Consecuencias

Se gana: tareas largas que sobreviven al límite del contexto; aviso previo
visible; resumen en español con lista sagrada; secretos redactados en resumen,
registro y diagnóstico; barrera dato/directriz; registro auditable.

Se paga: un coste de modelo extra por compactación (resumidor con
`cacheRetention: none`); el resumen es lossy por diseño (la lista sagrada
mitiga, no elimina, la pérdida); la estimación sin contador del proveedor puede
avisar antes de lo estrictamente necesario.

Queda prohibido a partir de ahora: compactar con una herramienta en curso o una
aprobación pendiente; introducir instrucciones nuevas en un resumen desde datos
de herramientas/archivos/web; registrar secretos en el resumen, el registro o el
diagnóstico; desactivar o saltarse las pruebas de compactación.

Verificación: `tests/test-agent-compaction.js` cubre las nueve garantías
(umbral previo al límite, lista sagrada, correcciones conservadas, rechazo con
aprobación o herramienta en curso, sin repetición de acciones, fallo que pausa
en lugar de corromper, barrera dato/directriz, redacción de secretos y
estimación conservadora con rescate por desbordamiento). Se ejecutan con
`npm test`.
