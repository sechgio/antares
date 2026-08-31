# Contrato IPC y límites de lectura

## Problema revisado

El router empezó a rechazar rutas absolutas en campos de lectura, pero los llamadores seguían enviando rutas nativas. El código también tenía listas de campos repetidas para resolver tokens y limpiarlos. Esa combinación permitía que una corrección en un punto dejara otro punto desalineado.

## Cambio estructural

`electron/file-token-contract.js` concentra las posiciones de lectura. El contrato declara campos escalares como `path`, `mapping_path`, `pdf_path` y `stamp_path`, arrays como `files` y `file_tokens`, mapas como `image_paths` y `localImagePaths`, y los objetos con `path` que aparecen en `images` e `images_by_id`.

El visitante no baja recursivamente por un objeto. Entra solo en esas posiciones. Por eso `images[].name`, `filename`, `content_b64`, etiquetas y valores desconocidos no se pueden convertir accidentalmente en rutas. El mismo recorrido alimenta la validación de rutas, la resolución de tokens y la recolección para limpieza.

`mapReadLocations` devuelve un payload nuevo cuando encuentra cambios. Clona cada contenedor modificado una sola vez y deja intactos el objeto original y los campos que no pertenecen al contrato. Esto evita que la resolución de una llamada IPC modifique el estado que el renderer puede reutilizar.

`electron/file-token-routing.js` resuelve solo tokens con el prefijo exacto `antares-read_`. Conserva el nombre del capability en los campos de resultado que usa el backend para nombrar spills. También centraliza la recolección y la limpieza de capacidades escenificadas. Las operaciones `file_token_*` quedan fuera de esa limpieza automática porque administran explícitamente su propio ciclo de vida.

`electron/file-capabilities.js` usa el mismo visitante para rechazar rutas absolutas crudas en las ubicaciones de lectura. Las rutas de salida mantienen una lista separada de campos de escritura y reciben validación de bytes nulos y traversal antes de pasar al resolver de escritura. Las referencias lógicas de `localImagePaths`, como `data:`, `blob:`, URLs HTTP(S), assets de canvas y tokens de lectura, no se interpretan como rutas del sistema.

Los métodos legacy que todavía usan `path` como destino (`db_export`, `db_template`, `spreadsheet_export_volantes_template` y `panel_aviso_corte_template`) se identifican por método antes de validar. En esos cuatro casos el campo pasa al resolver de escritura; en cualquier otro método `path` sigue siendo una ubicación de lectura. Esta separación evita que el nombre histórico del campo deshaga la frontera nueva.

## Capacidades creadas por diálogos

`dialog_files` y `dialog_folder` devuelven `file_tokens` en el mismo orden que `paths`. Cancelaciones y `pickOnly` devuelven un array vacío de tokens. Cada token queda ligado al `webContents.id` de la ventana que abrió el diálogo. `dialog_dest` no crea capacidades de lectura porque su resultado es un destino de escritura.

Las capacidades creadas por diálogo sobreviven hasta su TTL normal. Las capacidades creadas por staging son temporales para una operación. El router las elimina en `finally`, incluso si el backend falla. Los exportadores que construyen HTML también limpian sus tokens locales antes de terminar.

## Código que se pudo eliminar

El router perdió tres recorridos duplicados y la UI dejó de llamar a `registerLocalPath`. También se eliminó `frontend/src/utils/registerLocalPath.ts`, el campo `localPath` de los modelos vivos y el registro previo de archivos en Panel, Evidencia, Informes V2 y exportaciones PDF. El campo `localPath` que queda en `StoredImage` está marcado como legado y solo permite leer sesiones antiguas sin volver a escribir ese valor.

La simplificación conserva una única decisión importante. Un archivo nativo entra como capability. Un `File` entra por staging. Un entorno sin puente Electron usa Base64 cuando el flujo lo admite. No existe una cuarta vía que vuelva a registrar rutas arbitrarias.

## Evidencia

`tests/test-ipc-router-write-validation.js` prueba los campos reales anidados, rechaza una ruta absoluta en `image_paths`, verifica que nombres y contenido no se inspeccionan, comprueba que el resolver no muta el payload y valida la eliminación de tokens escenificados.

`tests/test-electron-dialogs.js` verifica tokens alineados para archivos y carpetas, respuestas vacías en cancelación y `pickOnly`, y la deprecación de `register_local_path`.

La revisión de referencias del repositorio no encontró llamadas activas a `registerLocalPath`, `file_token_read_chunk`, `isTrustedThumbnailUrl` ni `redirect: 'error'`. Los dos últimos hallazgos no requieren una modificación porque esos símbolos no están en este HEAD.
