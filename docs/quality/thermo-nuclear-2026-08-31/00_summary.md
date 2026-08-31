# Revisión termo-nuclear del contrato de archivos IPC

Fecha de la revisión: 2026-08-31.

## Veredicto

El hallazgo crítico queda corregido. El renderer ya no necesita registrar rutas nativas para que el proceso principal pueda leerlas. Los diálogos entregan capacidades de lectura alineadas con sus rutas, los archivos que llegan como `File` se escenifican por operación y el router resuelve los tokens antes de llamar al backend.

La revisión también eliminó la caminata recursiva sobre datos arbitrarios. El contrato define las posiciones que representan archivos. Nombres, etiquetas, contenido Base64 y otros textos quedan fuera de la validación de rutas.

No encontré una regresión estructural clara en el diff. `electron/ipc-router.js` queda en 949 líneas y `frontend/src/components/conversion/ConversionView.tsx` en 963. Ambos permanecen por debajo del umbral de 1.000 líneas que motivó esta revisión. La lógica nueva vive en módulos pequeños: el contrato tiene 204 líneas, el enrutamiento 65 y el hook de referencias de conversión 95.

El resultado es apto para revisión en PR con una salvedad operativa. Las pruebas enfocadas, estáticas, nativas y Python concluyeron correctamente. Dos ejecuciones globales de Vitest no emitieron progreso ni resultados durante varios minutos y fueron detenidas. Ese límite está separado de los resultados verdes que se detallan en `03_verification.md`.

## Hallazgos y resolución

El hallazgo 1 describía la ruptura de Conversión, Sellador, Panel de aviso de corte, Evidencia volanteo e Informes V2 después de rechazar rutas absolutas sin migrar sus llamadores. La corrección combina `electron/file-token-contract.js`, `electron/file-token-routing.js` y `frontend/src/components/conversion/useConversionFileRefs.ts`. La UI conserva rutas solo como identidad y etiqueta visual. Las operaciones nativas reciben tokens o datos en memoria, según el flujo.

Conversión entrega `file_tokens` desde los diálogos, conserva los objetos `File` para arrastres y pegados, y escenifica cada archivo antes de `preview`, `db_parse_mapping` y `process_start`. Las restauraciones desde historial quedan bloqueadas en Electron hasta que el usuario vuelve a cargar los archivos, porque el historial no puede conservar una capacidad de lectura expirada o ligada a otra ventana.

Sellador usa el token del diálogo para inspección y render de páginas. Para archivos seleccionados como `File`, escenifica el PDF y el sello al aplicar la operación. El preview conserva el `File` y escenifica una copia nueva cuando necesita llamar a IPC.

Panel de aviso de corte y Evidencia volanteo dejaron de enviar rutas obtenidas con `getPathForFile`. Sus exportaciones escenifican las imágenes durante la operación y solo usan Base64 cuando el puente de staging no existe o el renderer necesita una `data:` URI para construir HTML. Informes V2, reportes de campo y el editor canvas siguen la misma regla mediante los helpers de PDF.

El hallazgo 2 no es reproducible en el HEAD revisado. `file_token_read_chunk` no aparece en `electron/ipc-methods.js`, no hay handler y no hay llamadas activas. No se añadió código para un método inexistente.

El hallazgo 3 queda corregido con un visitante basado en esquema. La validación y la limpieza recorren `files`, `image_paths`, `images[].path`, `images_by_id.*[].path`, `localImagePaths` y los campos de token declarados. No recorren `filename`, `content_b64` ni claves desconocidas. Hay una regresión específica para una `data:` URI que contiene texto parecido a traversal.

El hallazgo 4 no es reproducible en el HEAD revisado. No existen `isTrustedThumbnailUrl` ni una configuración `redirect: 'error'` en el código actual. No se cambió un flujo que no está presente.

El puente de `register_local_path` dejó de exponerse al renderer y no tiene consumidores activos. El método nativo de compatibilidad permanece solo para devolver un error deprecado a clientes antiguos. Esa retención evita aceptar de nuevo el mecanismo que originó el problema.

## Secuencia de la corrección

Primero se fijó el contrato de ubicaciones de lectura y se hizo que el router, la validación y la limpieza usaran el mismo visitante. Después se actualizaron los diálogos para devolver capacidades alineadas. Luego se migraron los llamadores por subsistema y se añadieron tests de payloads anidados, inmutabilidad y ciclo de vida de tokens. Finalmente se retiraron el registro de rutas del renderer y los helpers que solo servían para ese registro.

La evidencia del contrato y de la simplificación está en [01_ipc-contract.md](01_ipc-contract.md). La migración de UI y exportadores está en [02_renderer-migrations.md](02_renderer-migrations.md). Los comandos y resultados están en [03_verification.md](03_verification.md).
