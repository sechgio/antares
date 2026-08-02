# Antares

> **Plataforma de Escritorio para Procesamiento Digital, Generación de Reportes y Editor Canvas Local-First**

![Windows](https://img.shields.io/badge/Platform-Windows-blue?style=flat-square&logo=windows)
![Electron](https://img.shields.io/badge/Electron-33+-47848F?style=flat-square&logo=electron)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)
![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python)

---

## 📋 Descripción General

**Antares** es una aplicación de escritorio profesional de alto rendimiento diseñada para entornos operativos demandantes. Combina potentes herramientas de procesamiento e intercambio de imágenes, renombrado masivo inteligente, generación automatizada de documentos técnicos (PDFs, volantes, padrones) y un editor visual de documentos tipo canvas (*local-first*).

---

## 🚀 Características Principales

### 🖼️ Procesamiento e Imagen
- **Conversión Multi-Formato**: Soporte integral para JPEG, PNG, WebP, BMP, TIFF, GIF, ICO y generación de PDF.
- **Soporte de Video**: Manipulación y extracción en formatos MP4, AVI, MOV, MKV, WMV, FLV y WEBM.
- **Optimizador de Imágenes**: Compresión y ajuste de resolución en lote con vista previa y progreso en tiempo real.
- **AutoIMG**: Renombrado automático con integración a Google Drive.

### 🏷️ Renombrado Masivo Inteligente
- **Mapeo por Excel**: Renombrado automático mediante emparejamiento directo (`ID` → `RENOMBRE`) usando plantillas dedicadas.
- **Reglas Dinámicas**: Patrones configurables respaldados por SQLite local para procesar miles de archivos en segundos.

### 📄 Generación de Documentos y Reportes
- **Formatos PDF & Reportes Técnicos**: Módulos especializados para Informes Técnicos, Padrones, Volantes, Avisos de Corte y Reportes de Campo.
- **Sellador de Documentos**: Inserción de sellos, firmas y folios sobre archivos PDF base.
- **Motor WeasyPrint**: Plantillas HTML/CSS en el backend Python empaquetadas para renderizado PDF de alta precisión.

### 🎨 Editor Canvas Studio (Local-First)
- **Editor A4 Estilo Figma**: Capas, formas, textos, imágenes, alineación y operaciones vectoriales avanzadas.
- **Persistencia Atómica**: Guardado automático y atómico en JSON local (`%LOCALAPPDATA%`) con historial deshacer/rehacer (*undo/redo*) en memoria.
- **Sincronización Cloud**: Réplica en segundo plano (*best-effort*) mediante Supabase.

---

## 🏗️ Arquitectura y Stack Tecnológico

| Capa | Tecnologías | Descripción |
| :--- | :--- | :--- |
| **Frontend** | React 18, TypeScript, Vite, TailwindCSS | Interfaz gráfica moderna, reactiva y modular con soporte multi-tema (23 presets). |
| **Desktop Runtime** | Electron | Proceso principal main/preload, IPC-Router seguro y administración de ventanas. |
| **Backend Service** | Python 3.10+ (PyInstaller) | Servicio local encargado del procesamiento de imágenes, manipulación de PDFs y persistencia local vía IPC JSON-RPC 2.0 (stdio). |
| **Bases de Datos & Cloud** | SQLite, Supabase | Persistencia local ligera en SQLite e integración cloud para autenticación y espacios colaborativos. |

---

## 📁 Estructura del Proyecto

```text
antares/
├── electron/          # Proceso principal de Electron (IPC router, window manager, auto-updater)
├── frontend/          # Interfaz React + TypeScript + Vite + TailwindCSS
│   └── src/
│       ├── components/# Componentes UI (Canvas, Conversión, Reportes, etc.)
│       ├── hooks/     # Hooks personalizados (useCanvasHistory, etc.)
│       └── utils/     # Helpers de frontend y adaptadores API
├── backend/           # Servicio Python (IPC, procesamiento de imágenes y PDF)
│   ├── core/          # Lógica central (Canvas store, conversor, DB)
│   ├── handlers/      # Controladores IPC de Python
│   └── templates/     # Plantillas HTML/CSS para WeasyPrint
├── formatos/          # Plantillas built-in read-only (PDFs base64) empaquetadas con la app
├── data/              # Datos editables por el usuario (catalog.json, cargas, mappings)
├── scripts/           # Herramientas de automatización, release loop y mantenimiento
└── tests/             # Tests unitarios e integración (pytest, vitest, node)
```

---

## 💻 Requisitos del Sistema

- **Sistema Operativo**: Windows 10 / Windows 11 (64-bit)
- **Node.js**: `v18.0.0` o superior
- **Python**: `3.10` o superior (con `pip` habilitado)

---

## ⚙️ Configuración del Entorno

Antes de iniciar el entorno de desarrollo, configura las variables de entorno necesarias.

> ⚠️ **IMPORTANTE DE SEGURIDAD**: Nunca incluyas en el repositorio archivos `.env.local`, llaves secretas o IDs de proyectos privados.

1. **Variables de Frontend (Supabase)**:
   Copia el archivo de ejemplo en el directorio frontend:
   ```bash
   cp frontend/.env.example frontend/.env.local
   ```
   Configura las siguientes variables en `frontend/.env.local`:
   ```env
   VITE_SUPABASE_URL=https://<TU-PROYECTO-SUPABASE>.supabase.co
   VITE_SUPABASE_ANON_KEY=<TU-SUPABASE-ANON-KEY>
   ```

2. **Variables de AutoIMG (Google OAuth - Opcional)**:
   Copia el archivo `.env.example` de la raíz o configura las credenciales desde la interfaz de la aplicación:
   ```env
   AUTOIMG_GOOGLE_CLIENT_ID=<TU_GOOGLE_CLIENT_ID>
   AUTOIMG_GOOGLE_CLIENT_SECRET=<TU_GOOGLE_CLIENT_SECRET>
   ```

---

## 🛠️ Instalación y Desarrollo

### 1. Clonar e instalar dependencias

```bash
# Clonar el repositorio
git clone <URL_DEL_REPOSITORIO>
cd antares

# Instalar dependencias del proyecto y frontend
npm install
cd frontend && npm install && cd ..

# Crear venv del proyecto e instalar dependencias Python + PyInstaller
# (usa Python 3.10+ del sistema; evita el `python` de otros venv del PATH)
python -m venv venv312
.\venv312\Scripts\Activate.ps1   # Windows PowerShell
pip install -e ".[dev]"
pip install pyinstaller
```

### 2. Ejecutar en Modo Desarrollo

```bash
# Modo dev: Vite (:5173) + Electron + backend Python (sin instalador, hot reload)
npm run dev

# Preview empaquetado sin instalador (win-unpacked; build completo, más lento)
npm run preview:unpacked
```
`npm run dev` no genera instalador ni `win-unpacked`: abre Electron contra Vite en desarrollo.

### 3. Verificación y Calidad de Código

```bash
# Ejecutar suite de pruebas completa (Pytest + Node / Vitest)
npm test

# Verificación de tipos en Frontend
npm run typecheck:frontend

# Linter de Python (Ruff)
npm run lint:python
```

### 4. Compilación para Producción

```bash
# Compilar binarios y empaquetar instalador para Windows
npm run build:win
```

---

## 🗄️ Despliegue y Migraciones de Supabase (Desarrolladores)

Para aplicar migraciones de esquema en la base de datos de Supabase, utiliza el script del proyecto configurando tus variables de entorno locales:

```powershell
# Requiere en tu sesión local (nunca commits): SUPABASE_ACCESS_TOKEN y SUPABASE_DB_PASSWORD.
# Opcional: SUPABASE_PROJECT_ID (por defecto el project ref autorizado del repo).

pwsh scripts/supabase-db-push.ps1
```

---

## 📜 Licencia y Propiedad

© Antares. Todos los derechos reservados. Proyecto privado y confidencial.

