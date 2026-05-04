# COSMO

> Conversor y renombrador profesional de imágenes — aplicación de escritorio nativa.

## Características

- **Conversión de imágenes**: Soporta JPEG, PNG, WebP, BMP, TIFF, GIF, ICO, PDF con control de calidad y redimensionamiento
- **Renombrado automático**: Motor basado en patrones que integra con base de datos SQLite para renombrar archivos automáticamente
- **Procesamiento por lotes**: Procesa múltiples archivos simultáneamente con barra de progreso en tiempo real y procesamiento paralelo (ThreadPoolExecutor)
- **Soporte de video**: Copia y renombra archivos de video (MP4, AVI, MOV, MKV, WMV, FLV, WEBM, etc.) sin conversión
- **Gestión de base de datos**: Importar/exportar datos desde Excel (.xlsx), campos personalizados configurables, generación de plantillas
- **Formatos PDF con correlativo**: Generador de PDFs con numeración correlativa soportando XObject legacy, visual overlay y simple overlay
- **Padrones y Volantes**: Módulos dedicados para generación de padrones y volantes con previsualización
- **Reportes de Campo**: Gestión de reportes con fotos, hojas de datos y exportación
- **Optimizador de Imágenes**: Pipeline de optimización con previsualización, crop, ajustes y exportación ZIP
- **Historial completo**: Registro de todas las ejecuciones por tipo (conversión, formato, padrón, volante) con opción de re-ejecutar configuraciones previas
- **Auto-actualizaciones**: Sistema de actualización automática integrado (GitHub Releases)
- **Vista previa de imágenes**: Previsualización de conversiones antes de procesar, con drawer interactivo
- **Command Palette**: Búscula y navegación rápida entre secciones con `Ctrl+K`
- **Temas personalizables**: 12 presets de tema integrados + editor de colores con identidad Precision Linear
- **Internacionalización**: Español e inglés (frontend y backend)
- **Sistema de plugins**: Extensión de formatos vía archivos Python en directorio de usuario

## Arquitectura

Aplicación de escritorio construida con:

- **Electron** — Shell nativo de escritorio (Windows, macOS, Linux)
- **React + TypeScript + Vite** — Frontend con TailwindCSS para estilos
- **Python (JSON-RPC over stdin/stdout)** — Backend de procesamiento de imágenes (no FastAPI)
- **SQLite** — Base de datos embebida para catálogo de archivos e historial
- **JSON-RPC over stdin/stdout** — Comunicación segura entre Electron y Python (no HTTP)

### Patrones clave:
- Electron spawn el backend Python como proceso hijo
- Comunicación bidireccional: requests síncronos (IPC handle) + notificaciones push desde backend (stdout → evento renderer)
- Diálogos nativos delegados a Electron (dialog-handlers.js), no al backend
- Estado de proceso centralizado en memoria con notificaciones push (`process.progress`, `process.complete`)
- Notificaciones push del backend al frontend via `ipc-notify`

### Estructura del proyecto

```
COSMO/
├── electron/                  # Capa de escritorio Electron
│   ├── main.js               # Proceso principal (ventanas, IPC, auto-updater)
│   ├── preload.js            # Bridge seguro para el renderer (contextBridge)
│   ├── backend-command.js    # Resolución de ruta del backend (dev/prod)
│   └── dialog-handlers.js    # Diálogos nativos delegados al main process
├── frontend/                  # Interfaz de usuario React
│   ├── src/
│   │   ├── App.tsx           # Componente principal con navegación lateral
│   │   ├── api.ts            # Cliente IPC (JSON-RPC)
│   │   ├── types.ts          # Tipos TypeScript compartidos
│   │   ├── i18n.ts           # Internacionalización vía i18next
│   │   ├── main.tsx          # Entry point React
│   │   ├── components/
│   │   │   ├── conversion/   # Vistas de conversión (Dropzone, FileGrid, OptionsCard, RenameCard...)
│   │   │   ├── database/     # Vista de base de datos
│   │   │   ├── formatos/     # Generador de formatos PDF
│   │   │   ├── padron/       # Generador de padrones
│   │   │   ├── volantes/     # Generador de volantes
│   │   │   ├── reportes-campo/ # Reportes de campo
│   │   │   ├── image-optimizer/ # Pipeline de optimización de imágenes
│   │   │   ├── history/      # Historial de ejecuciones
│   │   │   ├── settings/     # Configuración de apariencia
│   │   │   ├── layout/       # Sidebar + Header
│   │   │   ├── ui/           # Componentes reutilizables (Toast, Dialog, Badge, Button, etc.)
│   │   │   └── brand/        # Marca/Logo componente
│   │   ├── hooks/            # Custom hooks (useToast, useDialog, useThemeMode, etc.)
│   │   └── locales/          # Archivos i18n del frontend (es/en)
│   └── package.json
├── backend/                   # Lógica de procesamiento Python
│   ├── main.py               # Entry point (bucle IPC, handshake, señales)
│   ├── handlers.py           # Router JSON-RPC → handlers (43+ métodos)
│   ├── ipc_protocol.py       # Protocolo IPC JSON-RPC (lectura/escritura/validación)
│   ├── version.py            # Versión centralizada
│   ├── core/                 # Lógica de negocio
│   │   ├── converter.py      # Conversión de imágenes (Pillow) + video copy
│   │   ├── renamer.py        # Motor de renombrado por patrones con preview
│   │   ├── database.py       # SQLite + import/export Excel + WAL mode
│   │   ├── history.py        # Historial de ejecuciones por tipo
│   │   ├── formatos.py       # Generador PDF con legacy_xobject/visual_overlay/simple_overlay
│   │   ├── format_registry.py # Registro extensible de formatos globales
│   │   ├── plugins.py        # Sistema de plugins dinámicos
│   │   ├── config_fields.py  # Campos configurables de BD
│   │   ├── config_patterns.py # Patrones de renombrado configurables
│   │   ├── config_theme.py   # Temas y presets de apariencia
│   │   └── exceptions.py     # Excepciones personalizadas del dominio
│   ├── utils/                # Utilidades (validadores, paths, i18n, dialogs)
│   └── locales/              # Archivos i18n del backend (es/en)
├── assets/                    # Recursos estáticos (logo, iconos)
├── data/                      # Base de datos local (SQLite)
├── formatos/                  # Templates PDF built-in (.b64)
├── scripts/                   # Scripts de build y automatización
├── docs/                      # Documentación de diseño (specs, plans)
├── tests/                     # Pruebas automatizadas
├── package.json              # Raíz: scripts npm, configuración electron-builder
├── requirements.txt          # Dependencias Python
└── pyproject.toml            # Configuración Python (pytest, ruff, mypy)
```

## Requisitos

- **Python 3.10+**
- **Node.js 18+**
- **Windows 10/11** (macOS y Linux soportados en teoría, no probados oficialmente)

## Dependencias principales

### Backend (Python)
| Paquete | Uso |
|---------|-----|
| Pillow | Conversión de imágenes |
| pandas + openpyxl | Import/export Excel |
| pypdf | Generación de PDFs con correlativo |

### Frontend (Node.js)
| Paquete | Uso |
|---------|-----|
| React 18 | UI framework |
| Vite | Build + dev server |
| TailwindCSS | Estilos utility-first |
| i18next + react-i18next | Internacionalización |
| jspdf + pdfjs-dist | Generación/lectura de PDFs en frontend |
| xlsx | Manipulación de Excel en frontend |
| lucide-react | Iconos |
| framer-motion | Animaciones |
| react-window | Virtualización de listas |

## Desarrollo

### Instalación

```bash
# Instalar dependencias Node.js (root + frontend)
npm install
cd frontend && npm install && cd ..

# Instalar dependencias Python
pip install -e ".[dev]"
```

### Ejecutar en modo desarrollo

```bash
# Lanza frontend Vite + Electron concorrentemente
npm run dev
```

### Compilación

```bash
# Build completo para Windows (backend + frontend + instalador NSIS/portable)
npm run build:win

# Solo frontend
npm run build:frontend

# Solo backend (PyInstaller → .exe)
npm run build:backend
```

El instalador resultante estará en `dist-electron/COSMO-Setup-<version>.exe`.
La versión portable estará en `dist-electron/COSMO-Portable-<version>.exe`.

### Pruebas y lint

```bash
# Ejecutar todas las pruebas (Python + Electron/Node.js)
npm run test

# Pruebas Python individualmente
cd backend && python -m pytest ../tests -v

# Pruebas Node.js individualmente
node tests/test-electron-path.js
node tests/test-electron-dialogs.js

# Lint Python con Ruff
npm run lint:python

# Auto-fix lint
npm run lint:fix

# Type-check frontend TypeScript
npm run typecheck:frontend
```

## Diseño

La aplicación utiliza una identidad **Precision Linear**:

| Elemento | Valor | Uso |
|----------|-------|-----|
| Graphite Base | `#0A0D12` | Fondo principal |
| Elevated Graphite | `#111522` | Superficies elevadas |
| Precision Indigo | `#5E6AD2` | Acciones primarias, selección, progreso |
| Linear Indigo | `#8B93FF` | Estados hover e indicadores |
| Conversion Teal | `#22C7A9` | Éxito, continuidad y profundidad del logo |
| Utility Gray | `#7C8494` | Texto secundario |

- **Logo**: Monograma `HC` con pista sutil de conversión, diseñado para app icon y sidebar.
- **Bordes**: Radius compactos en controles y superficies para una herramienta de escritorio profesional.
- **Tipografía**: Inter/system stack con pesos limpios y alta legibilidad.
- **Sombras**: Elevaciones contenidas y glow indigo solo en estados activos.

## Scripts disponibles

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Frontend hot reload + Electron concurrently |
| `npm run build:frontend` | Compilar React → producción (Vite) |
| `npm run build:backend` | Compilar Python → .exe (PyInstaller) |
| `npm run build:win` | Build completo para Windows |
| `npm run build:mac` | Build completo para macOS |
| `npm run build:linux` | Build completo para Linux |
| `npm run build:all` | Build para Windows + macOS + Linux |
| `npm run test` | Ejecutar pruebas Python y Node.js |
| `npm run lint:python` | Lint con Ruff |
| `npm run lint:fix` | Auto-fix con Ruff |
| `npm run typecheck:frontend` | Verificación de tipos TypeScript |
| `npm run bump:patch` | Incrementar versión patch |
| `npm run bump:minor` | Incrementar versión menor |
| `npm run bump:major` | Incrementar versión mayor |

## Licencia

Proyecto privado.
