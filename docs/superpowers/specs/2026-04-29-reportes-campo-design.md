# Spec: Reportes de Campo — Integración en HidroConvert Desktop

## Fecha
2026-04-29

## Resumen
Integrar la herramienta "Reportes de Campo" en la aplicación HidroConvert Desktop (Electron + IPC Python). Esta herramienta permite a técnicos de campo generar reportes PDF con encabezados personalizados, logos institucionales y paneles fotográficos organizados en hojas A4.

## Contexto
- El proyecto HidroConvert Desktop usa Electron + React 18 + IPC Python (JSON-RPC via stdin/stdout).
- El backend no tiene WeasyPrint instalado ni usa FastAPI.
- La feature original `reportes-campo` en la carpeta `FEATURES` estaba diseñada para FastAPI + WeasyPrint + SPA con routing.
- Esta versión adapta la funcionalidad completa al modelo Desktop IPC, usando generación de PDF 100% cliente-side.

## Stack de Generación PDF (Decisión)
- **jsPDF** (ya instalado en `package.json`) para armar el PDF multi-página.
- **html-to-image** (ya instalado en `package.json`) para capturar las vistas previas como PNG y embeberlas en el PDF.
- **Sin cambios en el backend** — todo el procesamiento ocurre en el frontend.

## Tipos de Reporte Soportados
| ID | Nombre | Descripción |
|----|--------|-------------|
| `panel-fotografico` | Panel Fotográfico | Reporte con 4 fotos por hoja A4 |
| `desinfeccion-reservorios` | Desinfección de Reservorios | Reporte técnico de desinfección |
| `maquina-balde` | Máquina de Balde | Reporte de trabajo con máquina de balde |

## Estructura de Archivos
```
frontend/src/components/reportes-campo/
├── index.ts                          # Export default
├── ReportesCampoView.tsx              # Vista principal (sidebar + canvas)
├── constants.ts                     # Configuraciones de tipos de reporte
├── types.ts                         # Tipos TypeScript
├── rcampo-styles.css                # Estilos específicos del módulo
├── components/
│   ├── HeaderForm.tsx               # Formulario de datos + logos
│   ├── PhotoManager.tsx             # Gestor de fotos (drag-drop + export)
│   └── SheetPreview.tsx             # Vista previa de hoja A4
└── utils/
    └── exportPdf.ts                 # Generación de PDF con jsPDF + html-to-image
```

## Integración en App Principal
- Nueva pestaña `reportes-campo` en `App.tsx` con shortcut `Ctrl+8`
- Nuevo comando en `CommandPalette`
- Icono en `Sidebar` (usar `Camera` de lucide-react)

## Componentes

### ReportesCampoView.tsx
Layout de tres zonas:
1. **Header toolbar**: selector de tipo de reporte (pills), navegación de páginas, badge de hojas
2. **Sidebar** (resizeable, 220-400px): formulario + gestor de fotos
3. **Canvas**: vista previa de hoja A4 con animaciones de Framer Motion

### HeaderForm.tsx
- Secciones colapsables: Datos Generales, Localización, Orden de Trabajo
- Campos configurados dinámicamente según el tipo de reporte activo
- Upload de logos (izquierdo y derecho)
- Reset de datos al cambiar de tipo de reporte

### PhotoManager.tsx
- Dropzone para drag-and-drop de imágenes
- Input file oculto para selección manual
- Contador de fotos y hojas
- Botón "Limpiar" para eliminar todas las fotos
- Botón "Exportar PDF" (deshabilitado si no hay fotos)

### SheetPreview.tsx
- Renderizado de hoja A4 (210mm × 297mm) en px a 96 DPI
- Header con título, logos y barra de info
- Secciones: 1.0 Localización, 2.0 Detalles de Orden de Trabajo (opcional)
- 3.0 Panel Fotográfico: grid 2×2 con fotos, o layout especial para 3 fotos (centrado, span 2)
- Navegación de páginas con numeración

### exportPdf.ts
```typescript
async function exportReportPdf(
  previews: HTMLElement[],  // refs de cada SheetPreview
  filename: string
): Promise<void>
```
- Itera cada página visible
- Usa `html-to-image.toPng()` para capturar cada `SheetPreview`
- Crea documento jsPDF en orientación portrait, formato A4
- Inserta cada imagen capturada como página del PDF
- Dispara descarga automática del archivo

## Datos y Estado
- Estado local en `ReportesCampoView` (sin backend):
  - `reportType`: tipo activo
  - `header`: Record<string, string> con valores de campos
  - `photos`: PhotoFile[] (id, file, previewUrl)
  - `logoLeft` / `logoRight`: LogoData | null
  - `currentPage`: número de página activa
- Los datos no se persisten entre sesiones (scope: generación puntual)

## Estilos
- Adaptar tema al design system de HidroConvert:
  - Fondo de canvas: `#0A0A0A` (oscuro)
  - Papel de preview: `#FCFBFA` (Lifted Cream)
  - Texto: `#141413` (Ink Black)
  - Sidebar: fondo oscuro del proyecto
- `rcampo-styles.css` contendrá estilos específicos del módulo (dropzone, inputs, pills)
- TailwindCSS para layout macro (flex, h-screen, etc.)

## Shortcuts
| Shortcut | Acción |
|----------|--------|
| Ctrl+8 | Ir a Reportes de Campo |
| Ctrl+Enter | Exportar PDF (si hay fotos) |

## Tests
- No se agregan tests unitarios nuevos (scope de integración)
- Verificación manual: seleccionar tipo, llenar campos, subir 4+ fotos, exportar PDF

## Dependencias
Sin nuevas dependencias. Se usan librerías ya instaladas:
- `jspdf`
- `html-to-image`
- `framer-motion`
- `lucide-react`
