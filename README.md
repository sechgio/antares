# Antares

> Conversor y renombrador profesional de imágenes.

## Features

- **Conversión**: JPEG, PNG, WebP, BMP, TIFF, GIF, ICO, PDF
- **Renombrado automático**: Patrones con SQLite o mapeo directo Excel (`ID` → `RENOMBRE`) con plantilla dedicada
- **Procesamiento en lote**: Múltiples archivos con progreso en tiempo real
- **Soporte de video**: MP4, AVI, MOV, MKV, WMV, FLV, WEBM
- **PDF con correlativo**: 3 modos de generación
- **Temas**: 23 presets + editor personalizado
- **Internacionalización**: Español e inglés

## Módulos

La app agrupa herramientas en pestañas (ver `frontend/src/navigation.ts`):

- **Espacios** — gestión de espacios y datos en Supabase
- **Conversión** — conversor y renombrador de imágenes
- **Formatos PDF** — plantillas y formatos PDF
- **Sellador** — sellado de documentos
- **Generar Padrones** — generación de padrones
- **Generar Volantes** — generación de volantes
- **Reportes de Campo** — reportes de campo
- **Informes técnicos** — informes técnicos
- **Optimizador de Imágenes** — optimización de imágenes
- **Generador de Reportes** — generación de reportes
- **Aviso de Corte** — avisos de corte
- **Herramienta de Ubicaciones** — ubicaciones en mapas
- **Evidencia Volanteo** — evidencia de volanteo
- **AutoIMG** — renombrado automático con Google Drive
- **Fichas Técnicas** — fichas técnicas

Configuración adicional: Apariencia, Historial, Panel y Petdex.

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

## Autenticación

Antares es una aplicación de escritorio para **Windows**. La interfaz principal requiere **inicio de sesión con Supabase**; sin credenciales válidas se muestra la pantalla de login.

## Configuración

Antes del primer `npm run dev`, crea los archivos de entorno locales (nunca los commitees — el repo es público):

1. **Supabase (obligatorio)** — copia `frontend/.env.example` → `frontend/.env.local` y rellena:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
2. **AutoIMG Google OAuth (opcional)** — copia `.env.example` → `.env.local` en la raíz del repo, o configura las credenciales desde la UI de AutoIMG (se guardan cifradas en `userData`):
   - `AUTOIMG_GOOGLE_CLIENT_ID`
   - `AUTOIMG_GOOGLE_CLIENT_SECRET`

## Supabase (desarrolladores)

Cambios de schema (p. ej. módulo Espacios) se aplican solo al proyecto autorizado `yoyxclndjevkzzclhdcv`:

```powershell
# Variables requeridas (sin valores en el repo):
#   SUPABASE_ACCESS_TOKEN — token personal en https://supabase.com/dashboard/account/tokens
#   SUPABASE_DB_PASSWORD  — contraseña de base de datos del proyecto

pwsh scripts/supabase-db-push.ps1
```

No uses otro project ref ni otro proyecto Supabase desde este repositorio.

## Desarrollo

```bash
npm install && cd frontend && npm install && cd ..
pip install -e ".[dev]"
npm run dev        # Desarrollo
npm run build:win  # Build Windows
```

## Licencia

Proyecto privado.
