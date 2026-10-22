# Antares

> **Plataforma de Escritorio para Procesamiento Digital, Generación de Reportes y Editor Canvas Local-First**

![Windows](https://img.shields.io/badge/Platform-Windows-blue?style=flat-square&logo=windows)
![Electron](https://img.shields.io/badge/Electron-33+-47848F?style=flat-square&logo=electron)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)
![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python)

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
| **Backend Service** | Python 3.11+ (PyInstaller) | Servicio local encargado del procesamiento de imágenes, manipulación de PDFs y persistencia local vía IPC JSON-RPC 2.0 (stdio). |
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
- **Python**: `3.11` o superior (con `pip` habilitado)

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

# Instalar uv y sincronizar el entorno Python bloqueado
python -m pip install uv==0.11.19
uv sync --locked --extra dev --extra build
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

Para aplicar migraciones de esquema, conecta el complemento Supabase de Codex, verifica el proyecto remoto y aplica las migraciones locales que falten según su historial.

---

## Interfaz del agente

La barra lateral separa **Conversaciones** y **Agentes** guardados. Cada vista tiene su propia búsqueda; los agentes se buscan por nombre o descripción. Cambiar de vista conserva el borrador del chat. `Ctrl+K` abre la búsqueda de conversaciones.

Desde **Herramientas del agente** puedes buscar por nombre, identificador o módulo y filtrar por **Todas**, **Skills** o **MCP**. El contador muestra todas las herramientas habilitadas, incluidas las ocultas por el filtro. Buscar o filtrar no cambia permisos; solo los interruptores modifican la selección.

Expande un paso de skills en la conversación para ver el catálogo con sus ubicaciones o el contenido leído. Una lectura parcial indica el siguiente `offset`; llegar al final de una referencia no significa haber leído toda la skill. **Datos originales** conserva el JSON y permite copiarlo. No se cargan archivos adicionales al abrir la tarjeta.

Para pedir colaboración, escribe `@` en el mensaje y selecciona un bot guardado con las flechas y `Enter`, con `Tab` o con un clic. Seleccionar no envía el mensaje; `Escape` cierra las sugerencias. Puedes escribir `@Investigador` o `@"Revisor de PDFs"`, y mencionar varios para repartir el trabajo. El agente principal recibe sus identificadores, puede delegar encargos autocontenidos con `subagent_run` y transmitir las conclusiones de uno al siguiente. Comprueba las tarjetas de delegación para saber qué bots llegaron a ejecutarse; la mención por sí sola no es un comprobante.

El selector siempre inserta `@bot:identificador` para conservar al bot elegido aunque cambie su nombre, también en mensajes en cola. Los nombres siguen visibles en las sugerencias. Un nombre que coincide con un módulo conserva su significado anterior, como `@sellador`; usa la sugerencia o `@"Sellador"` para referirte al bot. Las menciones explícitas de bots borrados o ambiguos impiden enviar el mensaje. Mencionar no habilita `subagent_run` si lo desactivaste. Los subagentes siguen limitados a lectura, sin delegación recursiva ni acceso automático a otras conversaciones. Los correos y las menciones dentro de código no se interpretan como solicitudes de colaboración.

## Skills locales del agente

Los agentes y subagentes pueden descubrir instrucciones reutilizables con `skills_list` y leerlas bajo demanda con `skills_read`, siguiendo el formato [Agent Skills](https://agentskills.io/specification). No hace falta instalar otra plataforma de agentes.

- Adjunta una carpeta desde el chat del agente. Se buscan skills en esa carpeta, en `skills/` y en `.agents/skills/`, con prioridad frente al espacio de trabajo y la biblioteca cuando se alcanza el límite del catálogo. Puedes adjuntar directamente la carpeta de una skill o su `SKILL.md`.
- Para compartir skills entre conversaciones, copia sus carpetas en `%LOCALAPPDATA%\Antares\ai-agent\skills\`. La herramienta `skills_list` también indica la ubicación de esta biblioteca local.
- Las skills creadas dentro de `skills/` o `.agents/skills/` del espacio de trabajo de una conversación solo están disponibles en esa conversación.
- Pide, por ejemplo: "Busca una skill para revisar PDFs y aplícala a este documento". Si una conversación anterior conserva una selección de herramientas sin skills, habilita `skills_list` y `skills_read` desde su selector habitual. No se sustituyen selecciones existentes.

Una skill mínima tiene esta estructura:

```text
pdf-review/
  SKILL.md
  references/
    checklist.txt
```

```markdown
---
name: pdf-review
description: Revisa documentos PDF, sus firmas y márgenes antes de exportarlos.
---
Lee references/checklist.txt. Revisa el documento con las herramientas disponibles
y comunica qué comprobaste y qué no pudiste verificar.
```

El nombre debe coincidir con la carpeta, usar minúsculas, números y guiones, y tener hasta 64 caracteres. La descripción admite hasta 1024 caracteres y YAML multilínea. El catálogo entrega solo metadatos; las instrucciones y referencias se leen después, por páginas de hasta 4000 caracteres. La lectura conserva `next_offset` incluso si el contenido necesita recortarse para caber en el resultado de una herramienta.

Los archivos deben ser UTF-8 y no superar 64 KiB. La exploración es acotada; si el catálogo indica recorte, filtra por nombre o descripción o adjunta la carpeta concreta de la skill. No se recorren categorías de profundidad arbitraria. Los nombres repetidos tienen identificadores distintos y muestran su ubicación.

Las skills no conceden permisos. Sus campos opcionales, incluido `allowed-tools`, no habilitan herramientas ni evitan aprobaciones. Los scripts se pueden leer como texto, pero cargar una skill no los ejecuta. Los subagentes siguen restringidos a lectura. Adjuntar solo `SKILL.md` no autoriza sus archivos vecinos; adjunta la carpeta si necesitas sus referencias. Al retirar una autorización deja de poder leerse la skill externa. Las skills personales de Codex, Hermes u otros programas no se importan automáticamente, y esta versión no instala skills desde Internet.

## 📜 Licencia y Propiedad

© Antares. Todos los derechos reservados. Proyecto privado y confidencial.

