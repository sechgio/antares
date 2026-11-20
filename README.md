# Antares

Aplicación de escritorio para Windows que combina procesamiento de imágenes, renombrado masivo, generación de documentos PDF y un editor canvas *local-first*.

## Características

- **Imagen y video**: conversión entre JPEG, PNG, WebP, BMP, TIFF, GIF e ICO, generación de PDF, manipulación de video (MP4, AVI, MOV, MKV, WMV, FLV, WEBM), optimización por lotes y AutoIMG con integración a Google Drive.
- **Renombrado masivo**: mapeo desde Excel (`ID` → `RENOMBRE`) y reglas configurables, respaldadas por SQLite local.
- **Documentos**: informes técnicos, padrones, volantes, avisos de corte y reportes de campo con plantillas HTML/CSS (WeasyPrint). También sella PDF con sellos, firmas y folios.
- **Canvas Studio**: editor A4 con capas, formas, texto, imágenes y deshacer/rehacer. Guarda de forma atómica en `%LOCALAPPDATA%\Antares\canvas\` y replica a Supabase en segundo plano.

## Requisitos

- Windows 10 u 11 (64 bits)
- Node.js 22.19.0 o superior (ver `.node-version`)
- Bun 1.4.4
- Python 3.11 o superior con `pip`

## Configuración

No subas al repositorio `.env.local`, llaves ni IDs de proyectos privados.

```powershell
Copy-Item frontend/.env.example frontend/.env.local
```

Completa en `frontend/.env.local`:

```env
VITE_SUPABASE_URL=https://<TU-PROYECTO>.supabase.co
VITE_SUPABASE_ANON_KEY=<TU-ANON-KEY>
```

AutoIMG usa Google OAuth de forma opcional. Define `AUTOIMG_GOOGLE_CLIENT_ID` y `AUTOIMG_GOOGLE_CLIENT_SECRET` según el `.env.example` de la raíz, o configúralas desde la aplicación.

## Desarrollo

```powershell
git clone <URL_DEL_REPOSITORIO>
cd antares
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd frontend
python -m pip install uv==0.11.19
uv sync --locked --extra dev
```

```powershell
bun run dev                 # Vite (:5173) + Electron + backend Python, con recarga en caliente
bun run preview:unpacked    # build completo en win-unpacked, sin instalador
```

```powershell
bun run test                # suites de Node, Python y Vitest
bun run lint:python
bun run typecheck:backend
bun run typecheck:frontend
bun run ci                  # comprobación completa antes de abrir un PR
```

Para generar el instalador de Windows, instala también el extra `build` y empaqueta:

```powershell
uv sync --locked --extra dev --extra build
bun run build:win
```

Las migraciones de Supabase están en `supabase/migrations/`. Sus reglas están en [CODING_STANDARDS.md](CODING_STANDARDS.md#supabase).

## Arquitectura

| Capa | Tecnología |
| --- | --- |
| Frontend | React 19, TypeScript 7, Vite, Tailwind CSS 3 |
| Shell de escritorio | Electron 44: proceso principal, preload y router IPC |
| Backend | Python 3.11+ empaquetado con PyInstaller, JSON-RPC 2.0 sobre stdio |
| Datos | SQLite local y Supabase para autenticación y sincronización |

```text
electron/   Proceso principal, IPC, ventanas y auto-updater
frontend/   Interfaz React + TypeScript + Vite
backend/    Servicio Python: core/, handlers/ (IPC) y templates/ (WeasyPrint)
formatos/   Plantillas PDF de solo lectura incluidas en la app
data/       Datos editables por el usuario
shared/     Contratos y presupuestos compartidos
scripts/    Automatización, build y releases
tests/      Pruebas unitarias e integración
```

## Agente y skills

- La barra lateral separa **Conversaciones** y **Agentes** guardados. Escribe `@` en el mensaje para mencionar un agente guardado.
- Las skills siguen el formato [Agent Skills](https://agentskills.io/specification). Los agentes las descubren con `skills_list` y las leen con `skills_read`.
- Una skill es una carpeta con un `SKILL.md` que tiene frontmatter `name` y `description`. El nombre coincide con la carpeta, usa minúsculas, números y guiones, y tiene hasta 64 caracteres.
- Adjunta la carpeta desde el chat, o copia la carpeta de la skill en `%LOCALAPPDATA%\Antares\ai-agent\skills\` para compartirla entre conversaciones.
- Las skills no conceden permisos ni ejecutan scripts. Sus archivos deben ser UTF-8 y no superar 64 KiB.

## Documentación

- [AGENTS.md](AGENTS.md): reglas para agentes, alcance de cambios y flujo de PR.
- [CODING_STANDARDS.md](CODING_STANDARDS.md): estándares por área.
- [CONTEXT.md](CONTEXT.md): vocabulario del dominio.
- [CHANGELOG.md](CHANGELOG.md): historial de versiones.

## Licencia

© Antares. Todos los derechos reservados. Proyecto privado y confidencial.
