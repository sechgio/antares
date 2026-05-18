# ANTARES

> Conversor y renombrador profesional de imágenes.

## Features

- **Conversión**: JPEG, PNG, WebP, BMP, TIFF, GIF, ICO, PDF con calidad y redimensionamiento
- **Renombrado automático**: Motor por patrones integrado con SQLite
- **Procesamiento en lote**: Múltiples archivos con ThreadPoolExecutor y progreso en tiempo real
- **Soporte de video**: Copy/rename de MP4, AVI, MOV, MKV, WMV, FLV, WEBM sin conversión
- **PDF con correlativo**: 3 modos de generación (legacy XObject, visual overlay, simple overlay)
- **Padrones y Volantes**: Módulos dedicados con previsualización
- **Reportes de Campo**: Gestión con fotos, hojas de datos y exportación
- **Optimizador**: Pipeline con preview, crop, ajustes y exportación ZIP
- **Historial**: Registro por tipo con re-ejecución de configuraciones
- **Internacionalización**: Español e inglés
- **Temas**: 23 presets + editor con identidad Precision Linear
- **Command Palette**: Navegación rápida con `Ctrl+K`
- **Plugins**: Extensión de formatos vía Python

## Stack

**Electron** · **React + TypeScript + Vite** · **TailwindCSS** · **Python (JSON-RPC stdin/stdout)** · **SQLite**

Comunicación bidireccional segura entre Electron y Python sin HTTP.

## Requisitos

- Python 3.10+ · Node.js 18+ · Windows 10/11 (macOS/Linux no probados oficialmente)

## Desarrollo

```bash
npm install && cd frontend && npm install && cd ..
pip install -e ".[dev]"
npm run dev        # Frontend Vite + Electron concurrently
npm run build:win  # Build completo (backend PyInstaller + frontend + instalador NSIS)
```

## Scripts principales

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Hot reload + Electron |
| `npm run build:win` | Build Windows (instalador + portable) |
| `npm run build:all` | Build multiplataforma |
| `npm run test` | Pruebas Python y Node.js |
| `npm run lint:python` | Ruff lint |
| `npm run typecheck:frontend` | TypeScript check |

## Licencia

Proyecto privado.
