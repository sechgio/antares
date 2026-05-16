# Panel Aviso Bulk Images Design

## Goal

Permitir lotes grandes de imagenes en Panel Aviso de Corte, con soporte practico para al menos 300 fotos de alta calidad, sin cambiar el flujo de uso ni inflar innecesariamente memoria durante la exportacion.

## Current Problem

La UI muestra un limite por imagen de 15 MB y `exportPanelDocument` convierte todas las imagenes seleccionadas a base64 antes de enviarlas por IPC. En lotes grandes, ese payload duplica el peso de los archivos en memoria y vuelve fragil la exportacion aunque cada imagen individual sea valida.

## Chosen Approach

1. Mantener el limite por archivo como proteccion individual, pero dejar de presentarlo como una restriccion del lote.
2. Guardar una ruta local opcional por imagen cuando Electron la expone.
3. Al exportar, enviar rutas locales para las imagenes disponibles en disco y usar base64 solo como fallback cuando no exista ruta.
4. Hacer que el backend acepte ambos orígenes y resuelva cada imagen desde ruta o base64 sin alterar el renderizado actual.

## Data Flow

1. El usuario carga imagenes por selector o arrastre.
2. `usePanelSession` conserva `File`, `objectUrl` y `localPath` opcional.
3. `exportPanelDocument` construye:
   - `image_paths` para archivos con ruta local.
   - `images` base64 solo para archivos sin ruta local.
4. El handler backend normaliza ambas fuentes.
5. El renderizador consume bytes de imagen sin saber si vinieron de ruta o base64.

## Scope

Incluido:
- Lotes grandes de imagenes.
- Compatibilidad con archivos sin ruta local.
- Ajuste del texto de ayuda de la UI.
- Cobertura automatizada del contrato nuevo.

Fuera de alcance:
- Eliminar toda proteccion por archivo.
- Streaming por chunks.
- Cambiar la estructura de paneles de 4 imagenes.

## Testing

- Frontend: el payload de exportacion debe preferir `image_paths` y codificar en base64 solo los fallbacks.
- Backend: el handler debe aceptar rutas y seguir aceptando base64.
- Regresion: el flujo existente con base64 puro debe continuar funcionando.
