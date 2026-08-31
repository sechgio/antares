# Migraciones del renderer

## Conversión

`ConversionView` mantiene una lista de nombres o rutas para la selección visual, pero separa las referencias de lectura en `useConversionFileRefs`. Los diálogos entregan tokens. Los arrastres y pegados conservan el objeto `File`. El hook escenifica esos objetos con concurrencia limitada cuando una operación necesita enviarlos a IPC.

La vista previa, la detección de mapeos y el inicio del proceso reciben referencias resueltas. La cola de preview conserva la función de resolución junto con los argumentos, así una ejecución pendiente no reutiliza un mapa de tokens viejo. El historial limpia las referencias anteriores. En Electron, una restauración histórica sin permisos vuelve a pedir los archivos antes de habilitar el proceso.

`Thumbnail`, `FileCard` y `FileGrid` reciben el token o el objeto `File` correspondiente. Un path histórico sin token no llega a `local_thumbnail`. El preview de una imagen arrastrada puede escenificar el `File`, y el token se limpia al terminar la llamada.

## Sellador

El diálogo de PDF exige un `antares-read_` válido antes de inspeccionar el archivo. Un PDF seleccionado mediante input se escenifica para inspección si existe el puente Electron; el navegador conserva el fallback Base64 acotado. La aplicación final escenifica de nuevo el PDF y el sello, porque los tokens de una llamada anterior ya no son válidos después de la limpieza.

`PdfPagePreview` y `previewRender` reciben el `File` y escenifican por render cuando no tienen un token de diálogo. El cache incluye identidad del archivo o del token para no presentar una imagen de otro documento.

## Panel y Evidencia volanteo

Los modelos de imagen activos contienen el `File` y su object URL, no una ruta nativa. Los exportadores generan mapas de tokens para las imágenes. PDF con HTML usa `data:` porque WeasyPrint necesita contenido embebido. DOCX y exportaciones que no generan HTML pueden entregar rutas resueltas por capability. Sin puente Electron, ambos flujos usan Base64.

La plantilla de Excel del Panel usa `output_path`, que es un campo de escritura. El backend acepta todavía `path` para clientes antiguos, pero la UI nueva ya no confunde ese destino con una ubicación de lectura.

## Informes V2, reportes de campo y canvas

Los exportadores PDF reutilizan `fileToPdfImageSource` e `imageToPdfSource`. Esos helpers escenifican el archivo original o una versión comprimida y registran solo el token en `localImagePaths`. El HTML usa referencias lógicas `antares-local-image:*`; Electron las expande después de validar el token y las extensiones.

Informes V2 envía `images` e `images_by_id` con referencias lógicas y el mapa de tokens separado. El editor canvas y reportes de campo siguen el mismo contrato. Los logos que no proceden de un `File` conservan una `data:` URI, sin enviar rutas nativas.

## Compatibilidad y datos antiguos

El almacenamiento de Evidencia deja de guardar `localPath`. Al restaurar sesiones antiguas, el campo puede existir en IndexedDB, pero ningún exportador lo reenvía. Esto permite abrir datos viejos sin conservar una vía de lectura que el router ya no acepta.

La API pública del renderer ya no expone `registerLocalPath`. `getPathForFile` se conserva solo para identidad visual de archivos arrastrados y no es una autorización de lectura. El backend conserva el nombre `register_local_path` únicamente para responder con un error de deprecación a clientes antiguos.
