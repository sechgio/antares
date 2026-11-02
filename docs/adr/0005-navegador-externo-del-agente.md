# 0005. Navegadores externos para el agente

- Fecha: 2026-11-02
- Estado: aceptado
- Personas: sechgio

## Contexto

El navegador de Agent es una `WebContentsView` de Electron (ADR 0002 y 0004).
Algunos encargos necesitan un navegador real del usuario: extensiones, un sitio
que bloquea Electron, o una sesión que el usuario ya inició en Chrome, Edge,
Brave u Opera. Hay tres restricciones externas:

- Desde Chrome 136, `--remote-debugging-port` y `--remote-debugging-pipe` se
  ignoran sobre el directorio de datos por defecto: exigen un `--user-data-dir`
  propio, que cifra las cookies con otra clave
  ([Chrome for Developers](https://developer.chrome.com/blog/remote-debugging-port)).
  Edge, Brave y Opera heredan el cambio de Chromium; en Opera no está comprobado.
- Desde Chrome 144, el usuario puede permitir la depuración del Chrome abierto en
  `chrome://inspect#remote-debugging`. Chrome pide permiso en cada conexión y
  muestra una barra mientras dura
  ([Chrome for Developers](https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session)).
- Firefox retiró CDP en la versión 141; solo ofrece WebDriver BiDi
  ([Firefox DevTools](https://fxdx.dev/cdp-retirement-in-firefox/)).

`electron/agent-browser.js` usa de la página unos quince miembros de
`WebContents`: `executeJavaScript`, `executeJavaScriptInIsolatedWorld`,
`debugger.sendCommand` (ya CDP: `Input.*`, `Page.*`, `DOM.*`), `getURL`,
`getTitle`, `navigationHistory`, `reload`, `loadURL`, `capturePage`, eventos y
`getZoomFactor`. Las protecciones viven en la sesión de Electron
(`prepareSession`): permisos denegados, bloqueo de red privada, descargas solo
por `web_download`.

## Decisión

Conectamos navegadores Chromium externos por CDP (por tubería con el perfil
dedicado y por WebSocket local con la sesión del usuario), detrás de un adaptador `PageContents` que imita el subconjunto de `WebContents`
que ya usan las herramientas `web_*`, con dos modos:

1. **Perfil dedicado** (modo por defecto al elegir un navegador externo).
   Antares lanza el ejecutable instalado de Chrome, Edge, Brave u Opera con
   `--remote-debugging-pipe` y `--user-data-dir=%APPDATA%\Antares\agent-browsers\<navegador>`.
   El usuario inicia sesión una vez en ese perfil; sus perfiles personales
   quedan fuera.
2. **Mi sesión de Chrome** (opcional, Chrome 144 o posterior). Antares se
   conecta al Chrome abierto cuando el usuario lo habilitó en
   `chrome://inspect#remote-debugging` y aceptó el diálogo de Chrome. El agente
   abre su propia pestaña con `Target.createTarget` y solo actúa en ella.

Firefox usa un tercer adaptador, sobre WebDriver BiDi, con perfil dedicado
(ver «Firefox por WebDriver BiDi»).

### Seam: `PageContents`

| Miembro | Adaptador Electron | Adaptador CDP |
| --- | --- | --- |
| `executeJavaScript(code, gesture)` | `WebContents` tal cual | `Runtime.evaluate` con `returnByValue`, `awaitPromise`, `userGesture` |
| `executeJavaScriptInIsolatedWorld(id, [{ code }])` | tal cual | `Page.createIsolatedWorld` una vez y `Runtime.evaluate` en ese `contextId` |
| `debugger.sendCommand` / `on('message')` | tal cual | la sesión CDP de la pestaña, filtrada por la lista permitida |
| `getURL`, `getTitle`, `isLoading` | tal cual | caché de `Page.frameNavigated`, `Page.lifecycleEvent` y `Target.targetInfoChanged` |
| `navigationHistory` | tal cual | caché síncrona de `Page.getNavigationHistory`, refrescada en cada navegación; `Page.navigateToHistoryEntry` |
| `loadURL`, `reload` | tal cual | `Page.navigate` (esperando `load`), `Page.reload` |
| `capturePage()` | tal cual | `Page.captureScreenshot` → `nativeImage.createFromBuffer` |
| eventos `console-message`, `did-*`, `destroyed` | tal cual | `Runtime.consoleAPICalled`, `Page.*`, `Target.targetDestroyed` |

Las herramientas no cambian: el adaptador CDP mantiene síncronos el historial,
la dirección, el título y el estado de carga, como `state()` los necesita. El
adaptador está en `electron/agent-browser-cdp.js` y su contrato en
`tests/test-agent-browser-cdp.js`.

### Protecciones de la pestaña externa

`electron/agent-browser-engines.js` protege cada pestaña del agente antes de
entregarla:

- **Red privada y vista previa**: `Fetch.enable` en la sesión de la pestaña;
  cada `Fetch.requestPaused` pasa por `requestAllowed`, la misma función que usa
  `prepareSession` en el integrado. El marco principal se reconoce porque su
  `frameId` coincide con el `targetId`.
- **Iframes de otro proceso y workers**: `Target.setAutoAttach` con
  `waitForDebuggerOnStart`; cada hijo recibe la misma protección antes de
  `Runtime.runIfWaitingForDebugger`. `Network.setBypassServiceWorker` evita que
  un service worker responda por la página.
- **Ventanas emergentes**: se cierran sin cargar y su dirección, si
  `permitted()` la acepta, se abre en la pestaña del agente.
- **Perfil dedicado**: `Browser.setDownloadBehavior` en `deny` y
  `Browser.setPermission` deniega ubicación, notificaciones, cámara, micrófono,
  MIDI y lectura del portapapeles. `web_download` sigue usando la sesión del
  navegador integrado.
- **Lista permitida de CDP**: `debugger.sendCommand` solo admite `Input.*`,
  `Page.*` (sin `Page.setDownloadBehavior`), `DOM.*`, `Runtime.evaluate`,
  `Network.enable` y `Emulation.setFocusEmulationEnabled` sobre el `sessionId`
  de la pestaña del agente. `Fetch.*` queda reservado al propio adaptador.
  `Network.getCookies`, `Network.getAllCookies`, `Storage.*`, `Browser.*` y
  `Target.attachToTarget` quedan prohibidos.
- **Campos secretos y elementos tapados**: siguen igual, porque se comprueban
  dentro de la página.

### Reglas adicionales del modo «Mi sesión de Chrome»

- El panel pide confirmación antes de conectar, además del diálogo de Chrome, y
  muestra qué navegador usa el agente.
- Antares lee `DevToolsActivePort` del directorio de datos de Chrome y se
  conecta por WebSocket a `127.0.0.1`; sin ese archivo explica cómo activar la
  depuración remota. Espera hasta 60 s a que el usuario acepte el aviso.
- No cambia nada global del Chrome del usuario: ni descargas ni permisos. Las
  descargas de la pestaña del agente se cortan en `Fetch` al ver la respuesta
  (`Content-Disposition: attachment` o un tipo binario), y los permisos quedan
  en los avisos de Chrome, que solo puede aceptar una persona.
- `web_open` hacia un dominio que no esté en «Permitir siempre» pasa por la
  aprobación (`sessionOpenContext`), con la dirección y el dominio en el
  contexto para que «Permitir siempre» lo recuerde.
- El agente no lista ni lee otras pestañas. Al volver al integrado o al cerrar
  Antares cierra su pestaña y se desconecta sin cerrar Chrome.

### Integración

- Acciones `engines` y `engine` del canal `agent_browser` existente, como hizo
  el ADR 0004 con `new` y `close`, en lugar de métodos IPC nuevos.
- La elección dura hasta cerrar el navegador del agente; no se persiste, igual
  que las pestañas del usuario. Solo la pestaña «Agente» usa el navegador
  externo.
- Detección por las rutas de instalación conocidas de Chrome, Edge y Brave en
  `PROGRAMFILES`, `PROGRAMFILES(X86)` y `LOCALAPPDATA`, y del Opera versionado
  en `LOCALAPPDATA\Programs\Opera\<versión>`, porque el `opera.exe` de la raíz
  es un lanzador que perdería la tubería.
- Si el usuario cierra el navegador o la pestaña, la siguiente apertura vuelve a
  lanzarlo o abre otra pestaña.

### Firefox por WebDriver BiDi

- `electron/agent-browser-bidi.js` presenta una pestaña de Firefox como
  `PageContents`. Las expresiones se evalúan con `script.evaluate` y vuelven como
  JSON, igual que `executeJavaScript`; el mundo aislado es un `sandbox`. Las
  órdenes CDP permitidas se traducen: ratón y teclado a `input.performActions`
  (los modificadores se pulsan como teclas), texto carácter a carácter, capturas
  a `browsingContext.captureScreenshot` y la subida de archivos a
  `input.setFiles`. Una orden permitida sin traducción falla con
  `BIDI_UNSUPPORTED`. La red y la consola llegan con forma CDP para
  `web_network` y `page_reported`. BiDi no expone el historial: el adaptador lo
  lleva con las navegaciones que observa.
- Firefox arranca con `--remote-debugging-port=0`, `--profile` propio y
  `--no-remote`; Antares lee la dirección que anuncia, abre la única sesión BiDi
  que Firefox admite y la mantiene. El puerto solo escucha en `127.0.0.1` y,
  abierta la sesión, otro proceso no puede abrir otra.
- `user.js` del perfil: permisos denegados, «preguntar antes de descargar»,
  sin precarga DNS ni conexiones especulativas, sin pantallas de bienvenida.
- `network.addIntercept` en todo el navegador, porque el perfil es del agente:
  cada petición pasa por `requestAllowed` (las de pestañas que abra el usuario
  ahí también) y las respuestas que serían descargas se cortan. Las ventanas
  emergentes de la pestaña del agente no llegan a cargar: se cierran y su
  dirección se abre en ella.

### Pendiente

- Detectar la actividad humana en la ventana externa (`before-input-event` no
  existe allí): hoy el usuario toma el control desde el panel.
- Las peticiones que hace un service worker por su cuenta y, si Chrome no admite
  `Fetch` en ellos, las de los workers.
- Rutas de instalación personalizadas (`App Paths` del registro).

## Alternativas consideradas

| Alternativa | Por qué se descartó |
| --- | --- |
| `--remote-debugging-port` en TCP | Cualquier proceso local puede conectarse sin autenticación; la tubería solo la tiene Antares. |
| Copiar el perfil personal del usuario | Chrome cifra las cookies con una clave ligada al perfil; copiarlo es frágil y se parece a un ladrón de credenciales. |
| Usar Playwright o Puppeteer | Añade cientos de MB y una segunda pila de herramientas; las `web_*` ya hablan CDP. |
| Reescribir las herramientas sobre CDP puro también en Electron | Cambia el camino que hoy funciona (`executeJavaScript` frente a `Runtime.evaluate`) sin ganar nada para el usuario. |
| Firefox por CDP | Retirado en Firefox 141; se usa WebDriver BiDi. |
| Que el agente opere cualquier pestaña del Chrome real | Rompe la separación usuario/agente de los ADR 0002 y 0004. |

## Consecuencias

- Las herramientas `web_*`, sus aprobaciones y sus errores no cambian; el
  navegador integrado sigue siendo el predeterminado.
- La política de red es una sola función, `requestAllowed`, para los dos
  motores.
- El modo «Mi sesión de Chrome» da al agente las sesiones reales del usuario en
  su pestaña: por eso exige la doble aprobación y la aprobación por dominio.
- Fases: (1) seam `PageContents` sin cambio de comportamiento; (2) perfil
  dedicado para Chromium; (3) «Mi sesión de Chrome»; (4) Firefox por BiDi,
  se entregan en PRs encadenados, una fase por PR.
- Verificación: `tests/test-agent-browser-cdp.js` (adaptador),
  `tests/test-agent-browser-engines.js` (lanzamiento, tubería, sesión,
  Firefox, protecciones), `tests/test-agent-browser-bidi.js` (adaptador BiDi), `tests/test-agent-browser-engine-switch.js` (pestaña del
  agente y aprobación por dominio), `tests/test-agent-runtime.js` y
  `AgentBrowserPanel.test.tsx`.
