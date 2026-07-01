# ANTARES

> Conversor y renombrador profesional de imágenes.

## Features

- **Conversión**: JPEG, PNG, WebP, BMP, TIFF, GIF, ICO, PDF
- **Renombrado automático**: Patrones con SQLite o mapeo directo Excel (`ID` → `RENOMBRE`) con plantilla dedicada
- **Procesamiento en lote**: Múltiples archivos con progreso en tiempo real
- **Soporte de video**: MP4, AVI, MOV, MKV, WMV, FLV, WEBM
- **PDF con correlativo**: 3 modos de generación
- **Temas**: 23 presets + editor personalizado
- **Internacionalización**: Español e inglés

## Stack

**Electron** · **React + TypeScript + Vite** · **TailwindCSS** · **Python** · **SQLite**

## Estructura de directorios

- `formatos/` (raíz) — Plantillas built-in read-only (PDFs base64). Empaquetadas con la app
  vía `extraResources` (electron-builder). No se modifican en runtime.
- `data/formatos/` — Datos editables por el usuario (uploads, catalog.json, mapping). Se
  conservan entre actualizaciones. Separación deliberada con la capa built-in.
- `backend/templates/` — Plantillas HTML de WeasyPrint para reportes (certificados, paneles,
  volantes). Empaquetadas con PyInstaller.
- `assets/` — Recursos gráficos (logos, iconos, imágenes de ubicaciones).
- `shared/` — Código compartido entre electron y frontend (html-sanitizer).
- `electron/` — Proceso main de Electron (IPC, ventana, auto-updater).
- `frontend/` — Aplicación React + Vite.
- `backend/` — API Python (core, handlers, utils) + base de datos.
- `tests/` — Tests de backend (pytest) y de electron/frontend (node + vitest).
- `scripts/` — Scripts de release, build, bump de versión, instalación de hooks.

## Requisitos

- Python 3.10+ · Node.js 18+ · Windows 10/11

## Desarrollo

```bash
npm install && cd frontend && npm install && cd ..
pip install -e ".[dev]"
npm run dev        # Desarrollo
npm run build:win  # Build Windows
```

## Licencia

Proyecto privado.
