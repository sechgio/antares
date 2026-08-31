# Verificación

## Resultados concluyentes

El compilador TypeScript terminó sin errores con:

```text
npm exec -- tsc --noEmit
```

La suite enfocada cubrió nueve archivos y 62 tests. Se ejecutó con un worker para evitar el fallo de arranque de workers observado en este entorno:

```text
npm exec -- vitest run src/components/conversion/ConversionView.preview.test.tsx src/components/conversion/useConversionFileRefs.test.ts src/components/evidencia-volanteo/utils/exportDocument.test.ts src/components/informes-v2/exportPdf.test.ts src/components/panel-aviso-corte/utils/exportPdf.test.ts src/components/preview-panel/pdfExport.test.ts src/utils/pdfAssets.getPath.test.ts src/components/Thumbnail.test.tsx src/components/reportes-campo/utils/export.test.ts --pool=threads --maxWorkers=1
```

El chequeo estático terminó con 7 archivos y 22 tests verdes:

```text
npm run test:static
```

Las pruebas Python dirigidas a Panel de aviso de corte, mapeo de base de datos y Sellador terminaron con 163 tests verdes:

```text
uv run --project . --locked --extra dev pytest tests/panel_aviso_corte tests/test_database_mapping.py tests/test_sellador_handler.py -q
```

La batería nativa terminó con estos resultados. `tests/test-electron-dialogs.js` tuvo una carrera del fixture en el primer intento, cuando el segundo `DeferredBrowserWindow` todavía no había instalado `resolvePrint`. El rerun pasó 88 de 88. Las demás suites pasaron en el mismo turno.

```text
node tests/test-electron-dialogs.js                 88 passed, 0 failed
node tests/test-ipc-router-lazy-ubicaciones.js      14 passed, 0 failed
node tests/test-electron-ipc-allowlist.js           pass, 142 API methods, 45 long-running
node tests/test-electron-native-parity.js             7 passed, 0 failed
node tests/test-file-staging.js                       pass
node tests/test-local-thumbnail-disk.js               pass
node tests/test-ipc-spreadsheet-tokenize.js           pass
node tests/test-ipc-temp-cleanup.js                   pass
node tests/test-html-to-pdf-return-base64.js          pass, 407 files scanned
node tests/test-path-allowlist.js                     5 passed, 0 failed
node tests/test-ipc-router-write-validation.js       28 checks, 0 failures
```

`git diff --check` no encontró errores de whitespace. Git mostró advertencias normales de conversión LF a CRLF para archivos editados en Windows.

## Ejecuciones no concluyentes

Se intentó la suite global de Vitest con un worker y con la configuración paralela por defecto. En ambos casos el proceso permaneció activo sin reporter ni resultado durante varios minutos. Se detuvo la ejecución para evitar dejar un proceso indefinido. Esa observación no se cuenta como una suite verde ni como un fallo de test.

La cobertura enfocada contiene los módulos modificados y los caminos de staging, tokens, previews y exportaciones. La suite estática cubre invariantes de estructura. La batería nativa cubre el límite IPC y el ciclo de vida de capacidades. Python cubre los handlers afectados.

## Auditoría de los hallazgos no reproducibles

Estas búsquedas no devolvieron coincidencias en el HEAD revisado:

```text
file_token_read_chunk
isTrustedThumbnailUrl
redirect: 'error'
```

`register_local_path` sí aparece como compatibilidad nativa y en su test de rechazo. No aparece una exposición activa desde `preload.js` ni una llamada de la UI. `localPath` solo queda en el tipo de sesiones antiguas de Evidencia.
