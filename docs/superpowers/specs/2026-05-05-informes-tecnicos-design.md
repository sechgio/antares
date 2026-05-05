# Spec: Informes Tecnicos - Integracion Nativa en COSMO Desktop

## Fecha
2026-05-05

## Resumen
Integrar una nueva seccion llamada "Informes tecnicos" en COSMO Desktop, basada en la herramienta `technical_reports` del proyecto de referencia. La integracion debe ser completa y nativa: CRUD de informes, importacion CSV/XLSX, persistencia local, edicion, vista previa A4, logos y exportacion PDF individual/consolidada dentro de la arquitectura Electron + React + backend Python por IPC.

## Contexto
- COSMO usa Electron como shell de escritorio, React 18/Vite en frontend y un backend Python comunicado por JSON-RPC sobre stdin/stdout.
- El proyecto de referencia usa FastAPI, routers HTTP, autenticacion web, SSE y generacion PDF con WeasyPrint.
- La nueva herramienta debe conservar el comportamiento funcional de referencia, pero no debe introducir un servidor FastAPI ni depender de rutas HTTP.
- Electron ya expone `html_to_pdf`, que convierte HTML a PDF con `BrowserWindow.printToPDF`; esta capacidad debe usarse para mantener la generacion PDF dentro de la app.
- Existen cambios locales no relacionados en `frontend/src/components/preview-panel/PreviewPanelView.tsx` y `frontend/src/components/preview-panel/PreviewPanelView.test.tsx`; la implementacion debe evitarlos salvo que una integracion real lo exija.

## Objetivos
- Agregar una pestaña "Informes tecnicos" visible en `Sidebar`, `Header` y `CommandPalette`.
- Portar el modelo de datos de `technical_reports` con datos anidados para metadata, cabecera, inspeccion, valvulas, canastillas y medidas.
- Persistir informes en `data/technical_reports.json`.
- Importar archivos `.csv` y `.xlsx` con normalizacion flexible de columnas equivalente a la referencia.
- Permitir listar, buscar, seleccionar, editar, guardar, eliminar y limpiar informes.
- Renderizar una vista previa A4 fiel al template `informe_tecnico.html`.
- Exportar PDF individual con logos opcionales.
- Exportar PDF consolidado para todos los informes o para un subconjunto seleccionado.
- Mantener el flujo completamente funcional sin backend HTTP.

## Fuera de Alcance
- Autenticacion, roles de usuario o permisos administrativos de la referencia web.
- SSE real para progreso de PDF consolidado. En escritorio se usaran estados de carga en React y, si hace falta, notificaciones IPC simples.
- Ghostscript y compresion avanzada de PDF.
- Sincronizacion con servicios externos o almacenamiento remoto.
- Reescrituras de modulos existentes no relacionados.

## Arquitectura
La herramienta se implementara como un modulo nativo de COSMO:

1. **Backend Python**
   - Nuevo paquete `backend/core/technical_reports/`.
   - Modelos de dominio con validacion y normalizacion de legacy data.
   - Base JSON thread-safe para `data/technical_reports.json`.
   - Servicio de importacion CSV/XLSX con mapeo de columnas, transformacion plana a anidada y generacion de IDs `RPT-0001`.
   - Servicio de render HTML con Jinja2 para informe individual y consolidado.
   - Handlers IPC en `backend/handlers.py` que exponen la funcionalidad al frontend.

2. **Frontend React**
   - Nuevo modulo `frontend/src/components/technical-reports/`.
   - API typed wrapper en `frontend/src/api.ts` para los metodos IPC.
   - Layout de tres zonas: base/listado, preview y formulario.
   - La vista previa se renderizara en React para edicion inmediata; la exportacion PDF usara HTML generado por backend para mantener fidelidad con el template.

3. **Electron**
   - Reutilizar `html_to_pdf`.
   - Ampliar el dialogo de guardado solo si se necesita un filtro/defaultPath especifico para PDFs.

## Backend

### Archivos
- `backend/core/technical_reports/__init__.py`
- `backend/core/technical_reports/models.py`
- `backend/core/technical_reports/database.py`
- `backend/core/technical_reports/importer.py`
- `backend/core/technical_reports/rendering.py`
- `backend/templates/technical_reports/informe_tecnico.html`
- `backend/handlers.py`
- `backend/utils/paths.py` si se necesita un helper compartido de ruta de datos

### Modelo
El modelo seguira la estructura de referencia:
- `ReportMetadata`: `informe_id`, `dia`, `mes`, `anio`, `pagina`.
- `ReportHeader`: `cs`, `contratista`, `codigo_infraestructura`, `ubicacion`, `suministro`, `tipo`, `volumen`.
- `InspeccionDescripcion`: estados `normal`, `critico`, `unchecked` y observaciones/sugerencias por item.
- `ValvulasData`: diametros, impulsion, aduccion, bypass, desague, totales y textos.
- `CanastillasData`: diametros, aduccion, succion, desague, totales y textos.
- `MedidasData`: diametro, diametro interno, altura util y altura total.
- `TechnicalReport`: `id`, bloques anidados, observaciones, sugerencias, `status`, `last_modified`.

La validacion debe aceptar datos legacy/incompletos y completar defaults para no romper imports o archivos JSON existentes.

### Persistencia
- El archivo local sera `data/technical_reports.json`.
- El formato sera un diccionario por ID para lecturas directas y actualizaciones simples.
- Las operaciones de escritura seran atomicas a nivel de archivo: escribir temporal y reemplazar.
- La base expondra `get_all`, `get`, `create`, `update`, `delete`, `clear_all` e `import_reports`.

### Importacion
El importador debe aceptar:
- CSV con separador coma o punto y coma.
- XLSX usando `openpyxl`, ya disponible en `pyproject.toml`.
- Headers con acentos, espacios, guiones, puntos y variaciones humanas.
- Mes numerico o texto.
- Estados de inspeccion tipo `X`, `NORMAL`, `BUENO`, `CRITICO`, `MALO`, `NO`, etc.

El resultado debe reemplazar registros existentes por defecto, como la referencia, y devolver:
- `success`
- `message`
- `deleted_count`
- `imported_count`
- `total_rows_in_file`

### IPC
Metodos propuestos:
- `technical_reports_list`: filtros opcionales `cs`, `contratista`, `status`, `summary`.
- `technical_reports_get`: obtiene un informe por ID.
- `technical_reports_create`: crea un informe.
- `technical_reports_update`: actualiza un informe.
- `technical_reports_delete`: elimina un informe.
- `technical_reports_clear`: elimina todos.
- `technical_reports_import_file`: recibe `filename`, `content_b64` y reemplaza los informes.
- `technical_reports_variables`: devuelve catalogo de variables del template.
- `technical_reports_autocomplete_cs`: lista centros de servicio unicos.
- `technical_reports_autocomplete_contratista`: lista contratistas, filtrable por `cs`.
- `technical_reports_render_html`: render individual con logos opcionales.
- `technical_reports_render_consolidated_html`: render consolidado con IDs opcionales y logos opcionales.

Los handlers deben devolver errores claros para import vacio, formato no soportado, informe no encontrado y PDF sin datos.

## Frontend

### Archivos
- `frontend/src/components/technical-reports/index.ts`
- `frontend/src/components/technical-reports/TechnicalReportsApp.tsx`
- `frontend/src/components/technical-reports/DatabasePanel.tsx`
- `frontend/src/components/technical-reports/FormPanel.tsx`
- `frontend/src/components/technical-reports/PreviewPanel.tsx`
- `frontend/src/components/technical-reports/types.ts`
- `frontend/src/components/technical-reports/api.ts`
- `frontend/src/components/technical-reports/technical-reports.css`
- `frontend/src/App.tsx`
- `frontend/src/components/layout/Sidebar.tsx`
- `frontend/src/api.ts`

### Layout
- **Panel izquierdo:** importar CSV/XLSX, recargar, limpiar, buscador, filtro por C.S. y listado de informes.
- **Centro:** preview A4 scrollable con encabezado, metadata, datos generales, inspeccion, valvulas, canastillas, medidas y actividades.
- **Panel derecho:** formulario editable con secciones para cabecera, inspeccion, valvulas, canastillas, medidas, observaciones/sugerencias y logos.
- **Barra superior del modulo:** titulo, navegacion anterior/siguiente, indicador de posicion, descargar PDF y PDF consolidado.

### Comportamiento
- Al abrir la seccion, cargar resumen de informes.
- Al seleccionar un informe, cargar el detalle completo.
- Si hay cambios sin guardar y el usuario cambia de informe, pedir confirmacion con el dialogo existente de la app o guardar primero si se implementa como accion explicita.
- Guardar actualiza backend y refresca resumen.
- Importar reemplaza la base local y refresca la lista.
- Eliminar todo pide confirmacion.
- Los logos se cargan como `File`, se convierten a data URL y se envian al backend para render HTML.
- La descarga individual pedira al backend HTML de un informe y luego llamara `api.htmlToPdf`.
- La descarga consolidada pedira HTML consolidado y luego llamara `api.htmlToPdf`.

## Diseno Visual
- Seguir la personalidad actual de COSMO: herramienta de trabajo densa, organizada y escaneable.
- Evitar landing pages o textos explicativos visibles.
- Usar iconos `lucide-react` para acciones.
- Mantener radios de 8px o menos para tarjetas/paneles.
- La preview del documento debe conservar fondo blanco y no heredar el tema oscuro.
- El modulo puede reutilizar el tono tecnico de la referencia, pero debe integrarse con variables CSS existentes de COSMO para no sentirse como una app incrustada.

## Exportacion PDF
- `technical_reports_render_html` renderiza el template `informe_tecnico.html` con un informe y logos.
- `technical_reports_render_consolidated_html` renderiza todos los informes en un unico HTML con saltos de pagina.
- `api.htmlToPdf({ html, filename })` genera el PDF desde Electron.
- El frontend descarga el `pdf_base64` recibido como blob.
- El nombre individual sera `informe_<id>.pdf`.
- El nombre consolidado sera `informes_tecnicos_consolidado_<cantidad>.pdf`.

## Testing

### Backend
- Test de normalizacion de headers.
- Test de parse CSV con separador `;`.
- Test de parse XLSX minimo.
- Test de transformacion plana a estructura anidada.
- Test de importacion con reemplazo de registros.
- Test CRUD JSON en `tmp_path`.
- Test render HTML con un informe minimo y logos vacios.
- Test handlers IPC principales.

### Frontend
- Test de navegacion: la nueva pestaña aparece y renderiza la vista.
- Test del wrapper API: cada metodo llama al IPC correcto.
- Test de panel/lista basico si el componente se mantiene pequeno y testeable.

### Verificacion Manual
- Importar un `.xlsx` de ejemplo.
- Seleccionar informe, editar campos y guardar.
- Confirmar que la preview refleje cambios.
- Descargar PDF individual.
- Descargar PDF consolidado.
- Reiniciar la app y verificar persistencia local.

## Riesgos y Mitigaciones
- **Diferencia FastAPI vs IPC:** aislar la logica de dominio en servicios puros y dejar handlers pequenos.
- **Fidelidad del PDF:** usar el HTML/template de backend para exportar, no una captura del DOM editable.
- **Performance consolidado:** generar un unico HTML paginado primero; si el volumen real crece demasiado, agregar batch/progreso IPC despues.
- **Datos importados con columnas raras:** portar el mapeo flexible de referencia y cubrirlo con tests.
- **Cambios locales existentes:** no editar archivos de preview-panel salvo necesidad directa.

## Criterios de Aceptacion
- La seccion "Informes tecnicos" aparece en la navegacion principal y en la paleta de comandos.
- Se puede importar CSV/XLSX y ver el conteo de informes importados.
- Los informes persisten en `data/technical_reports.json`.
- Se puede seleccionar, editar, guardar, eliminar y limpiar informes.
- La preview A4 muestra la informacion del informe seleccionado.
- Se puede generar PDF individual con logos.
- Se puede generar PDF consolidado.
- Tests backend/frontend enfocados pasan.
- `npm run typecheck:frontend` y las pruebas relevantes pasan o se documenta cualquier fallo preexistente no relacionado.
