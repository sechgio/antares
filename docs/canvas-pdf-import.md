# Importación PDF en Canvas

Antares permite importar un PDF desde `Canvas → Importar PDF`. El flujo analiza el archivo en segundo plano, muestra un preflight de páginas y aplica el resultado como una sola operación de historial cuando termina.

## Qué se importa

El MVP convierte a capas editables los elementos que tienen semántica suficiente:

- texto con posición, tamaño y estilo básico;
- rectángulos, elipses y líneas simples;
- imágenes, persistidas como `canvas-asset:` cuando el almacén local está disponible;
- checkboxes AcroForm reconocibles.

Trazos curvos, clipping, transparencias, operadores desconocidos, fuentes no representables y páginas escaneadas se conservan en el informe como aproximados u omitidos. Un escaneo no produce texto editable sin OCR. Las tablas dibujadas con líneas no se convierten automáticamente en una capa `table`, ni un campo o componente se infiere por apariencia.

## Límites y protección de rendimiento

Los límites iniciales son:

- 100 MiB por archivo;
- 50 páginas por importación;
- 200.000 operadores por página;
- 2.000 elementos de texto por página;
- 100 imágenes por página;
- 400 capas por página y 1.000 capas por documento;
- 64 MiB agregados de imágenes;
- 2 MiB para el manifiesto semántico.

El diálogo limita el rango seleccionable a las primeras 50 páginas del archivo para mantener acotado el preflight; la importación nunca procesa más de ese presupuesto.

El trabajo usa PDF.js de forma diferida: Canvas no carga su código en la ruta inicial. La extracción cede el control al navegador entre páginas, permite cancelar y nunca modifica el documento hasta que el job termina correctamente. Una cancelación o error no deja un documento parcial.

Los PDFs con tamaños de página mixtos se rechazan por defecto. El diálogo ofrece escalar las páginas al tamaño de la primera cuando el usuario lo solicita explícitamente.

## Informe y round-trip

El informe distingue entre capas importadas, contenido aproximado u omitido y advertencias por página. Los elementos no soportados no se eliminan silenciosamente.

Los PDFs exportados por Antares incluyen el attachment `antares-canvas-manifest.json`. Si el manifiesto es válido y sus referencias locales están disponibles, la reimportación reconstruye las capas, estilos, páginas y referencias semánticas sin aplicar heurística. Sin ese manifiesto o sin los assets locales, el importador usa la extracción aproximada.

La reconstrucción exacta se aplica únicamente a PDFs que conservan ese manifiesto y sus assets. El modo de referencia visual de página completa queda fuera de este MVP.

## Cancelación, guardado y exportación

El botón `Cancelar` detiene la extracción o persistencia en curso. Los assets creados durante una cancelación permanecen sujetos al recolector existente de assets y no se añaden al documento hasta el commit atómico.

Después de importar, el documento sigue usando el historial, autosave y GC de Canvas. RGB y CMYK mantienen su comportamiento existente; CMYK conserva su fallback para tipos que el renderer nativo no puede representar.

## Ejemplos

Buenos candidatos: formularios con texto y checkboxes, diagramas con rectángulos/elipses/líneas simples, y PDFs de una plantilla Canvas exportada por Antares.

Resultados parciales esperables: documentos escaneados, PDFs con muchas transparencias o máscaras, ilustraciones vectoriales con curvas, y tablas cuyo contenido solo está dibujado visualmente.
