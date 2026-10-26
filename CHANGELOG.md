# Changelog

Todas las versiones notables de Antares se documentan aquí.

Formato basado en [Keep a Changelog](https://keepachangelog.com/),
y este proyecto sigue [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- Agent usa el límite de salida real de cada modelo del catálogo (por ejemplo, 128 000 tokens en Claude 5.5 y hasta un cuarto de la ventana en GPT): con el tope fijo de 8 192 tokens, el razonamiento alto dejaba sin espacio la respuesta y truncaba las llamadas a herramientas.
- Un modelo personalizado que apunta a la API oficial de Anthropic, OpenAI u OpenRouter usa el catálogo de ese proveedor (ventana, límite de salida, precios y modo de razonamiento), y la lista de conversaciones refleja al momento los niveles de razonamiento que declara Proveedores IA.
- Las herramientas MCP usan su canal de permisos, de modo que las reglas del canal MCP también se les aplican; la traza y la tarjeta de aprobación las nombran por su servidor y su herramienta real.
- El chat de Agent no pone en cursiva los guiones bajos dentro de palabras (`gmail_search`, `mi_archivo_final.pdf`).
- Las delegaciones síncronas de Agent consultan la memoria de su agente, respetan su presupuesto diario y conservan su consumo también al detenerlas o reiniciar. La selección de herramientas aplica una sola política en las conversaciones y las dos formas de delegación.
- Esperar la próxima ejecución de CI ignora las ejecuciones que ya existían; las búsquedas y esperas de Outlook por remitente usan un filtro compatible con la ordenación de Microsoft Graph.

### Added
- Las ediciones y escrituras de archivos del Agent se muestran como diff en la traza y en la tarjeta de aprobación: líneas borradas y añadidas con contadores +N −M, resaltado de la palabra que cambió, números de línea cuando se conocen y pliegue de los tramos largos sin cambios. Las líneas entran escalonadas, las añadidas destellan al aplicarse y el diff se abre y cierra con una transición; todo respeta «reducir movimiento».
- `fs_edit` acepta `edits` para aplicar varios reemplazos en orden con una sola aprobación y de forma atómica (si uno falla no se escribe nada), encuentra fragmentos escritos con `\n` en archivos CRLF y devuelve un fragmento numerado del resultado. `fs_search` admite globs de ruta (`src/**/*.py`), líneas de contexto (`context`) y un modo `files_only` con el número de coincidencias por archivo, y omite `node_modules` y `__pycache__`. Las llamadas existentes con `old`/`new` se comportan igual.
- Agent ofrece el nivel de razonamiento «Máximo» en los modelos que lo admiten (Claude Opus/Sonnet 5.5, Fable 5.1, GPT-6.1); en los demás se ajusta al nivel inferior.
- `tools_load` encuentra la herramienta adecuada: el nombre exacto la selecciona sola, los alias de cada módulo pesan más que la descripción, se ignoran las palabras vacías y solo se cargan las coincidencias cercanas a la mejor.
- El compositor de Agent sugiere con «@» los conectores (Drive, Hojas de Google, Gmail, OneDrive, Excel, Outlook, GitHub) y los servidores MCP configurados, con el icono de cada marca. Mencionarlos habilita sus herramientas en la conversación; las herramientas MCP siguen pidiendo aprobación y solo se habilitan las activas en Conexiones.
- El navegador de Agent permite anotar la página: «Anotar la página» congela una captura y abre una barra con seleccionar, lápiz, formas (línea, flecha, rectángulo, elipse y pasos numerados), texto, color de tinta y grosor. «Agregar al chat» adjunta la captura anotada como PNG al compositor de la conversación; mientras se anota, la vista nativa se retira para no tapar la barra.
- El chat de Agent muestra gráficos e interfaces en línea: los bloques ```chart (barras, líneas o torta desde JSON) se dibujan como SVG nativo y los bloques ```svg y ```html se muestran en un marco aislado, sanitizado y sin scripts ni recursos externos. Mientras el bloque se transmite se muestra un marcador «Generando…»; al cerrarse se dibuja con valores al pasar el cursor, una tarjeta con «Vista/Código» y copiar, y una tabla de datos para lectores de pantalla. El visor se carga en un módulo diferido y un JSON inválido se muestra como código.
- El compositor de Agent invoca skills con «/» al inicio del borrador o tras un espacio: filtra el catálogo de forma difusa, se navega con el teclado y la skill elegida queda como chip. El turno valida la skill con el perfil de la conversación, avisa si usa la versión compartida y bloquea cualquier otra herramienta hasta cargarla con `skills_read`; la skill son instrucciones, no habilita herramientas ni salta aprobaciones.
- Cada agente guardado tiene sus rutinas: el editor lista, crea y cancela los encargos recurrentes de todas sus conversaciones y crea los nuevos en la más reciente. Un agente admite como mucho 3 rutinas activas y, cuando se las programa él mismo con `task_schedule`, no pueden repetirse más de una vez cada 30 minutos; el usuario puede elegir intervalos menores desde el panel o el editor. Las rutinas respetan el presupuesto diario y los permisos del agente.
- Cada agente guardado puede tener un presupuesto diario de tokens (de entrada y salida, sin la caché) que suma todas sus conversaciones y delegaciones del día local. El chat avisa a partir del 80 %; al agotarlo, el turno en curso se detiene en un punto reanudable, no se admiten mensajes nuevos ni Reanudar hasta el día siguiente o hasta ampliar el presupuesto, y sus encargos programados esperan a la medianoche sin contar como fallo. Sin presupuesto el comportamiento no cambia.
- Cada agente guardado elige su memoria: Compartida (por defecto, como hasta ahora: lee la memoria general y la suya), Propia (solo lee y guarda la suya) o Ninguna (no recibe recuerdos y pierde `memory_search`, `memory_remember` y `procedure_learn`, también al delegar o como subagente). El alcance se aplica en el chat, la cola, los encargos y las delegaciones y sobrevive al reinicio.
- Los agentes guardados pueden bloquear herramientas concretas: con «Todas las herramientas» activado, el editor permite marcar las que el agente nunca debe usar, también las que se añadan después. Una herramienta bloqueada gana sobre la lista permitida y queda fuera de la conversación del agente, de `tools_load`, de la selección manual, de sus delegaciones y de `subagent_run`.
- `ui_launch` abre cualquier aplicación por nombre (por ejemplo `firefox`, `chrome` o `spotify`) o ruta, no solo los alias fijos; si Windows no encuentra el ejecutable, el error sugiere abrirla vía shell con `Start-Process`. Abrir una aplicación sigue exigiendo aprobación humana.
- Agent integra descargas autorizadas a borradores, subidas de archivos con permisos por conversación, captura de página completa y cesión del control del navegador. Las descargas ajenas se cancelan y las autorizadas verifican URL y límite de bytes recibidos.
- Crear un agente muestra nombre, color e instrucción permanente en una tarjeta compacta y abre su conversación al guardar si hay un proveedor configurado. También permite guardarlo para después, usar Intro y evita envíos duplicados. La descripción, el mensaje inicial y las herramientas quedan en opciones avanzadas; el color elegido se conserva al reiniciar.
- Agent aplica una política duradera de compactación sobre el resumen automático de pi-durable: umbrales de aviso y compactación configurables en `ai-agent/compaction.json`, rescate cuando el proveedor rechaza por tamaño, y resumen que conserva lo sagrado (encargo, correcciones del usuario, decisiones con su motivo, acciones ejecutadas, archivos generados y pendientes), redacta secretos y no convierte datos de herramientas en instrucciones. No se compacta con una herramienta en curso o una aprobación pendiente; si la compactación falla, el turno se detiene y queda reanudable. Cada compactación aparece en el chat con su motivo y resumen, queda registrada en un log auditable y el indicador de contexto avisa al acercarse el límite y muestra «Compactando…». Ver `docs/adr/0003-compaccion-contexto-agente.md`.
- Agent amplía el broker con canales propios para MCP, Memoria y Agenda; `task_schedule`, `memory_remember` y `procedure_learn` dejan de ejecutarse sin aprobación. Las reglas pueden ser por conversación o globales (la conversación manda), «Otros» no se puede permitir en bloque y cada cambio queda en un historial de auditoría. El Undo cubre también `drafts_save`, reconcilia escrituras interrumpidas verificadas por hash, avisa al agente cuando se deshace una acción y poda copias antiguas. Las tarjetas de artefacto muestran su recibo de aprobación.
- Agent unifica las aprobaciones en un broker por canal (Terminal, Archivos, Escritorio y navegador, Nube y conexiones, Documentos, Otros) con reglas por conversación de Preguntar, Permitir o Bloquear. Cada efecto deja un recibo persistente con el canal, la regla aplicada y, cuando es reversible, «Deshacer» con copia previa y verificación de hash; el terminal sigue pidiendo aprobación aunque su canal esté configurado para permitir.
- El navegador del Agent separa la página del agente y la del usuario en dos pestañas con la misma sesión y cookies. El agente puede abrir, leer y actuar en su pestaña mientras el usuario usa la suya; el bloqueo, el control y la aprobación se aplican por pestaña, y la barra «Agente/Tú» muestra cuál está activa. Incluye `web_reload` y `web_forward`, y un lease por conversación que impide que dos tareas naveguen a la vez en la pestaña del agente.
- Agent permite regular el nivel de razonamiento de cada conversación desde el compositor, con solo los niveles que admite el modelo, y lo envía al proveedor en cada turno. El soporte se toma del catálogo de pi-ai (incluidos GPT-5, o3 y el pensamiento adaptativo de Claude), de la capacidad declarada en los modelos personalizados o, en su defecto, del nombre. Los modelos personalizados pueden declarar razonamiento y buscar bajo demanda los modelos activos de su endpoint desde el selector.
- Agent acepta archivos arrastrados al compositor y capturas pegadas con Ctrl+V, con miniatura para imágenes. Los modelos con visión reciben las imágenes adjuntas (PNG, JPG, GIF y WEBP de hasta 4 MB) dentro del mensaje; el resto de archivos se leen con herramientas como hasta ahora.
- Los encargos programados (`task_schedule`) pueden declarar una lista blanca de apps de Windows (alias como `notepad` o `calc`, máximo 8) para ejecutarse solos: durante ese turno desatendido solo se manejan esas apps, hasta un techo de 25 acciones con efecto, y las concesiones de app de la conversación no aplican; las demás apps y el shell siguen esperando aprobación humana como siempre.
- Las acciones de Agent sobre apps de Windows que inyectan entrada o abren aplicaciones (`ui_click`, `ui_type`, `ui_key`, `ui_scroll`, `ui_drag`, `ui_set_value`, `ui_launch`) exigen aprobación humana también en Acceso completo, igual que el shell. La tarjeta muestra aplicación, ventana y elemento objetivo, y el botón «Siempre esta app» aprueba y autoriza el resto de acciones sobre esa misma aplicación durante la conversación, con un registro auditable de cada envío antes de ejecutarse.
- Mientras Agent ejecuta una acción con efecto sobre una ventana de Windows, un marco ámbar sin foco cubre la aplicación objetivo durante el despacho, y la entrada física humana (teclas, clics o rueda) rompe el turno del agente: la operación en curso se aborta con un aviso claro y el agente se detiene e informa de lo hecho. El movimiento del ratón no interrumpe y el propio envío del agente nunca cuenta como entrada humana.
- Agent puede operar aplicaciones de Windows anclado a elementos de accesibilidad en lugar de píxeles: enumera ventanas con `ui_windows`, observa sus campos con árbol de elementos y captura adjunta con `ui_observe`, y actúa con `ui_click`, `ui_type`, `ui_key`, `ui_scroll`, `ui_drag`, `ui_set_value` y `ui_launch` (abre apps por alias o ruta). Cada acción con efecto pide aprobación como el resto de herramientas; se rechaza operar sobre campos de contraseña o ventanas de procesos elevados, los identificadores de ventana y elemento caducan tras cada acción y hay que re-observar, y el tecleo carácter a carácter usa una cadencia validada para no corromper el texto en apps con entrada moderna.
- Agent admite perfiles portables en `agents/<slug>` con metadatos, instrucciones base y skills propias; `AGENTS_HOME` permite cambiar la raíz y las skills propias prevalecen sobre las compartidas de `_shared/skills`, conservando el catálogo autorizado y sin ejecutar scripts al cargarlas. Las lecturas y respuestas están acotadas; un perfil ausente al reabrir afecta solo a su conversación.
- Nueva vista Complementos en la barra lateral: reúne el catálogo de conexiones que usa el agente con un diseño más limpio (búsqueda, filtro de conectados, agrupación por categoría y servidores MCP), la lista de complementos instalados y una sección Habilidades que muestra las skills disponibles para el agente sin cargar sus instrucciones. Conexiones deja de estar en Ajustes.
- Agent resuelve skills compartidas en `skills/_shared/` y propias en `skills/<profile_id>/`, con prioridad de las propias y aviso de colisión. `SKILLS_HOME` y `ORBS_SHARED_HOME` permiten configurar sus rutas sin ejecutar scripts ni ampliar permisos de herramientas.
- Agent registra cada turno del daemon como una línea JSONL en `.orbs/turns.jsonl`: estado explícito `ok`/`error`/`failed` sin éxito inferido, cada llamada de herramienta con si aplicó y su resultado verificado como evidencia, resúmenes de entrada y salida, y secretos redactados antes de escribir. El fichero rota por tamaño sin borrar el historial y `npm run orbs -- turns list` lo consulta por sesión, fecha, estado y límite leyendo en streaming.
- Agent delega con roles: los subagentes son exploradores por defecto y pueden pedir una revisión o, si su ficha lo permite, trabajar con efectos bajo aprobación. La delegación se limita a un nivel, permite sustraer herramientas, valida la respuesta contra un `output_schema` con reintento correctivo y agrupa hasta cuatro encargos con su estado. Las aprobaciones de un worker llegan a la conversación padre con su origen y nunca se conceden solas.
- Agent muestra el coste estimado del turno y de la sesión con los precios reales del catálogo, usa la ventana de contexto exacta del modelo e informa de las compactaciones aplicadas. Las conversaciones largas se compactan automáticamente: pi-durable resume el historial en ventanas grandes y, en ventanas pequeñas, se conservan los últimos turnos con un resumen estructurado de lo omitido.
- Agent muestra el historial de aprobaciones con filtros por conversación, herramienta y estado, detalle de parámetros y recursos, exportación JSON/CSV y revocación de accesos concedidos. Los encargos programados tienen un panel para crear, editar, ejecutar ahora o cancelar, con historial de ejecuciones, token de silencio y recuperación acotada tras reiniciar: una entrega interrumpida no se repite y los recurrentes se reprograman una sola vez.
- Agent encola encargos por conversación en una FIFO persistente: se ejecutan en orden, uno a la vez, cuando el turno actual termina. El panel permite añadir encargos a la cola, pausarla o reanudarla y cancelar pendientes; la cola se pausa sola si un encargo falla o el turno necesita reanudarse. El contenido encolado no concede permisos ni acceso a rutas.
- Agent integra las acciones del turno en una sola barra, conserva su acceso en paneles estrechos y permite desplegar el texto completo de los mensajes en cola.
- Agent presenta un compositor con espacio de escritura completo, adjuntos y modelo en la barra inferior, y una cola numerada con estados, adjuntos y acciones visibles. Las conversaciones tienen más separación y las respuestas aprovechan el ancho de lectura.
- Agent muestra recibos de envío y permite recuperar una petición no confirmada con el mismo texto, adjuntos e intención, sin borrar un borrador nuevo, incluso al cambiar de módulo o reiniciar. La cola distingue lo guardado de lo recibido y conserva las indicaciones al restaurarse; el compositor ignora Intro repetido y la actividad reconoce las herramientas web reales.
- Agent explica qué confirma cada modo de permisos y su alcance por conversación. Cada solicitud muestra el efecto, destino, cuenta y recursos disponibles, aclara que permitir autoriza solo esa llamada y que rechazar la omite e informa al agente. Las categorías de herramientas dejan de prometer una aprobación en todos los modos.
- Agent conserva stdout y stderr completos del shell y permite leerlos por páginas con `shell_output`, también tras reiniciar y sin cruzar conversaciones. El shell mantiene su límite de tiempo y no admite entrada interactiva.
- Agent expone el diagnóstico de los servidores MCP con `mcp_status`, con comprobación opcional del catálogo y secretos ocultos.
- Las operaciones de capas y campos de Canvas pueden usar el backend si la ventana o el proceso renderer no están disponibles antes del despacho, conservando la revisión exigida. Las exportaciones visuales y Espacios siguen usando su puente de pantalla.
- Al agotar 40 rondas, Agent conserva un punto de continuación visible y reanudable; una delegación aparcada sigue pendiente hasta completarse. Crear más de 50 conversaciones ya no oculta automáticamente las anteriores.
- Agent programa encargos locales con zona horaria y repetición, recupera las entregas pendientes al abrir Antares y admite mensajes en la cola durable de conversaciones ocupadas. La aplicación debe permanecer abierta, incluida la bandeja, para ejecutarlos.
- Agent espera eventos de solo lectura dentro del encargo con `wait_event`: tiempo acotado, aparición o cambio de un archivo autorizado, fin de una operación de AutoIMG, fin de una delegación, correo nuevo de Gmail o Microsoft, ejecución de GitHub Actions y estado HTTP de despliegue. La espera reanuda el mismo turno, sobrevive al reinicio, se cancela con Detener y no amplía permisos ni acceso a rutas. El presupuesto es de 30 minutos por turno y la bandeja muestra `waiting_event` sin pedir intervención.
- Agent ejecuta builds y despliegues largos con `shell_job_start`, `shell_job_status`, `shell_job_cancel` y `shell_output`: aprobación por comando, 30 minutos de vida, 2 jobs por conversación, salida paginable y kill del árbol al cancelar o cerrar.
- Agent lee correo con `gmail_search`/`gmail_get` y `outlook_search`/`outlook_get` usando las conexiones Google y Microsoft existentes, sin enviar, sin adjuntos y sin cuerpo en las esperas. GitHub Actions se consulta con `github_workflow_runs`/`github_run_get`. Las conexiones existentes piden reautorizar los scopes nuevos.
- La espera HTTP de despliegue solo admite HTTPS público o loopback local, sin credenciales, redirecciones ni cuerpo, y bloquea rangos privados por DNS.
- Agent puede delegar lecturas en conversaciones persistentes y visibles, recuperar el resultado al reiniciar y devolverlo al padre. Detener o eliminar la conversación cancela sus delegaciones pendientes; estas no pueden ampliar permisos ni delegar de nuevo.
- La memoria nueva de cada perfil queda separada, conserva los recuerdos globales anteriores y prioriza los datos pertinentes sin saturarse con preferencias largas. Las lecturas idempotentes interrumpidas pueden recuperarse; los efectos inciertos no se repiten automáticamente.
- Cada comando de PowerShell requiere aprobación humana también en Acceso completo. La aprobación explica que el proceso puede acceder al equipo completo con los permisos del usuario.
- Agent reconoce menciones de bots guardados con `@nombre`, `@"Nombre completo"` y referencias por identificador, ofrece sugerencias con teclado y conserva las menciones de módulos. Seleccionar un bot conserva su identidad al renombrarlo o restaurar la cola. El coordinador puede delegar y compartir conclusiones, sin ampliar permisos ni resolver silenciosamente bots ambiguos o borrados.
- Agent separa conversaciones y agentes guardados con búsquedas independientes. El selector de herramientas permite buscar y filtrar Skills y MCP sin modificar la selección oculta, conserva el foco de teclado y muestra el total habilitado. Las trazas de skills presentan catálogo, procedencia, contenido y lecturas parciales, conservando el JSON original.
- Agent y sus subagentes pueden buscar skills locales `SKILL.md` y cargar instrucciones y referencias bajo demanda, sin ejecutar scripts ni ampliar permisos. La lectura es paginada, abre solo los archivos de la skill elegida y prioriza las carpetas adjuntas sobre la biblioteca local.
- Agent busca conversaciones locales anteriores con `sessions_search`, con referencias al mensaje de origen y sin incluir razonamiento ni resultados de herramientas. Todas las lecturas comparten el seguimiento de progreso: resultados nuevos permiten continuar; efectos y observaciones sin cambios conservan su límite. La bandeja excluye conversaciones ocultadas por retención.
- El navegador del Agent recibe clics, texto y teclas en segundo plano sin tomar el foco de Windows, también con zoom. Comprueba el documento aprobado y el control humano antes de cada paquete. Una navegación, recarga o entrada humana detiene la continuación; si ya hubo entrada, el resultado conserva incertidumbre y no se repite automáticamente.
- Se actualiza `pypdf` a 6.21.2 para corregir una vulnerabilidad detectada por la auditoría de dependencias.
- Agent coordina las acciones de Windows entre conversaciones, detiene la escritura y los atajos al cancelar, valida todos los atajos antes de pulsarlos y registra como fallidos los comandos que terminan con código distinto de cero. Las delegaciones usan el proveedor y modelo actuales aunque la conversación solo exista en SQLite; las esperas de aprobación y sondeo liberan sus listeners y una respuesta correcta limpia el error anterior.
- El Agent puede crear, actualizar, borrar y ordenar capas de Canvas con posiciones en mm, estilos y campos reutilizables mediante `canvas_apply_layers`, comprobando la revisión y devolviendo las capas guardadas sin usar el escritorio.
- El ancho del navegador del Agent se ajusta arrastrando el divisor junto al chat o usando las flechas del teclado; un doble clic restablece el tamaño inicial.
- **Agent, navegador integrado**: un panel junto al chat muestra en vivo la página que usa el agente (se abre solo cuando abre una página), con barra de dirección, atrás/adelante/recargar y «Tomar el control» para usarla tú (por ejemplo para iniciar sesión) mientras el agente espera. La página se maqueta siempre con ancho de escritorio y se reduce para caber en el panel; sin el panel abierto sigue funcionando fuera de pantalla en vez de abrir una ventana aparte. Si haces clic, desplazas o escribes en la página, el agente espera unos segundos antes de volver a actuar sobre ella, y los menús y diálogos que la tapan se muestran por delante.
- **Agent trabaja en el equipo**: lee, busca, escribe y edita archivos de texto y Word (.docx) en su espacio de trabajo o en lo que adjuntes; ejecuta PowerShell; navega por internet en un navegador aislado, sin tus sesiones, donde lee páginas y puede escribir y hacer clic; y maneja aplicaciones de Windows con capturas de pantalla, controles de UI Automation, ratón y teclado. Escribir archivos, ejecutar comandos, interactuar con páginas y cualquier acción o captura del escritorio piden tu aprobación una a una, ligada a la revisión del archivo cuando aplica. El agente publica un plan visible con progreso y evidencia por paso, revisa lo que devuelve cada acción antes de seguir y puede encadenar hasta 40 pasos por turno. Los modelos con visión reciben las capturas como imagen. Tras detener un turno o dejar pasos abiertos aparece «Reanudar», y el plan y el historial se conservan al reiniciar.
- **Agent, herramientas a demanda**: con un catálogo grande, las conversaciones nuevas empiezan con un núcleo de herramientas (equipo, plan, memoria, documentos y borradores) en lugar de enviar más de 200 en cada petición, lo que superaba el límite de 128 de OpenAI y saturaba a los modelos pequeños. El agente carga el resto con `tools_load` o al mencionar un `@módulo`, y «Restablecer herramientas» vuelve al núcleo.
- **Agent, caché del modelo visible**: el desglose de contexto muestra cuántos tokens del prompt sirvió la caché del proveedor y qué porcentaje del total supone, para comprobar que el prefijo se reutiliza entre rondas.
- **Agent, en vivo**: la conversación se actualiza en cuanto el motor emite un evento (texto, herramientas, aprobaciones) en vez de esperar al sondeo; una herramienta en ejecución de una ronda nueva se muestra en curso y nunca como interrumpida; y las sugerencias se ocultan mientras el agente trabaja.
- **Agent, bucle más fiable**: si repite la misma herramienta con los mismos argumentos más de tres veces en un turno, la cuarta se bloquea y se le pide cambiar de vía o informar del bloqueo; si da por terminado un encargo con pasos de su plan sin verificar, se le pide una vez que siga o los marque como fallidos con la causa (sin mostrarlo en el chat); las referencias de elementos del navegador se mantienen estables mientras el elemento exista, de modo que una referencia antigua nunca pulsa otro elemento; y el agente cierra con qué quedó hecho, la evidencia y qué necesita, y deja inicios de sesión, CAPTCHA y pagos al usuario.
- **Modelos personalizados en el Agent**: en «Opciones avanzadas» se puede indicar si el modelo acepta imágenes y su ventana de contexto. Los endpoints compatibles con OpenAI que no son OpenAI ni OpenRouter (Ollama, LM Studio, vLLM, llama.cpp…) reciben el contrato clásico de Chat Completions (`max_tokens`, rol `system`, sin `store`), y los modelos sin visión ya no reciben capturas que rompían el resultado de la herramienta.
- **Proveedores IA, modelos personalizados**: el alta y la edición se hacen en un editor modal con presets de proveedor (Anthropic, OpenAI, OpenRouter, Ollama u otro), autenticación por clave, clave guardada o sin clave, búsqueda de modelos con sugerencias (y los modelos reales del servicio al editar), nombre visible opcional y opciones avanzadas. Los errores se muestran en el propio editor y eliminar pide confirmación. En el Agente, los modelos personalizados aparecen agrupados en «Personalizados» con su nombre visible y se eligen sin consultar el servicio.
- El editor de video tiene una línea de tiempo con regla, cabezal y zoom por niveles, pistas de video y audio y clips proporcionales a su duración. Los medios importados se añaden con +, doble clic o arrastrando, y se pueden dividir (Ctrl+K) y eliminar (Supr). La interfaz del editor se rediseñó con vista previa a la proporción del proyecto, biblioteca con iconos por tipo y panel de propiedades por clip.
- Agent permite elegir proveedor y modelo desde el composer en un menú agrupado por proveedor, filtrar por nombre y escribir un modelo manualmente si el proveedor no responde. Un indicador junto al selector muestra el porcentaje de la ventana de contexto usado y, al pasar el cursor, los tokens de entrada y salida.
- Agent puede delegar tareas en agentes guardados con herramientas de solo lectura. La conversación muestra los pasos, el resultado y la duración de cada delegación.
- Agent permite habilitar herramientas por conversación y conserva la selección al reiniciar. Deshabilitarlas bloquea también las llamadas que aún esperan aprobación o un recurso compartido.
- Agent permite generar Padrones y Volantes con sus motores actuales, exportar plantillas HTML y Canvas RGB/CMYK, revisar y guardar PDFs registrados y preparar su impresión con aprobación ligada al archivo. Incluye preguntas estructuradas, operaciones de Espacios con la sesión actual y selección de herramientas MCP.
- Antares conserva el trabajo al cerrar a la bandeja; «Mostrar Antares» recupera la ventana y «Salir» guarda Canvas antes del cierre. Los efectos interrumpidos conservan comprobantes y la impresión consulta la cola sin reenviar trabajos inciertos.
- **Design**: nuevo apartado en el riel que genera presentaciones con el proveedor IA que configures (OpenAI, Anthropic, OpenRouter u Ollama), sin rutas de código por proveedor. Escribes qué quieres presentar, el modelo devuelve un documento de diapositivas con layout semántico y tema propio, lo previsualizas en el panel y lo exportas a PDF. Admite formatos 16:9, 16:10, 4:3 y A4; los diseños quedan guardados y se pueden reabrir y eliminar. El contenido del modelo pasa por allowlists (colores hex, lista segura de fuentes, siete layouts) y el render escapa todo el texto, así que un diseño no puede inyectar HTML ni CSS en la vista previa ni en el PDF.
- **Design, control de calidad**: cada previsualización se mide sobre su PDF renderizado y avisa de texto que se sale del área segura, bloques que se solapan, texto por debajo de 9 pt, diapositivas vacías y paletas por debajo del contraste WCAG (4.5:1 cuerpo, 3:1 acento). La tira de diapositivas marca en rojo las que tienen fallos y salta a ellas. Es determinista: no depende del modelo, así que funciona igual con un modelo local que con uno frontier, y es lo que en el escritorio de Claude no se puede hacer porque el lienzo se renderiza en su servidor. La vista previa añade recarga bajo demanda. Sigue fuera de esta versión la edición diapositiva a diapositiva.
- **Design, preferencias persistentes**: puedes fijar decisiones de diseño ("nada de degradados", "español formal", "logotipo arriba a la izquierda") que el modelo respeta en **todas** las generaciones, sin repetirlas. Es el equivalente de la memoria que Claude Design guarda entre turnos, pero aquí es local, explícita y editable: una nota no es el resultado de un turno, así que solo tú la añades o la borras. Se deduplican textos repetidos y vacíos, y la nota entra en el prompt tal cual, sin escapar.
- **Design, revisión automática**: tras generar, se rasteriza cada diapositiva del PDF ya renderizado y se le pasa al modelo para que la critique como director de arte —texto cortado, elementos solapados, contraste, jerarquía plana, maquetación repetida—. Si objeta algo, se le pasa una ronda de corrección con las imágenes delante. Con un proveedor que no admita imágenes la revisión se omite sin romper la generación, igual que si el modelo no ve defectos.
- **Plugins de la barra de título**: Spotify (con OAuth), Audius, Jamendo y Archive se pueden activar y ordenar desde Ajustes.
- **Notas adhesivas**: se pueden crear y organizar notas locales desde la barra de título.
- **Conexiones externas**: nueva sección Conexiones con catálogo extensible de 19 proveedores (GitHub, GitLab, Bitbucket, Slack, Discord, Zoom, Notion, Airtable, Dropbox, Google, Linear, Jira, ClickUp, Todoist, Asana, Figma, Microsoft, HubSpot y LinkedIn) agrupados por categoría con filtros, buscador y panel de detalle por conexión (estado, redirect URI copiable, scopes y credenciales BYOK). OAuth propio del usuario (PKCE o client_secret según el proveedor); los tokens se cifran con DPAPI/safeStorage y se espejan a un vault sellado en el backend. Los tokens se refrescan de forma autónoma al caducar.
- **Proveedores**: nueva sección Proveedores, independiente de Conexiones, con catálogo BYOK (OpenAI, Anthropic, Ollama). La API key y la base URL se guardan en el mismo vault sellado y nunca vuelven al renderer (solo enmascarada); «Probar» sondea el endpoint de modelos y muestra el conteo. El catálogo `shared/ai-providers-catalog.json` es extensible por specs.
- **Proveedores IA, modelos personalizados**: puedes añadir cualquier servicio compatible con OpenAI (Chat Completions) o Anthropic Messages con nombre, dirección base, modelo y clave opcional. Su spec y su clave se sellan juntos en el vault local, la clave nunca vuelve al renderer y el modelo queda disponible en el Agente y en los pasos de IA como un proveedor más. Se puede editar sin reescribir la clave, probar la conexión y eliminar.
- **Agent**: apartado propio en el riel, con un espacio de conversaciones que usa el proveedor IA configurado (la clave sale del vault y nunca llega al renderer) y tool-calling sobre los métodos del backend: los de solo lectura (`orchestratable`) se ejecutan directo y cualquier otro método pausa el turno en una tarjeta de aprobación Aprobar/Rechazar. Soporta protocolos OpenAI chat (también Ollama) y Anthropic Messages; las conversaciones y aprobaciones se persisten en datos de usuario. La interfaz rediseñada muestra una barra de conversaciones con buscador y avatares propios por sesión, el chat con encabezado de conversación, las llamadas a herramientas como pasos con su estado, el tiempo del turno en curso y sugerencias de inicio; las capacidades reales del agente (`agent_tools_list`) se consultan desde el encabezado. El composer admite encolar follow-ups mientras el turno sigue en curso (se envían solos al terminar), el borrado de conversaciones pide confirmación y la lista muestra la antigüedad y el último error de cada conversación.

### Changed
- Agent muestra cada turno como un único bloque: el avatar una sola vez, el trabajo plegado en una línea («Trabajó durante 42 s · 6 pasos», con los iconos de las herramientas y «N por revisar» si algo falló) que se abre en vivo mientras trabaja, y la respuesta final debajo. Los textos intermedios pasan a la actividad. La terminal es una tarjeta con carpeta, estado y código de salida, y las skills muestran su nombre. Los resultados aparecen en el turno que los produjo, sin repetir un mismo archivo; cada turno muestra los dos más recientes y pliega los anteriores, en una tarjeta compacta con vista previa y acciones con icono.
- La tarjeta de aprobación de Agent queda más limpia: icono sin recuadro, estado y canal en una sola línea, comando y datos en un único bloque, aviso del shell con icono, explicación de alcance dentro de «Detalles» y pie sin separador con las reglas del chat como texto y «Permitir» alineado a la derecha.
- El menú de permisos de Agent se simplifica: solo muestra los tres modos con descripciones de una línea y un check en el activo, en un panel más estrecho. La edición de reglas por canal sale del menú; las reglas guardadas siguen aplicándose y las tarjetas de aprobación pueden crear reglas nuevas.
- El compositor de Agent queda más limpio: el selector de permisos pasa a la barra inferior y se reduce a icono en paneles estrechos, desaparece la pista de Mayús + Intro y el recibo «Mensaje recibido» solo se anuncia a lectores de pantalla porque el mensaje ya aparece en la conversación.
- La barra lateral adopta un riel neutro y limpio: íconos más grandes y espaciados, botón activo sin borde, avatar de color y sin separadores. El panel flotante deja el mismo margen en todos sus lados y su redondeo es concéntrico con el marco del contenido.
- Agent simplifica los textos de envíos y aprobaciones, conserva sus detalles accesibles y unifica los márgenes del historial, el compositor y sus controles.
- **Agent**: durante un encargo, «Indicar ahora» envía una corrección y confirma su recepción cuando el motor la admite; «Dejar para después» conserva la cola. Una corrección rechazada mantiene el borrador, los adjuntos y el turno anterior; las aprobaciones pendientes solo se rechazan después de registrar la nueva indicación.
- El navegador del Agent queda al ras del chat y del área de trabajo, sin marco interior ni esquinas redondeadas.
- La lista de conversaciones muestra títulos en una sola línea, sin avatar ni metadatos secundarios; los avatares de navegación quedan en la sección Agentes.
- La barra lateral de agentes se puede ocultar y volver a mostrar, ya no tiene borde redondeado y el buscador ocupa toda la fila al abrirse; Ctrl+K vuelve a abrirla para buscar.
- El chat simplifica sus controles de navegación, muestra las respuestas sin burbujas y da más espacio al campo de mensaje, con superficies y foco visual unificados.
- El marco de navegación distingue el riel lateral, la barra superior y la franja inferior mediante fondos, con esquinas redondeadas a la izquierda delineadas por un contorno sutil y el lateral derecho al ras de la ventana; los controles de ventana ocupan una cabecera compacta de ancho completo.
- **Agent**: mientras una herramienta está en curso ya no se repite debajo la fila «El agente está trabajando»; vuelve cuando el modelo retoma el turno.
- **Agent**: un comando o cualquier herramienta en curso muestra los segundos que lleva ejecutándose; los comandos, al terminar, su duración.
- **Agent**: en la consola de un comando, las líneas de stderr y el error de la herramienta se muestran en rojo, separadas de la salida normal.
- **Agent, caché del modelo**: la caché del prompt dura 1 hora en Anthropic y 24 horas en OpenAI/OpenRouter, así que una aprobación o una pausa larga ya no obliga a reenviar la conversación entera a precio completo; los endpoints compatibles no reciben la opción. Claude a través de un proveedor propio de OpenRouter ahora marca la caché igual que el proveedor OpenRouter integrado. Con Claude Opus y Sonnet 5.5 en la API oficial, las herramientas que el agente carga a mitad de conversación (`tools_load`, `@módulo`) se añaden sin cambiar la lista ya enviada, así que el prefijo sigue en caché.
- **Agent**: incorpora un selector de permisos por conversación con Solicitar aprobación, Aprobar por mí y Acceso completo. El último ejecuta sin confirmaciones y conserva los límites de archivos y herramientas habilitados.
- **Agent**: la salida de los comandos de terminal se ve en vivo mientras se ejecutan, línea a línea, en vez de aparecer solo al terminar; pi-durable la conserva como progreso de la herramienta.
- **Agent**: la salida de un comando terminado y la entrada y salida de cada herramienta se copian con un botón que aparece al pasar el ratón.
- **Agent**: la salida de los comandos de terminal se abre desplazada al final, donde suelen estar el error o el resumen, y sigue al final mientras llegan líneas nuevas.
- **Agent**: el estado de trabajo es una fila de traza con brillo y tiempo, y la confirmación de acciones es un elemento compacto (icono de la herramienta, pregunta, datos y Rechazar/Aprobar a la derecha) alineado con los pasos.
- **Agent**: el cuadro de mensaje es una sola fila limpia (adjuntar, texto y enviar con Intro) y el modo de aprobación, el modelo y el contexto usado pasan a una línea discreta debajo; la conversación y el cuadro ocupan una columna centrada más estrecha, cada herramienta es una fila compacta que se despliega para ver su resultado y las sugerencias son más ligeras, se muestran en una sola línea que se desliza en bucle hacia la izquierda (se pausa al pasar el ratón o al enfocarlas), entran con una animación escalonada y se pliegan mientras escribes; el plan del agente se muestra como una traza plegable («Plan: … · N de M hechos») con una línea guía, un icono de círculo por estado y el paso en curso resaltado con un brillo animado; los pasos de herramientas siguen el estilo de las tareas (icono de estado, título y chevron que se despliega bajo una línea guía) y las consecutivas se agrupan como una lista compacta; los comandos de terminal se muestran como «Ejecutando …» con brillo y la salida en un recuadro de consola que aparece línea a línea con cursor parpadeante, y al terminar como «Ejecutó …» con su duración y el código de salida si falló; cada herramienta muestra un icono de su tipo, su argumento clave (ruta, URL, búsqueda…), la línea en rojo si falla, las rechazadas sin desplegable y, al abrirla, su entrada y su salida en bloques de código.
- **Proveedores IA**: lista compacta con modelo y estado visibles; la configuración se despliega por proveedor, conserva los borradores al cambiar de servicio y agrupa las ayudas para reducir el espacio ocupado.
- **Agent**: el chat muestra el razonamiento del modelo en un bloque plegable «Pensando…» / «Pensó durante N s» que se abre mientras el modelo piensa y se pliega al empezar a responder; el usuario puede abrirlo o cerrarlo. Los modelos con razonamiento conocido (Claude 3.7 y 4+, DeepSeek R1/reasoner, Qwen3/QwQ, gpt-oss) piden esfuerzo bajo; el resto de modelos no recibe parámetros nuevos. El texto de la respuesta se ve en directo mientras se genera.
- **Agent**: las confirmaciones de acciones con efectos pasan a una tarjeta compacta que pregunta por la acción concreta («¿Ejecutar …?»), lista los datos a revisar y ofrece Rechazar / Aprobar a la derecha, siguiendo el patrón Confirmation de shadcn.
- **Agent**: sugerencias de un clic junto al composer, con botones compactos y desplazamiento horizontal con desvanecimiento, siguiendo el patrón Suggestion de shadcn. Permanecen disponibles en conversaciones existentes y se deshabilitan mientras el agente trabaja.
- **Agent**: chat más despejado con paneles suaves y avatares con rostro; selector de modelos con teclado que cambia el proveedor y modelo para los siguientes mensajes del mismo chat. Agentes y subagentes se animan durante la ejecución, con estados de cola y resultados diferenciados y soporte de movimiento reducido.
- **Canvas**: las guías de alineación abarcan los objetos alineados y muestran marcas en sus extremos; Ctrl+D repite el desplazamiento de la última copia, Shift+=/- cambia el zoom y las flechas desplazan la vista cuando no hay selección. Los gestos actualizan las capas por DOM sin reconciliar toda la lista en cada frame.
- **Interfaz**: se retiran textos de ayuda en Mis tareas y el mapeo de Formatos.
- **Optimizador de imágenes**: interfaz rediseñada en tres paneles planos (ajustes, vista previa y cola) sin tarjetas anidadas, con presets en un selector segmentado, controles de 36 px, texto más legible y acciones de la cola visibles al pasar el cursor.
- **Apariencia**: los estilos predefinidos pasan de 47 a 14. Se retiran los presets claros (en modo oscuro se veían claros), los de acento neón o casi blanco que dejaban el riel ilegible en modo claro, los que teñían el texto secundario del panel y los que apagaban los iconos del riel. El tema por defecto pasa de Vanta Black a Slate Modern. Los 14 restantes cumplen mínimos de contraste (texto secundario ≥ 4.5:1, terciario y acento ≥ 3:1, iconos del riel ≥ 3:1) y su texto secundario es neutro en lugar de teñido. En modo claro los grises son más oscuros y un acento que no llega a 3:1 sobre el fondo se oscurece al pintarse, sin cambiar el color guardado.
- **Barra lateral**: nuevo riel con los grupos General, Producción, Reportes y Herramientas, teñido con el acento del tema de Apariencia; al pasar el cursor por un grupo se muestra su panel flotante y se puede fijar (botón o `Ctrl+B`) para dejarlo unido al layout. La campana de notificaciones y el menú de cuenta (Cuenta, Configuración, Cerrar sesión o Iniciar sesión) pasan al riel; la barra de título se integra en la tarjeta de contenido con controles de ventana rediseñados y sin el botón de Configuración.
- **Barra lateral / Agent**: el icono de Agent abre su apartado directamente y deja de mostrar el panel al pasar el cursor o al hacer clic; el resto de grupos del riel conserva su comportamiento.
- **Rendimiento backend**: las dependencias pesadas (WeasyPrint, pandas, openpyxl, PyMuPDF, python-docx) se precargan en segundo plano tras el arranque y el primer render de PDF/exportación ya no paga 1-3 s de imports en frío; `diagnostics_snapshot` deja de ejecutarse en el hilo que parsea las requests IPC.
- **CI**: `review-policy` avisa cuando un PR supera 400 líneas efectivas sin marcador `cambio amplio:` en el cuerpo ni etiqueta `size/exempt`.
- **Política de revisión**: se retiran los modos `--fail-on`/`--enforce` sin consumidor y los ítems de la plantilla de PR que la máquina ya audita (tamaño, archivos nuevos, tests). Los checks y el veredicto no cambian.
- **Métricas de revisión**: el tamaño mediano usa la misma definición que la política —excluye lockfiles y archivos generados, pidiendo el detalle de archivos solo de los PRs que pasan de 400 líneas— y el objetivo de taxonomía se deriva de `TAXONOMY_TARGET` en lugar de estar duplicado. El tiempo hasta la primera revisión y la tasa de rubber-stamp excluyen los PR abiertos en borrador, que medían desde la creación y castigaban al autor por tenerlos abiertos. Las rondas de retrabajo deduplican por revisor en lugar de contar cada review, y el pie del informe lista los siete objetivos derivados de las métricas.
- **Loops de push y pr-fix**: `commitAll` commitea el índice cuando hay archivos stageados en lugar de barrer todo el worktree con `git add -A`, y `pr-fix:ship` aborta si el worktree trae cambios anteriores a sus heurísticas.
- **Política de diffs**: `AGENTS.md` endurece la regla de cambios mínimos — subordina cualquier skill instalada, permite enmendar la lista de archivos declarada, exige persistir la declaración `cambio amplio:` en el commit o PR, documenta que `push:ship`/`pr-fix:ship` stagean todo el worktree y precisa las acompañantes permitidas.

### Removed

### Fixed
- La lista de herramientas de un agente guardado limita su conversación en todo momento: `tools_load`, las menciones de módulos y la selección manual ya no la amplían, restablecer la selección vuelve a las herramientas del agente y una herramienta retirada de su ficha deja de ejecutarse en las conversaciones existentes.
- «Recordar» en una aprobación de Agent ya no se ignora fuera de las acciones web: en las herramientas de backend guarda la regla Permitir del canal en la conversación y en las apps de Windows concede la app como «Siempre esta app». Solo se guarda si la acción quedó aprobada y un fallo al guardarla no anula la aprobación.
- El navegador del Agent espera de forma acotada antes de abrir una página o volver atrás cuando el usuario acaba de usar la suya, muestra la espera con cuenta atrás y permite liberarla. Un fallo transitorio ya no consume el freno de repeticiones: las lecturas y observaciones avanzan cuando cambia el resultado, los clics que cambian de página también progresan, los errores recuperables no consumen intentos, otros efectos con aprobación conservan su límite y una corrección o un mensaje nuevo reinician el freno y la pausa de actividad. `web_open` rechaza nombres de archivos locales y remite a `fs_read`.
- Agent conserva la prioridad de las skills adjuntas aunque el catálogo compartido esté lleno; la identidad del perfil se propaga como metadato de ejecución y las pruebas de skills usan el entorno Python seleccionado por `uv`.
- Se actualizan DOMPurify a 3.4.17 y Brotli a 1.2.1 para corregir las vulnerabilidades que bloqueaban la auditoría de dependencias.
- Agent explicita la prioridad del pedido actual sobre las indicaciones del agente y las preferencias de memoria. El editor y la memoria muestran el alcance por perfil y los recuerdos globales heredados; editar un perfil informa que afecta a conversaciones nuevas. La guía distingue cambios puntuales y preferencias duraderas, conserva las correcciones humanas y responde de forma natural ante saludos y ayuda vaga.
- Agent destaca la aprobación, pregunta, actividad o resultado que requiere atención junto al composer, anuncia cada evento una sola vez y permite ir a sus detalles sin interrumpir la lectura del historial. Conserva los detalles abiertos durante las actualizaciones y respeta movimiento reducido al desplazarse.
- Agent permite iniciar una conversación con el primer mensaje, conserva el borrador si falla la creación y reutiliza la identidad del envío al reintentar texto o sugerencias. Evita envíos simultáneos y avisa cuando no pudo actualizar el estado del chat.
- **Agent / delegación**: una respuesta del subagente que llega después de Detener no se guarda como exitosa, tampoco si termina su último paso de herramientas.
- **Agent / ciclo del turno**: una respuesta correcta limpia el estado de error actual sin borrar el historial y conserva la recuperación al reiniciar. Detener una herramienta en espera solicita una sola cancelación; las aprobaciones y los sondeos liberan sus listeners y esperas al terminar.
- Agent presenta las aprobaciones con el comando completo, contexto y acciones separados; indica cuándo registra la decisión y evita envíos duplicados. Las trazas conservan la apertura elegida, muestran los errores y respetan la posición de lectura del terminal, con menos animación durante la ejecución.
- Agent conserva la señal de error al resumir resultados largos, distingue los reintentos con adjuntos diferentes e impide que una delegación en entrega reactive una conversación detenida o eliminada.
- Agent detiene el motor al alcanzar 40 rondas, conserva el presupuesto del encargo en SQLite al reiniciar y permite reanudar con un presupuesto nuevo. La recuperación espera a restaurar herramientas y proveedores necesarios; una apertura fallida se puede reintentar sin consumir el trabajo pendiente. La bandeja sigue el estado de los turnos recuperados desde el arranque.
- DOMPurify se actualiza a 3.4.17 para resolver los avisos de seguridad que bloqueaban la auditoría Node. La prueba de ordenamiento del editor usa fechas controladas y cubre ambos órdenes sin depender de la velocidad del equipo.
- Las pruebas que simulan procesos del backend interceptan `taskkill` para que sus PID ficticios no terminen procesos reales de Windows.
- **Seguridad de PDF**: `pypdf` requiere 6.21.1 o superior y el lockfile fija esa versión para corregir CVE-2026-113786, que bloqueaba la auditoría de CI.
- **Agent / detener**: una herramienta detenida a mitad aparece como interrumpida (no como fallida) y conserva la salida que llevaba, sin los avisos internos del motor.
- **Rendimiento y capacidad**: Canvas descarga documentos por grupos y conserva el progreso si falla alguno; Canvas y Espacios paginan los listados completos. Las capas Boolean reutilizan índices al comparar dependencias. Exportaciones y efectos del editor comparten el scheduler pesado; IPC admite solicitudes antes de serializarlas, limita los bytes pendientes y respeta la contrapresión. El catálogo JSON evita escrituras idénticas y las métricas offline distinguen las estimaciones del transporte medido.
- **Agent / navegador integrado**: solo se muestra en su panel dentro de Agent. La navegación principal lo retira al abrir cualquier otra pestaña y al iniciar fuera de Agent, incluso si quedó acoplado tras una recarga de la interfaz. La ventana auxiliar queda transparente, sin interceptar clics; la página y su sesión se conservan al volver a Agent.
- **Agent / identificadores de herramienta**: ya no reutiliza la aprobación ni el resultado de una llamada anterior cuando el proveedor repite identificadores entre turnos (por ejemplo `call_0`) o los deja vacíos.
- **Editor multimedia**: el guardado conserva las ediciones realizadas durante una escritura, serializa las revisiones y detiene los reintentos automáticos tras un error. El cierre espera los guardados pendientes y mantiene la aplicación abierta si fallan. La exportación enlaza correctamente la cancelación al trabajo, interrumpe el proceso de render y elimina las salidas parciales.
- **Optimizador de imágenes / guardado atómico**: los nombres de archivo guardados se sanean con la misma autoridad que el resto del producto —incluidos los nombres reservados de Windows como `CON` o `AUX`, que ya no se escriben con nombre inválido— y la escritura atómica hace `fsync` antes de publicar, como el guardado de configuración.
- **Canvas / sincronización**: los envíos pendientes se conservan hasta la respuesta del servidor, recuperan la versión local más reciente y se descartan al borrar el documento. Un fallo de localStorage no bloquea el envío en memoria.
- **Agent / estándares**: la retirada de Flujos conserva los archivos que no sean PDFs de un productor registrado, los PDFs reutilizados y las salidas sin procedencia comprobable; también conserva la carpeta de estado si contiene una salida pendiente. El esquema de actualización de tareas de Espacios exige la revisión consultada.
- **Retirada de Flujos**: el manifiesto se guarda antes de eliminar tareas o archivos y permite continuar tras un fallo, conservando los recursos pendientes. Un error al borrar una tarea de Windows aplaza la retirada sin perder su estado.
- **Aprobaciones de Agent**: se vinculan al contenido del archivo, destino, cuenta, permisos y versión de herramienta. Los cambios invalidan la aprobación; la tarjeta muestra la cuenta y los recursos afectados, y dos solicitudes concurrentes comparten una sola aprobación. Los errores del proveedor y los metadatos/resultados MCP ocultan las credenciales configuradas.
- **Seguridad de dependencias**: `pypdf` sube de 6.16.2 a 6.20.0 para cerrar PYSEC-2026-4155 a PYSEC-2026-4159; la auditoría Python ahora revisa las versiones exactas de `uv.lock` en lugar de resolver unas nuevas, por lo que ya no los pasaba por alto.
- **Política de revisión**: cuando GitHub no calcula el diff (demasiado grande) la auditoría ya no lo trata como «0 líneas»: tamaño y alcance se omiten y el informe lo declara en lugar de afirmar un diff vacío. El check de riesgo exige una casilla marcada dentro de la sección `## Risk` (antes bastaba cualquier casilla del cuerpo). Los PR de bots y los diffs que solo tocan lockfiles o snapshots dejan de bloquear por falta de intención. Los comentarios del propio autor ya no cuentan en la taxonomía de revisión. La severidad de cada check ya no cambia con su estado, la paginación de la conversación avisa cuando trunca en vez de calcular un ratio a medias, un archivo sin `status` ya no parece nuevo y el informe no se publica si el PR avanzó mientras se auditaba.
- **Proveedores IA**: OpenAI Chat Completions y Anthropic Messages acumulan streaming de texto y herramientas; las respuestas incompletas o inválidas fallan con mensajes controlados, los errores ocultan la clave y la sonda de modelos limita el tamaño de respuesta.
- **Mensajes de error de herramientas**: `EvidenciaVolanteoError` y `PanelAvisoCorteError` derivan ahora de `ValueError`, así que la UI vuelve a mostrar el texto propio de la herramienta en lugar de "Error interno del servidor".
- **Canvas / pegar**: pegar una capa que todavía estaba en el documento duplicaba el id y terminaba borrando la capa original; el portapapeles se re-keyea antes de clonar.
- **Canvas / export CMYK**: con páginas pareadas el tope de 200 páginas multiplicaba contextos × páginas y rechazaba exportaciones que el renderer resuelve en una página por contexto.
- **Canvas / atajos**: `Ctrl+Shift+D` duplicaba capas además de abrir Ajustes, porque el atajo de duplicación comparaba `e.code` en lugar de `e.key`.
- **Formatos**: desactivar un formato builtin se perdía al reiniciar y el formato volvía a estar disponible.
- **Hojas de cálculo**: los CSV que Excel en español exporta con `;` se leían como una sola columna y los guardados en ANSI de Windows fallaban; el delimitador y la codificación se detectan ahora sobre un muestreo del archivo.
- **AutoIMG**: al quitar una carpeta quedaba la última fila repetida en la hoja FOLDERS y reaparecía en la lectura siguiente.
- **Panel Aviso de Corte**: con «Incluir vacíos» las filas sin imágenes quedaban todas al principio del documento en lugar de seguir el orden de la planilla.
- **Volantes**: un segundo clic en «Exportar todo» lanzaba una exportación simultánea, con PDF, descarga y entrada de historial duplicados.
- **Conversión**: si el trabajo moría a mitad se descartaban los archivos ya convertidos y el resultado reportaba cero correctos; ahora se informan los realmente procesados.
- **Informes v2**: una columna «Impulsion» escrita a mano alimentaba la sección de línea de rebombeo y vaciaba la de válvulas; el alias sin prefijo se retira porque las cabeceras reales ya lo llevan.
- **Números de planilla**: `1.250` se truncaba a 1 y `12,5` se leía como 0; el punto de miles y la coma decimal de la notación en español se normalizan antes de convertir.
- **Importación CSV**: una raya o una comilla tipográfica en cp1252 quedaba guardada como carácter de control, porque latin-1 decodifica cualquier byte; cp1252 se intenta primero en fichas técnicas e informes.
- **Formatos / mapping**: un `page` negativo o un `padding` desmesurado reventaban el render o generaban nombres de archivo de un millón de caracteres; el mapping se valida al guardar y un PDF de cero páginas se rechaza antes de generar.
- **Espacios / notificaciones**: la campana de tareas vencidas se rellenaba con datos de la sesión cerrada; el hook se desactiva junto a la sesión y descarta la respuesta que estuviera en vuelo.
- **Conversión / cancelar**: un fallo del IPC de cancelación cortaba el flujo y dejaba la UI con un estado obsoleto; ahora se consulta el estado real al `pollStatus` siguiente.
- **Espacios / deshacer**: recuperar una tarea borrada la pintaba en el proyecto visible en lugar del proyecto de origen, y llegaba a recargar la lista del proyecto equivocado.
- **Reportes de campo**: un panel en espera de guardado se escribía en la plantilla nueva aunque la carga lo hubiera reemplazado, y un guardado fallido dejaba el panel marcado como limpio sin reintento.
- **Preview de reportes**: un `{%` literal dentro del texto borraba todo el contenido hasta la etiqueta siguiente.
- **Staging de archivos**: `file_staged_abort` cancelaba la sesión de otra ventana; el token queda ligado a la ventana que lo creó.
- **Canvas / PDF**: la importación rechaza documentos con más de 500.000 operadores acumulados, aunque cada página permanezca bajo su límite individual.
- **Espacios / tablero**: arrastrar una tarjeta hacia abajo dentro de su propia columna no cambiaba el orden persistido y la tarjeta volvía a su sitio; el valor se calcula ahora con la misma convención que aplica el tablero. La recarga de la actividad de una tarea deja prevalecer los datos del servidor.
- **Diálogos**: cerrar con `Escape` o clic en el fondo dejaba colgada la promesa de `confirm`, de modo que la acción que la esperaba (por ejemplo, salir de una vista con cambios) no volvía a responder; toda salida resuelve ahora la espera.
- **Atajos**: `Ctrl+0`, `Ctrl+Shift+I` y `Ctrl+Shift+V` ejecutaban a la vez su acción de Canvas y la navegación del shell; Canvas reclama solo esos chords mientras está activo (el resto de atajos del shell siguen funcionando) y el shell deja de disparar atajos con un modal abierto.
- **Cierre de la app**: el acuse del flush de Canvas podía quedar sin suscribir mientras cargaba su chunk y detenía el cierre; ahora solo acusa App cuando Canvas no es dueño del flush, para que el acuse llegue después de guardar.
- **Evidencia de volanteo**: un fallo de lectura de IndexedDB desactivaba el autoguardado durante el resto de la sesión y la última edición se descartaba al desmontar; ahora se conserva el trabajo y el estado se muestra junto a exportar.
- **Padrón**: la exportación PDF no capturaba errores (el botón volvía a su estado sin avisar) y los campos de fecha no tenían nombre accesible; el modal de importación gana diálogo, foco y `Escape`.
- **Informes v2 / Preview de reportes**: la exportación de una sola fila saneaba el HTML de la plantilla igual que la consolidada, y generar un PDF sin contenido deja de reportar éxito sin archivo.
- **Reportes de campo**: los campos usaban la etiqueta como único nombre accesible, la carga de paneles fallaba en silencio y el derivado de esquema antiguo rompía la restauración.
- **Optimizador**: `ThemeSelect` anunciaba un listbox sin teclado y el recorte gana diálogo, `Escape` y ajuste con flechas.
- **Notas adhesivas**: los controles por nota no eran alcanzables por teclado, el guardado podía perderse al cerrar y las pilas se apilaban siempre por encima de las notas libres.
- **Sellador**: mover y redimensionar el sello solo era posible con ratón; el panel gana campos numéricos de posición y tamaño.
- **Volantes**: la selección de registros y los controles de formato no eran operables por teclado ni anunciaban su estado.
- **Gantt / Historial**: las tareas sin fecha se anclaban al día UTC de creación y la búsqueda del historial solo filtraba las páginas ya cargadas.
- **Exportación PNG de Canvas**: los tres caminos de exportación fallaban en silencio; ahora el panel y la selección muestran el error y la paleta de comandos lo registra en observabilidad.

### Security

- **Procesamiento de PDF**: `pypdf` requiere 6.20.1 o superior para corregir CVE-2026-113792 y CVE-2026-113793, detectadas por la auditoría de dependencias.
- **Procesamiento de imágenes**: Pillow sube a 13.0.0 para corregir las vulnerabilidades detectadas por la auditoría Python. El backend requiere Python 3.11 o superior; CI y empaquetado usan ese mínimo.

## [0.11.12] — 2026-09-16

### Added
- **Canvas / guías**: las guías creadas desde las reglas hacen snap a los rieles de alineación; `Alt` durante la creación o el arrastre muestra distancias a la página y a los objetos cercanos; `Alt+arrastrar` sobre una guía la duplica; las guías se mueven con flechas (⇧ = 10 mm, Alt = 0.1 mm) y se eliminan con `Supr` o el menú contextual.
- **Canvas / presets**: nueva plantilla «Informe limpieza reservorios» (formulario tabulado, categoría reservorios).

### Changed
- **UI**: se retira la paleta de comandos (`Ctrl+K`); los atajos de navegación siguen activos y `navigation.ts` deja de publicar metadatos de atajos sin consumidor.
- **Espacios**: el selector de persona asignada usa el picker temático compartido; `SelectPicker` gana la variante `md`.
- **Informes técnicos**: el filtro por C.S. usa `ThemedSelect`.
- **CI**: `review-policy` audita intención del cuerpo, tamaño efectivo y archivos nuevos con un único comentario auto-actualizado; también se dispara al editar la descripción o las etiquetas del PR.

### Fixed
- **Canvas / historial**: los nudges de teclado (capas y guías) se coalescen en una sola entrada de undo por gesto, como drags y resizes.
- **Preview de reportes**: las object URLs de imágenes se regeneran solo cuando cambia la entrada; la vista previa ya no puede renderizar URLs revocadas.
- **Popovers**: `useAnchoredPopover` descuenta el margen del viewport en `maxHeight`; `TemplatePicker` admite `direction="down"` para no voltear el menú cuando hay espacio.

## [0.11.11] — 2026-09-14

### Added
- **Canvas / cloud**: tope de 16 MiB por documento, cuota de almacenamiento en la base y retención de versiones (50 por documento / 90 días).
- **Canvas / PDF**: importación de PDFs externos como capas editables cuando su semántica es reconocible (texto, rectángulos, elipses, líneas, imágenes y checkboxes), con preflight, progreso, cancelación, límites de rendimiento e informe de contenido omitido.
- **Canvas / PDF round-trip**: manifiesto semántico embebido en exportaciones RGB y CMYK para reconstruir páginas, capas, estilos y referencias `canvas-asset:` cuando los assets locales están disponibles.

### Changed
- **IPC / catálogo**: `shared/ipc-method-catalog.json` es la única fuente por método (handler, lane del scheduler, tier de timeout, idempotencia, file-tokens, raw output path); el router, la allowlist, `api.ts` y el backend consumen proyecciones del mismo. Sustituye a `heavy-ipc-methods.json`, `long-running-methods.json`, `IDEMPOTENT_METHODS`, `READ_FILE_TOKEN_SCHEMAS` y las tablas de routing `_EXACT_MODULE`/`_PREFIX_MODULE`.
- **Persistencia**: fichas técnicas, informes v2 y reportes técnicos guardan en el directorio de datos de usuario también en desarrollo, no en `data/` empaquetado.
- **Reportes de campo**: acciones de panel en grid, con estado de exportables y foco visible.
- **UI / diálogos**: se quita el halo extra de Dialog, Settings, paleta de comandos y modales equivalentes.
- **Rendimiento Canvas**: PDF.js se carga de forma diferida y Canvas indexa las capas por página; la apertura inicial no incorpora el vendor pesado.
- **Canvas / inspector**: paneles al estilo Figma, valores mixed en selección múltiple, lista de capas virtualizada y chrome de selección.
- **Canvas / edición inline**: doble clic posiciona el caret y selecciona la palabra bajo el cursor (estilo Figma), `Ctrl+B/I/U` alternan negrita/cursiva/subrayado de la capa sin salir de la edición, `Ctrl+Enter` confirma, `Tab` mantiene el foco y el auto-fit de altura incluye el padding de la caja.
- **UI**: `SegmentedControl` compartido entre Ubicaciones y el resto de vistas; paneles flotantes de volantes extraídos a un hook.
- **UI / toasts**: píldora compacta bajo la titlebar; Image Optimizer y Apariencia usan el toast global, con copias en es/en.
- **Informes v2**: la preview muestra la plantilla en blanco si no hay informe seleccionado.
- **CI**: action `setup-ci` compartida; Node se lee de `.node-version`.
- **Sellador / preview**: el raster se codifica con JPEG (PIL q85) en lugar del PNG de MuPDF. El floor de 220 DPI no cambia; Formatos sigue en PNG. A4 con contenido (n=16): p50 187,5 → 58,8 ms (-68,6%); p95 217,1 → 64,1 ms (-70,5%). IPC `sellador_render_page` (n=20): p50 35,7 → 14,0 ms; p95 45,9 → 15,7 ms. `inspect_pdf_path` mide con PyMuPDF.

### Fixed
- **IPC / timeouts**: `canvas_export_cmyk_pdf` (lane heavy del backend) pasa de 300 s a 900 s en el bridge, alineado con el resto de renders pesados como `html_to_pdf`.
- **IPC / escritura**: todas las claves de salida presentes (`output_path`, `outputDir`, `destino`, …) se validan contra roots/tokens de escritura; un señuelo autorizado ya no puede sombrear un destino no autorizado en `process_start`.
- **Canvas / sync**: si falta `canvas_append_document_version`, el push falla a la vista en vez de insertar a ciegas.
- **Canvas / sync**: un conflicto del sync general se descarta si el documento activo cambió durante el sync; resolverlo ya no puede borrar o reemplazar el documento equivocado.
- **Canvas / blobs**: `clearBlobStore` respeta los pins activos durante save y quit-flush; una limpieza concurrente ya no deja referencias `blob:` muertas en el documento persistido.
- **Stores JSON**: `get_all`/`get` devuelven copias JSON desacopladas sin re-normalizar en lectura; el listado de informes (~132 ms @1000 docs) baja a ~53 ms manteniendo el aislamiento y el commit atómico.
- **Catálogo SQLite**: espera 30 s en `busy_timeout` ante un lock corto.
- **Tooltips**: portal `fixed`, clamp al viewport y flip de placement para que el label no se corte en el borde de la ventana.
- **Apariencia**: los avisos de guardado/error usan traducciones, no la key i18n.
- **Fichas técnicas**: el modo focus deja el preview a columna completa (clase `is-focus`), sin `grid-template-columns: 0px`.

## [0.11.10] — 2026-08-22

### Added
- **Backend / Store**: implementación genérica y thread-safe de `JsonDocumentStore` con persistencia atómica en disco y recuperación automática de backups corruptos.
- **Preview Panel**: nuevo diseño y controles avanzados en `DataPreviewModal` con búsqueda en tiempo real, filtrado por columnas y formateo estilizado.
- **Testing**: suites de prueba completas para `pdfHelpers`, `FlyerCard`, `themeApplier`, tokenización de resultados IPC, deduplicación de rutas y pruebas estáticas de perf harness.

### Changed
- **Persistencia backend**: migración de las capas de datos de `fichas_tecnicas`, `informes_v2` y `technical_reports` hacia `JsonDocumentStore`.
- **Canvas**: caché de estimaciones de bytes para pasos de historial inmutables (`WeakMap`), evitando serializaciones innecesarias durante operaciones de deshacer/rehacer.
- **UI / Mascot**: movimiento fluido de la mascota mediante loop de animación `requestAnimationFrame` + `translate3d` con protecciones para ventanas en segundo plano y `prefers-reduced-motion`.
- **Electron & IPC**: endurecimiento de comprobaciones de salud en el spawner de backend, handlers de diálogos, resolución de tokens de archivos y optimizaciones en el caché de thumbnails.

### Fixed
- **UI / Temas**: restauración confiable del tema de apariencia guardado al iniciar la aplicación (resuelto a través de `themeApplier`).
- **Padron & Volantes**: correcciones y mejoras en la generación y renderizado de documentos y PDFs.

## [0.11.9] — 2026-08-11

### Added
- **Backend / arranque**: handlers de módulos deferred (ubicaciones, sellador, …) se resuelven **en el worker**, nunca en el reader de IPC — `get_loaded`/`is_known` separan "ya cargado" de "importable", y un import de ~120-450 ms ya no congela health probes.
- **Scheduler**: cola light acotada (mín. 16, 4× workers) con `SchedulerBusy("light_queue_full")` y `.reason` expuesto; `_light_queue_default` compartido entre detección y constructor.
- **Ubicaciones**: límites de zoom de previews, cierre de imágenes y cap de páginas consolidadas.

### Changed
- **Cold start**: db_import con openpyxl streaming (`read_only` + `iter_rows`) — sin materializar DataFrames completos (13,6 s → 218 ms en frío); import local de pandas en ubicaciones con detección `_is_na` sin dependencia top-level.
- **Export PDF**: pool de BrowserWindows persistentes + tokens de logo locales; caché CMYK de imágenes.
- **Conversión**: fast-path de copia byte-idéntica JPEG→JPEG (6,5-15,5× más rápido).
- **Electron IPC**: buffer cap de stdout en el backend + validación de escritura en ipc-router; allowlist única de métodos nativos en `ipc-methods.js`; temp files seguros para payloads inline b64.
- **Canvas**: geometry contract único para drag/rest/export; lifecycle de documento compartido (`saveCurrentDocument` + `replaceGuarded`); `imageNameCandidates` unifica la regla base/numérico.
- **Templates**: grid adaptativo en report.html por conteo de imágenes; template de aniegos con título "PANEL FOTOGRÁFICO", label SGIO y estilo actualizado.

### Fixed
- **Preview**: TemplatePicker ancla el menú junto al trigger con listas largas (medía el menú sin `maxHeight` y quedaba en top=8px).
- **Tipado / lint**: mypy en `wb.active` (puede ser None) y en el warm de `write_pdf_sanitized`; spec compartido del sanitizer HTML (Node + Python).

## [0.11.8] — 2026-08-07

### Added
- **IPC / Canvas assets**: almacén en disco con refs `canvas-asset:` (sha256), GC de huérfanos con grace period, y staging binario de archivos (`stageFileForIpc`) sin base64.
- **Spreadsheet**: spill a JSON temporal cuando el parse supera 512 KiB, con `result_file_token`, hydrate opt-in y `spreadsheet_get_rows` paginado (Preview carga hoja a hoja).
- **Logging**: telemetría persistente del proceso Electron en `%LOCALAPPDATA%/Antares/logs`.

### Changed
- **Cold start**: backend PyInstaller en modo **onedir** (COLLECT); warm de canvas/conversion y WeasyPrint post-`ready`; Auth/i18n diferidos; budgets de shell/canvas en el build Vite.
- **PDF**: `html_to_pdf` siempre escribe a disco + `file_token`; `pdf_base64` solo con `return_base64: true`.
- **IPC stdout**: framing NDJSON sobre `Buffer` (sin concatenar strings UTF-16).
- **Canvas CMYK**: export manda refs `canvas-asset:` / paths; el renderer Python resuelve assets y `data:` sin inflar el payload JSON.
- **Preview**: cleanup explícito de spill al cambiar archivo o desmontar (`file_token_cleanup`).

### Fixed
- **Canvas**: RGB/CMYK preparan imágenes antes de export; cloud push falla si quedan `canvas-asset:` sin resolver; historial persiste con warn visible (sin tragar errores).
- **Tipado / lint**: mypy en `spreadsheet_get_rows`; ruff UP035/RUF003; mock de `embedCanvasAssets` en restore de versiones.

## [0.11.7] — 2026-08-06

### Added
- **Technical reports**: el título de las Fichas Técnicas ahora es editable, con default "Villa El Salvador".
- **Preview**: panel de preview unificado reutilizando `TemplatePicker` del tema; previews de mapa servidos vía data URLs compatibles con CSP.

### Changed
- **Conversion**: alineación entre preview y procesamiento real para paridad FE↔BE.
- **AutoIMG**: endurecimiento del aislamiento de sesión y alineación de métricas de sync con el padrón.
- **CI**: pipelines endurecidos y fijados a instalaciones reproducibles; se permite disparo manual (`workflow_dispatch`); resolución de lint (ruff E701/F841/F401), registro de spreadsheet en PyInstaller, y alineación de peers React 18 con Node 22.
- **Rendimiento**: reducción de memoria retenida en Sellador, AutoIMG, Evidencia y Canvas.

### Fixed
- **CI**: fixes de flakes en tests (mock de `spreadsheetParse` en GeneratePanel y PreviewPanel; aislamiento de guards CSS; dedupe de cobertura de sync de canvas).
- **Ubicaciones**: previews alineados con coordenadas del mapa.

### Security
- Remediación de seguridad en preview, capacidades de archivo, confinamiento del backend, xlsx, Supabase, actualizaciones y plugins; resolución de vulnerabilidades npm en root y frontend.

### Removed
- Configuración de Dependabot.

## [0.11.6] — 2026-08-05

### Added
- **Backend / telemetría**: con `ANTARES_IPC_TELEMETRY=1`, cada request IPC emite una línea `ipc_phase` con `msg_id`, lane, latencias por fase (`parse`/`scheduler_wait`/`handler`/`serialize_write`) y snapshots/deltas RSS; fallos de telemetría no afectan el pipe.
- **Canvas**: Inercia de viewport, pinch zoom y Alt-drag duplicate con paridad Figma; abort de gestos stale al cancelar pinch.

### Changed
- **Backend / memoria**: corte de RSS (~67%) y memoria de Canvas; `send_response`/`send_notification` codifican UTF-8 una sola vez y escriben por `stdout.buffer`; jobs completados retienen solo el allowlist de `process_status` (`file_count`/`destino`/`formato`).
- **Formatos / preview**: `max_width` ahora limita el raster sin alterar la respuesta PNG ni los previews de Sellador. En 30 muestras warm comparables a 1200 px, p95 bajó de 62,5 a 37,7 ms (-39,7%) y el delta RSS pico de 13,6 a 6,1 MiB (-55,2%).
- **Panel aviso / WeasyPrint**: `write_pdf_sanitized` reutiliza un `FontConfiguration` por hilo (sin singleton global ni lock). En el rebenchmark IPC completo (93 métodos; “Primera” excluida de percentiles; n=30 heavy), `panel_aviso_corte_render_pdf` bajó de p50 168,8 / p95 297,3 ms a p50 112,7 / p95 168,7 ms (-43,3% p95). Microbench A/B de `write_pdf_sanitized`: p95 75,4 → 52,3 ms (-30,6%).
- **PDF HTML / LRU**: `write_pdf_sanitized` cachea hasta 2 PDFs por `sha256` del HTML sanitizado (máx. 8 MiB/entrada; sanitización y deny-by-default intactos). Contra el baseline fresco del líder (p50 99,2 / p95 122,1 ms, n=30), `panel_aviso_corte_render_pdf` quedó en p50 0,93 / p95 1,50 ms (-98,8% p95) con payload idéntico repetido; confirmación en 2 lotes dentro de ±15%.

### Fixed
- **Backend / IPC**: `ready` se emite una sola vez justo antes del lector stdin (tras `warm_core`, plugins opcionales y scheduler). `warm_deferred` sigue opt-in con `ANTARES_WARM_DEFERRED=1` para no inflar el RSS base; elimina la ventana en que Electron veía `ready` antes de que el bucle IPC estuviera listo.
- **Catálogo**: rechazo del nombre de campo reservado `id` para evitar crash de `init_db` al arrancar el backend.
- **PDF / Sellador**: embebido de imágenes locales con MIME detectado; fallback de path sin inflar el IPC; sellador preserva fallback de path dentro de límites de tamaño.
- **CI**: silencio de mypy `import-untyped` para fuentes WeasyPrint.

### Tests
- Cobertura de inercia de viewport Canvas, pinch zoom y Alt-drag duplicate.
- Cobertura de embed de logos en informes técnicos y preview/export de fichas.

## [0.11.5] — 2026-08-04

### Added
- **Informes v2**: Nuevo módulo con CRUD local, importación desde plantilla Excel, matching de fotos/logos, preview en UI y generación PDF (individual y consolidado).

### Changed
- **Informes técnicos**: Título actualizado a Centro de Servicio Villa El Salvador (dos líneas) en vista previa y plantilla de exportación.
- **Conversión**: Skip de `exif_transpose` cuando Orientation falta o es 1 (~40% más rápido en JPEG verticales).
- **Canvas**: Memo de LayerNode corregido; preservación de blob tras save; coalescencia de pushes cloud por documento.
- **Backend**: Warm solo de handlers core antes de ready; diferimiento de sellador/ubicaciones/fichas hasta después del handshake.

## [0.11.4] — 2026-08-03

### Fixed
- **IPC**: Endurecimiento de manejo de solicitudes IPC — preservación del tamaño completo para líneas IPC sobredimensionadas y recuperación ante solicitudes oversize.
- **IPC**: Validación de entradas IPC con códigos de error estructurados.
- **Persistencia**: Escrituras de archivos destructivos atomizadas para prevenir corrupción.
- **Persistencia**: Preservación de bases de datos JSON corruptas en lugar de descartarlas (fichas técnicas, reportes técnicos, panel aviso corte).
- **Canvas**: Corrección de solapamiento del header del panel derecho.

### Security
- **IPC**: Endurecimiento general del transporte IPC entre Electron y backend (backend, router, main).

### Tests
- Cobertura de recuperación ante solicitudes IPC oversize, validación IPC, persistencia de bases de datos corruptas, y cierre de proceso IPC.

## [0.11.3] — 2026-07-30

### Added
- **Canvas Editor**: Selector de fuentes de Google Fonts estilo Figma con previsualización WYSIWYG en canvas y exportación PDF.
- **Canvas Editor**: Controles tipográficos avanzados estilo Figma (tamaño, peso, interlineado, espaciado de caracteres, alineación y transformación).
- **Canvas Editor**: Sistema de estilos compartidos (estilos de texto y color reutilizables en panel derecho).
- **Canvas Editor**: Guías de alineación y snap con escala constante independiente del nivel de zoom.

### Changed
- **Canvas Editor**: Composiciones de layout A4 mejoradas y ordenamiento de capas refinado.
- **Canvas Editor**: Optimización de rendimiento en arrastre de artboard y cálculo de snap guides.
- **Supabase**: URL dinámica de Supabase en Edge Functions para consistencia multi-entorno.

### Fixed
- **Canvas Editor**: Preservación del marco de rejilla al redimensionar artboards y aislamiento de variables CSS en estilos compartidos.
- **Canvas Editor**: Preservación de `created_by` y corrección del índice de página en sincronización cloud.
- **Canvas Editor**: Endurecimiento de operaciones de página, guardas de grupo, `parentId` huérfanos y triggers de base de datos.
- **Canvas Editor**: Edición de nombre de capas inline pulido en el panel de Capas.
- **Tests**: Corrección del test de coalescencia de `localThumb` con tick de microtask en la suite de integración.

## [0.11.2] — 2026-07-25

### Added
- **Canvas Editor**: Paridad Figma completa con herramienta de línea vectorial (editor de paths, remates de línea, curvar/cortar/lazo), grosor de trazo libre con slider e inserción de último estilo usado.
- **Canvas Editor**: Panel de Capas jerárquico con soporte para operaciones de capas conscientes del contenedor (agrupar, desagrupar, z-index).
- **Canvas Editor**: Auto-grow en vivo para edición de texto inline, soporte type-to-edit, auto-height y coalescencia de undo en modificaciones continuas de propiedades.
- **Reportes Técnicos**: Secciones colapsables y cabecera minimalista compacta para maximizar área de trabajo.
- **Arquitectura / UI**: Root `ErrorBoundary` global, virtualización de listas pesadas, códigos de error IPC estructurados y modularización de `UbicacionesView`.

### Changed
- **Canvas Editor**: Menú contextual pulido, conmutadores y tooltips de barra de herramientas alineados a Figma.
- **Performance**: Eliminación de transferencias base64 redundantes en previews de Ubicaciones y ejecución de `ANALYZE` optimizado tras importación de catálogo.

### Fixed
- **Canvas / Accesibilidad**: Solucionado acceso a Canvas, dependencias circulares, atajos de teclado y renderizado de previsualización/exportación alineado con el artboard de diseño.
- **Canvas Sync**: Corrección de bug de resurrección de capas eliminadas, propagación clara de errores y caracterización con suite de tests.
- **Seguridad**: Revocación inmediata de sesión cuando administradores deshabilitan usuarios y endurecimiento general de IPC en Electron, backend, frontend y Supabase.
- **Clean Code**: Eliminación de código muerto (métodos IPC no utilizados, tipos obsoletos y módulos sin consumo).

## [0.11.1] — 2026-07-16

### Added
- **Layout**: Sidebar con navegación agrupada, iconos Lucide unificados y tooltips al colapsar.
- **Padrón**: Controles de folio con estilo de página, tamaño y tipografía; `FolioMenuSelect` y footer de acciones pulido.
- **Preview panel**: `TemplatePicker` para elegir plantilla y mapping más claro.
- **Image Optimizer**: UI preview-first con chrome más calmado y drop stage.
- **UI**: componente `HoverTooltip` / `WithHoverTooltip` y `separator` (shadcn) reutilizables.
- **Tests**: cobertura de Sidebar, TitleBar, folio, TemplatePicker y theme coverage.

### Changed
- **Chrome general**: vistas densas estilo Apple en Espacios, AutoIMG, Volantes, Reportes de campo, Fichas técnicas, Reportes técnicos y Settings.
- **Appearance**: colores de tema aplicados de forma consistente a diálogos y chrome de módulos (incl. Vanta Black).
- **BrandMark**: tamaño de logo reducido para alinear mejor con la title bar.
- **Fichas técnicas**: panel de base de datos y editor más compactos; sin efectos de humo en el panel.
- **Padrón**: formularios, date picker y estilos de vista previa refinados.

### Fixed
- **Conversion / IPC**: ola de corrección 001–014 (cancelación, process death, re-sync, overwrite seguro, mapping stem conflicts, preview stale races).
- **Reportes técnicos**: slots de logo izquierdo y derecho restaurados.
- **A11y / tests**: nombres accesibles (`aria-label`) tras el paso a HoverTooltip (Eliminar, Recargar catálogo).
- **Process runner / Electron**: bookkeeping de UI y restart de backend más robustos.

### Removed
- Código muerto, dependencias sin uso, assets huérfanos y planes advisor 001–014 ya completados.
- Config local de tooling (`.factory`, `docs/superpowers`) fuera del tracking del repo.

## [0.10.20] — 2026-07-13

### Added
- **AutoIMG**: Chrome de cobertura compacto junto a acciones de escaneo; rediseño del tab Carpetas; previews de hasta 4 thumbnails de Drive por carpeta (sin escaneo completo).
- **Volantes**: Título y encabezados editables a nivel de sesión; sidebar más denso estilo Apple; date/time pickers con portales anclados exclusivos (sin recorte ni solapamiento).
- **Historial**: Tipo de run `ficha_tecnica` registrado para reejecución y listado.
- **Brand / UI**: Nuevo set de iconos de app y favicons con cache-busting; favicons dinámicos claro/oscuro según el tema del sistema.
- **Conversión**: Thumbnails a tamaño de display vía IPC nativo Electron (`local_thumbnail` / `nativeImage`), con LRU(200), concurrencia 3 y fallback a full-res/`file://`.
- **Backend (fiabilidad)**: Olas improve 007–017 — job complete siempre en error, `process_start` en light lane, payloads `process_status` reducidos, writes atómicos de config JSON, pymupdf en PyInstaller, cap de payload IPC inbound, paridad preview/process en `key_column` vacío, sanitize WeasyPrint unificado y stats de orphans O(1) en mapping.
- **Tests**: Paridad key-column preview/process, plugins/formatos characterization, IPC params faltantes, health-probe mid-flight en `npm test`, redaction de URLs de mapas, sanitize PDF HTML y portable out-path dedupe en Linux CI.

### Changed
- **Conversión**: Single-flight en rename preview (debounce 600ms + cola in-flight); metadata `detected_key_column` en preview evita un segundo IPC de detect; coalescing de `preview_image` (debounce 450ms, generation guard, single-flight).
- **Sellador**: Preview raster acotado (DPI MIN 900 / MAX 2048, dpr cap) y caches LRU max 32 (`otherPagesRenderCache`, `PdfPagePreview`).
- **Espacios**: Lazy-load de la vista calendario.
- **Historial**: Parse de JSON de run una sola vez por fila.
- **AutoIMG**: Cache LRU de previews de carpetas.
- **Deps**: Pillow elevado a `>=12.3.0`.
- **Docs**: Auth, env setup y alcance de módulos documentados.

### Fixed
- **Backend / conversión**: Heartbeats de job para que el health probe no mate conversiones largas; health probe responde `version`/`process_status` en el hilo IPC; budget de auto-restart acotado antes de FATAL; trabajo pesado de fichas/evidencia en el heavy pool.
- **Frontend / process runner**: Bookkeeping de UI endurecido (merges seed-safe, honor `{ started: false }`, reset en restarting/fatal/error).
- **Conversión**: Sin sobrescritura silenciosa al colisionar nombres de salida (sufijo `-2`, `-3`…); orientación EXIF aplicada antes de convert/preview.
- **Historial**: Reejecutar desde cualquier pestaña restaura destino, secuencia, `word_separator` y modo de secuencia.
- **UI**: Respuestas obsoletas de match/select ignoradas bajo navegación rápida (panel, reportes técnicos, fichas).
- **AutoIMG**: Bootstrap y verify de Drive ignoran respuestas stale; bootstrap como método long-running (timeout 15m); agregar carpetas Drive sin verify previo; sync de escaneo solo actualiza filas del padrón BD_IMG (no inserta NIS nuevos); fixes de tipos en `PreviewState` y tests de Carpetas.
- **Espacios**: Soft-delete no resucita tareas durante la ventana de undo; undo acotado al proyecto activo; notificaciones de vencimiento con Supabase realtime (menos polling).
- **Evidencia Volanteo**: Export Word alineado al preview (gutter grid, bordes de celda, altura de fila `atLeast` para cuadrante largo).
- **Reportes de campo**: Persistencia de todos los campos y logos al cambiar de pestaña (flush IndexedDB + branding store).
- **Padrón**: Folios únicos consecutivos entre hojas; `Hasta` sincronizado a `Desde+pages-1` (sin duplicados con offset/inversión).

### Security
- **Ubicaciones**: API keys de mapas (Google/Mapbox/MapTiler) en almacenamiento cifrado de Electron; migración única desde `localStorage` y borrado del plaintext residual.
- **Evidencia**: HTML sanitizado antes de WeasyPrint.
- **Logs**: Redacción de API keys de mapas en URLs.
- **IPC**: Cap de tamaño en payloads inbound.
- **Auth / Supabase**: Columnas de privilegio en `user_profiles` protegidas por trigger; revoke de token Google vía body POST.
- **PDF**: Sanitize de paths en todos los renders WeasyPrint.

## [0.10.19] — 2026-07-08

### Added
- **Fichas Técnicas**: nueva herramienta (backend, plantillas, UI e IPC) para generación de fichas técnicas.
- **Espacios**: multi-selección en list/table con `BulkActionBar`, soft-delete con undo toast y atajos de teclado.
- **Espacios**: columnas de tablero personalizadas, notificaciones de vencimiento y mejoras de board/calendar/gantt.
- **Evidencia Volanteo**: etiqueta de cuadrante editable u ocultable en preview, PDF y DOCX (con persistencia de sesión).
- **Reportes de campo**: personalización de tamaño y color del título en preview y PDF.

### Changed
- **Fichas Técnicas**: preview A4 simplificado, lectura de DB sin re-normalizar de más y limpieza de IPC muerto.
- **Espacios**: endurecimiento de sync (carreras create-vs-load), handlers de selección en list/table y flush seguro de delete.
- **Gitignore**: reglas locales de Cursor (`.cursor/rules/`) e ignorado de secrets de Supabase.

### Fixed
- **Espacios**: selección multi-vista cableada; `commitDelete` estable al desmontar; columnas `is_done` custom respetadas en overdue/notificaciones.
- **Evidencia Volanteo / Reportes**: regresiones cubiertas con tests de etiqueta de cuadrante y estilo de título.

### Security
- Detección pre-commit ampliada para tokens `sbp`, service role keys, DB passwords y JWTs anon reales.
- Ignorado de `supabase/.env` y settings locales de Cursor; tests de seguridad alineados.

## [0.10.18] — 2026-07-08

### Added
- **AutoIMG**: Export de renombre NIS (7 dígitos) → SGIO (8 dígitos) con subcarpetas por columna DESTINO de BD_IMG; panel `Renombrar` y APIs `autoimg_rename_export` / `autoimg_rename_dest_config`.
- **AutoIMG**: Aislamiento de datos por usuario Google (scope SHA-256 del email en `userData/autoimg/users/`).
- **AutoIMG**: Preferencias locales por usuario (carpetas de escaneo y carpeta raíz de renombre) sin tokens ni secrets.
- **Tests**: Suites de regresión para NIS, rename, local prefs y user scope.

### Changed
- **AutoIMG**: Parsing NIS más robusto (`6553447_1`, `6553447-3C`, etc.) y slots serializables para IPC.
- **AutoIMG**: Sync engine endurecido (cache de carpetas/logs, RESUMEN desde filas BD_IMG fusionadas, cancelación de operaciones largas).
- **AutoIMG**: UI simplificada — eliminado `SetupWizard`; paneles de auth, dashboard y sync alineados al flujo actual.
- **Gitignore**: Exclusión de prefs/tokens AutoIMG y carpeta `autoimg/` local.

### Fixed
- **Ubicaciones**: Preview en modo manual restaura mapa al montar con lat/lon guardadas; spinner en primer fetch y refresh/retry sin romper export.
- **Ubicaciones**: Retry de guardado consolidado ante WinError 32 (PDF lock en Windows).
- **Espacios / Login**: Ignora fetches obsoletos; restaura tema de la app tras login.
- **AutoIMG**: Invalidación de cache de carpetas/logs tras mutaciones; mirror local de FOLDERS offline.

## [0.10.17] — 2026-07-05

### Added
- **Ubicaciones**: Modo manual con pegado de coordenadas combinadas; 7 proveedores de mapa configurables (OSM, Google, Mapbox, MapTiler, Stadia, Geoapify, Thunderforest).
- **Ubicaciones**: Panel de personalización de diseño en vivo (textos, pin, overlay, layout) con preview WYSIWYG.
- **Ubicaciones**: Persistencia de sesión (carpeta destino, orientación, modo de entrada, datos manuales y estilos) en `localStorage`.
- **Ubicaciones**: Utilidad `coords` y suite de tests `UbicacionesView.config-sync` para reactividad de preview.
- **Petdex**: Mascota (`PetMascot`) y vista de configuración `PetdexView`.
- **AutoIMG**: Soporte de pestañas en hojas Google Sheets y mejoras en sync engine, seguridad y fetch.
- **Tests**: Regresiones de preview manual, parsing de coordenadas combinadas y nombres PDF duplicados.

### Changed
- **Ubicaciones**: Refactor del sidebar y preview con cola de requests, debounce por tipo de cambio y `recomposeOnly` para estilos.
- **AutoIMG**: Barra superior y paneles de arrastre, carpetas y logs alineados al layout unificado.
- **Settings**: Integración de Petdex en el modal de configuración.

### Fixed
- **Ubicaciones**: Columna combinada de coordenadas ya no devuelve `0,0` silencioso; soporta URLs de Google Maps.
- **Ubicaciones**: Error explícito cuando no hay filas válidas; PDFs con `cod_componente` duplicado reciben sufijo (`_2`, `_3`).
- **Ubicaciones**: Preview sincroniza `manualData` en tiempo real; cola de fetch respeta refetch de mapa al cambiar zoom/proveedor.
- **Preview-panel**: Corrección menor en exportación PDF.

## [0.10.16] — 2026-07-03

### Added
- **AutoIMG**: Nueva pestaña con sync Google Sheets/Drive, OAuth PKCE, escaneo multi-carpeta, dashboard, panel de arrastre y tests de regresión en `npm test`.
- **Padrón (folios)**: Controles de folio inicio/fin con interpolación por página e inversión de rango.
- **Conversión**: Mapeo de renombre de columnas Excel en el pipeline de conversión.
- **Templates**: Variantes `certificados-sjl-blanco`, `certificados-sjl-guardamino` y `Certificado-sanidad-lugo`.
- **Tests**: Regresión para backend spawner (restart manual, race auto-restart), CSP de Google Fonts, y renombre de columnas.

### Changed
- **AutoIMG**: Barra superior unificada (h-11) y sidebar de conexión OAuth/Sheets rediseñado.
- **Frontend**: Renombrado `vgen-assets` → `volanteo-assets` y `vpad-assets` → `padron-assets`.
- **Volantes**: Selector de hora con pasos de 1 minuto y rollover correcto al cruzar medianoche.
- **Panel Aviso de Corte**: Routing de plantillas y reenvío de `export_mode`/`template_id` en export PDF/DOCX.
- **Build**: Limpieza de `electron-builder.yml` y scripts de empaquetado.

### Fixed
- **Backend spawner**: Restart manual preempta ciclos de auto-restart; sin backends duplicados en condiciones de carrera.
- **Renamer**: Mejoras en secuencia por fila, mapeo parcial y sanitización de nombres preservados.
- **Historial / jobs**: Correcciones menores en handlers y exportación CSV.

## [0.10.15] — 2026-06-30

### Added
- **Evidencia Volanteo**: Nueva sección y generador para layouts de evidencia de volanteo con grid de imágenes autoajustables, preview interactivo, y descarga de reportes.
- **Panel Aviso de Corte (TemplateSelector)**: Agregado un selector de plantilla compacto en la barra de herramientas para alternar configuraciones de visualización y exportación.
- **Tests**: Pruebas de integración de backend y frontend para layouts de Evidencia Volanteo y renderizado.

### Changed
- **Padrón / Panel Aviso de Corte (Barra de herramientas)**: Relocalización de los selectores de formato de salida y orientación al toolbar para mayor consistencia estética con la altura unificada de 45px.

## [0.10.14] — 2026-06-30

### Fixed
- **Scheduler (cancelación de jobs)**: Un heavy future cancelado antes de arrancar nunca llegaba al `finally` de `_wrapped`, filtrando el slot reservado y el contador `heavy_outstanding` para toda la sesión — cada cancelación de batch encogía `heavy_capacity` permanentemente. Añadido un `done_callback` que libera el slot sólo si `fut.cancelled()` (sin double-release contra el path del `finally`). Nuevo contador `heavy_cancelled` en métricas.
- **Optimizador de imágenes (dedup de nombres)**: El loop que busca un nombre libre en disco estaba sin acotar; una carpeta de destino pre-poblada con miles de archivos colisionantes (`foto.jpg`, `foto-2.jpg`, …) lo hacía iterar indefinidamente. Acotado a `MAX_DEDUP_ATTEMPTS=1000`; al superarse se skipsea el archivo con motivo `no_free_slot` en vez de colgar.
- **Optimizador de imágenes (sanitización de nombres)**: `_safe_name` ahora distingue modo strict (escritura a disco: colapsa separadores `\\/` y caracteres de control, strip de espacios/puntos finales) de lenient (entradas de zip), de modo que `image_optimizer_save_files` no puede escribir fuera de la carpeta destino ni craftear nombres reservados.
- **Ubicaciones (nombre de PDF por fila)**: El nombre se construye vía `sanitizar_nombre`, así un `cod_componente` con caracteres inválidos en Windows (`:*?"<>|`) ya no produce `A:B.pdf` y hace que `PIL.save` levante `OSError` (Errno 22) abortando el batch entero.
- **Ubicaciones (coordenadas no numéricas)**: `_coerce_coord` filtra lat/lon no numéricas antes de paralelizar; un texto como `"abc"` en la columna de coordenadas ya no pasa `pd.isna` para luego crashear `float()` dentro del worker y abortar el batch vía `ex.map`.
- **Ubicaciones (aislamiento de fallos por fila)**: `_render_one` atrapa sus propias excepciones y devuelve `(ok, img)`, así una fila que falla al renderizar (IO, imagen corrupta) no aborta las demás ni el consolidado; el resultado reporta `fallidos`.
- **Frontend (doble `process_start`)**: `useProcessRunner` ahora hace flip optimista de `running` antes del `await` y reset on error. `api.startProcess` puede bloquear ~30s mientras bootea el backend y el botón de start está gateado en `running`, por lo que setearlo después del await permitía que un segundo click encolara un segundo `process_start`.
- **Frontend (delete en inputs)**: `ConversionView` ignora `Backspace`/`Delete` mientras el foco está en un `input`, `textarea`, `select` o `contentEditable`, de modo que editar el patrón de renombrado o los campos de resize ya no borra silenciosamente los archivos seleccionados. `doProcess` además es no-op si ya está corriendo.

### Changed
- **Validadores (path-traversal)**: Extraído `path_param_violations` en `backend/utils/validators.py` como única fuente de verdad para el screening de parámetros path-like. Lo consumen tanto `ipc_protocol.validate_params` (defense-in-depth) como el decorator `handlers.common.@validate_params`, evitando drift entre las dos capas. Modos strict/lenient preservan el comportamiento de cada call site.
- **IPC / Electron (long-running methods)**: La lista `LONG_RUNNING_METHODS` sale de `electron/ipc-methods.js` a `shared/long-running-methods.json` para que el main process y el renderer compartan una única fuente de verdad. El test de allowlist ahora verifica que Electron consuma el JSON verbatim y que toda entrada sea un método permitido.
- **Format Registry**: Eliminados los helpers `get`/`values` sin uso.
- **Image Optimizer**: Inline del alias `cloneBatchSettings` → `cloneSettings`.
- **UI**: Toolbars y headers unificados a 45px de altura across Ubicaciones, Formatos y Volantes.

### Added
- **Formatos (zoom)**: Slider de zoom con rango clampado (25–300%), step fino de 10 y input numérico editable, reemplazando los botones fijos de ±25%.
- **Ubicaciones (panel de resultado)**: El panel muestra las filas omitidas por error (nota amber) y un estado "completado con errores" cuando todas las filas fallan.
- **Fuente Inter**: Preconnect y carga de Inter desde Google Fonts en `index.html`.

## [0.10.13] — 2026-06-26

### Fixed
- **Panel Aviso de Corte (batching)**: Restaurado el agrupamiento original de 4 imágenes por panel. Un cambio en v0.6.10 había roto la lógica de `build_panels()`, creando un panel por cada fila del Excel en lugar de agrupar las imágenes coincidentes en bloques de 4, lo que provocaba que las imágenes solo aparecieran en la primera posición del grid.
- **Panel Aviso de Corte (exportación grande)**: Añadido parámetro `output_path` para que el backend escriba el DOCX/PDF directamente a disco en lugar de devolver ~180MB de base64 por el pipe IPC, lo que causaba el error "Response too large" con 200+ imágenes. El frontend usa `dialogSave` de Electron para que el usuario elija la ruta de guardado.
- **Panel Aviso de Corte (layout PDF/preview)**: Alineadas las dimensiones de las fotos en el PDF y la vista previa con las del DOCX, cambiando de `width:100%; height:100%` a `7.36cm × 9.82cm` fijos.
- **Panel Aviso de Corte (logo PDF)**: Restaurada la altura del `.logo-box` (1.5cm) que fue removida accidentalmente, causando que el div colapsara y el logo no se renderizara. Aumentado el ancho del logo de 5.49cm a 5.76cm en los tres formatos (DOCX, PDF, preview). El límite de 1.5cm es el máximo que WeasyPrint tolera sin generar páginas extra.
- **Panel Aviso de Corte (páginas en blanco)**: Reemplazado `doc.add_page_break()` por la propiedad XML `<w:pageBreakBefore/>` en la primera celda de cada tabla subsiguiente, eliminando los párrafos vacíos que Word renderizaba como páginas en blanco entre paneles. Un export de 54 paneles ahora genera exactamente 54 páginas.
- **Panel Aviso de Corte (preview)**: Reducido el padding superior del preview debajo de la barra de herramientas.

## [0.10.12] — 2026-06-25

### Fixed
- **Backend empaquetado (PyInstaller)**: El backend crasheaba al arranque en los builds empaquetados (v0.10.10–v0.10.11) por `ModuleNotFoundError: No module named 'pandas._config.localization'`. El `backend.spec` listaba manualmente unos pocos hiddenimports de pandas, openpyxl, weasyprint, PIL, lxml, pypdf, jinja2, python-docx y jsonschema, dejando fuera submódulos cargados dinámicamente. Reemplazada la lista manual por `collect_submodules()` para cada paquete pesado, asegurando que TODOS los submódulos se empaqueten.
- **Backend empaquetado**: Removidas las exclusiones de `pandas._testing`, `pandas.io.json`, `pandas.io.parquet` y `pandas.io.sql` del `excludes` del spec, porque pandas las importa internamente y su exclusión causaba `ModuleNotFoundError` al arranque.
- **WeasyPrint en build empaquetado**: `urllib.request.HTTPSHandler` no estaba disponible en el build empaquetado porque `strip=True` corrompía las DLLs nativas de SSL (`_ssl.pyd`, `libssl-3.dll`, `libcrypto-3.dll`). Cambiado `strip=False` y añadidas las DLLs de SSL a `binaries` y `upx_exclude` para que WeasyPrint pueda generar PDFs correctamente.
- **Reportes Generador (plantillas)**: Las plantillas no aparecían en la herramienta porque el backend no arrancaba en el build empaquetado. Con el fix del spec, `templates_list` ahora devuelve las 14 plantillas correctamente.
- **Aviso de Corte (Excel)**: No se podía cargar el Excel porque el backend no respondía. Con el fix del spec, `panel_aviso_corte_parse_excel` funciona correctamente en el build empaquetado.
- **IPC**: Todos los problemas de IPC en el build empaquetado eran consecuencia directa del crash del backend al arranque. Con el fix del spec, el backend arranca, reporta `ready` y todas las llamadas IPC funcionan.

## [0.10.11] — 2026-06-25

### Added
- Reportes de Campo: persistencia de hojas por plantilla en IndexedDB, con tests de serialización de fotos.
- Panel Aviso de Corte: vista previa inmediata por fila de Excel (`excelPreview`) y auto-selección de columnas clave (`ID`) y dirección.

### Fixed
- Ubicaciones: incluir `assets/ubicaciones` en el spec de PyInstaller para que el instalador empaquetado tenga los recursos necesarios.
- Preview Panel: esperar a que el backend esté `ready` antes de llamar a `templates_list`, evitando fallos IPC al arranque.
- Panel Aviso de Corte: corregida vista previa vacía tras importar Excel sin imágenes emparejadas aún.

## [0.10.10] — 2026-06-23

### Added
- Nueva herramienta de Ubicaciones: genera reportes con capturas de Google Maps a partir de un Excel de coordenadas. Backend handler con Playwright persistente, vista frontend con sidebar, dropzone de Excel, selector de formatos y vista previa en tiempo real.
- Pre-warming del navegador Playwright al arranque del backend (`warmup_preview_browser`) para que la primera captura de mapas sea instantánea.
- Lazy-load de thumbnails con `IntersectionObserver` para evitar abrir cientos de `file://` handles simultáneamente en la vista de conversión.

### Changed
- UI de Ubicaciones rediseñada para un look profesional: sidebar en columna flex con header fijo, secciones de config scrollables, botón de generar sticky, labels estilo eyebrow, dropzone con más padding, tarjetas de formato con padding e indicador activo/inactivo consistente.
- Eliminado el debounce de 300ms en la vista previa de Ubicaciones: las peticiones ahora se disparan inmediatamente al cambiar Excel o formato, manteniendo el anti-race-condition con `fetchIdRef`.
- Vista previa unificada WYSIWYG: la exportación reutiliza el navegador Playwright persistente y el cache de mapas con resolución, calibrando el layout a las plantillas de referencia.
- Eliminado el debounce de 300ms en `UbicacionesView.tsx` para preview en tiempo real.
- Optimizaciones de rendimiento (end-to-end audit): cache de `pin.png` a nivel módulo, regex patterns hoisted a nivel módulo en `technical_reports.py`, cache de `load_patterns()` con invalidación, `import psutil` a nivel módulo, `useCallback` estable en `App.tsx`.

### Fixed
- Concorrencia de Playwright: reemplazado `RLock` por un single-thread executor para garantizar afinidad de hilo en la API sync de Playwright, evitando el crash "Sync API inside the asyncio loop" al togglear formatos o navegar filas rápido.
- Acceso serializado a la `Page` de Playwright persistente compartida entre hilos del `ThreadPoolExecutor` (light_workers=4).
- Reducción del wait de captura de mapas de 1200ms a 800ms aprovechando el navegador pre-warmed con Google Maps cacheado.
- Edge Functions: agregado manejo de `OPTIONS` y headers CORS para que `supabase.functions.invoke` funcione desde el frontend en modo dev (antes fallaba con 405 en preflight).
- Panel de admin: reemplazados `supabase.auth.admin.createUser/deleteUser` por Edge Functions (`admin-create-user`, `admin-delete-user`) que validan rol admin con `SUPABASE_SERVICE_ROLE_KEY`, ya que la service_role no está disponible en el frontend.

## [0.10.9] — 2026-06-22

### Fixed
- Supabase en builds de CI: el workflow `release.yml` no pasaba `VITE_SUPABASE_URL` ni `VITE_SUPABASE_ANON_KEY` al paso `Build Frontend`, por lo que Vite embebía `undefined` en el bundle y la app instalada mostraba "Supabase no configurado" al intentar ingresar. Agregadas las variables desde GitHub Secrets al paso de build.
- `supabase.ts`: en builds de producción, si faltan las variables de entorno ahora se lanza un error explícito en lugar de un `console.warn` silencioso, para que el CI falle antes de publicar un instalador roto.

## [0.10.8] — 2026-06-22

### Fixed
- Empaquetado de la app: `electron-builder.yml` no incluía la carpeta `shared/` dentro del `app.asar`, por lo que `electron/dialog-handlers.js` crasheaba al arrancar la app instalada con `Error: Cannot find module '../shared/html-sanitizer'`. Agregada la inclusión `- "shared/**/*"` a la lista de `files`.

## [0.10.7] — 2026-06-22

### Fixed
- Workflow de Release (Windows): agregado step de instalación de Pango/GTK vía MSYS2 antes de `pip install`, para que WeasyPrint encuentre `libgobject-2.0-0` y los tests de `render_pdf` pasen en CI. Antes, los 4 tests de PDF fallaban con `OSError: cannot load library 'libgobject-2.0-0'` y bloqueaban el build del installer.
- Workflows de CI y Release: bump de Node 18 → 20. Vitest 4 depende de `vite@8` → `rolldown`, que importa `styleText` desde `node:util` (solo disponible en Node ≥ 20.12). Node 18 está EOL desde abril 2025.

## [0.10.6] — 2026-06-22

### Fixed
- Agregada dependencia de desarrollo `hypothesis>=6.100.0` para resolver `ModuleNotFoundError` en CI durante la recolección de tests de `tests/panel_aviso_corte`.

## [0.10.5] — 2026-06-22

### Added
- Nuevos componentes de mapeo visual para formatos (MappingColorField, MappingOverlay, MappingPreviewPanel).
- Soporte para exportación de reportes técnicos con grid 3x2 dinámico y stretch de imágenes.
- Nuevos tests para mapeo de formatos, optimizador de imágenes y manejo de diálogos de Electron.
- Assets de registro: imagen y video de sign-up.

### Changed
- Mejoras en el backend de reportes, formatos, sellador y optimizador de imágenes.
- Refactor del IPC de Electron y manejo de ventanas.
- Actualización de dependencias en frontend y .gitignore para archivos temporales/caché.
- Limpieza de credenciales de Supabase en `.env.example` mediante reescritura de historial.
- Actualización de versiones a `0.10.5` en todos los manifiestos del proyecto.

### Fixed
- Correcciones en la UI de formatos, sidebar y optimizador.
- Ajustes en locales y sanitización de HTML compartido.

## [1.10.5] — 2025-06-01

### Fixed
- Correcciones menores en el backend de procesamiento de imágenes.

### Changed
- Actualización de dependencias.

## [1.10.4] — 2025-05-15

### Fixed
- Corrección en el manejador de formatos para exports Excel.

## [1.10.3] — 2025-05-01

### Added
- Nueva funcionalidad de informes técnicos con exportación a PDF/Excel.

### Fixed
- Corrección en la asignación de renombrado por lotes.

## [1.10.2] — 2025-04-15

### Changed
- Mejoras en la UI de conversión con soporte para arrastrar y soltar.

## [1.10.1] — 2025-04-01

### Fixed
- Correcciones en el spawned de backend y manejo de errores de IPC.

## [1.10.0] — 2025-03-15

### Added
- Soporte para múltiples formatos de salida (PNG, JPG, WEBP, BMP, TIFF).
- Renombrado por lotes con patrones personalizados.
- Tema oscuro completo.
- Auto-actualizador integrado (electron-updater).

### Changed
- Migración a React 18 + TypeScript + Vite + TailwindCSS.
- Arquitectura IPC renovada con backend Python separado.
