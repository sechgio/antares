# Auto-actualización (GitHub Releases + electron-updater)

ANTARES se actualiza solo, gratis, usando **GitHub Releases** como servidor de
artefactos y `electron-updater` como cliente. Es el mismo patrón que usan
OpenCode, VS Code Insiders, Obsidian, etc.

## Cómo funciona en runtime

1. Al arrancar la app empaquetada, `@electron/auto-updater.js` espera ~8s y
   pide a GitHub el archivo `latest.yml` del último release publicado.
2. Si la versión publicada es mayor que `package.json -> version`, descarga el
   instalador en background.
3. Cuando termina la descarga, muestra un diálogo nativo:
   - **Instalar y reiniciar** → cierra la app, ejecuta el nuevo `Setup.exe` y
     vuelve a abrir ANTARES con la nueva versión.
   - **Todavía no** → la actualización quedará programada y se aplicará al
     próximo cierre normal de la app (`autoInstallOnAppQuit = true`).
4. Si la app sigue abierta varias horas, vuelve a buscar actualizaciones cada
   6 horas.

> En modo `dev` (`npm run dev`) o si la app no está empaquetada, el updater
> queda desactivado para evitar ruido.

## Publicar una nueva versión (flujo manual)

1. **Subir versión** (genera commit + tag local opcional):

   ```powershell
   npm run bump:patch   # 0.6.2 -> 0.6.3
   ```

2. **Compilar el instalador**:

   ```powershell
   npm run build:win
   ```

   Esto deja en `dist-electron/` los archivos:
   - `Antares-Setup-0.6.3.exe`
   - `Antares-Portable-0.6.3.exe`
   - `latest.yml`  ← imprescindible: contiene versión + hash + tamaño.

3. **Crear el GitHub Release**:
   - Ir a `https://github.com/sechgio/antares/releases/new`
   - Tag: `v0.6.3` (debe coincidir con `package.json`).
   - Título: `Antares 0.6.3`.
   - Adjuntar **los 3 archivos** del paso 2 (`Setup`, `Portable`, `latest.yml`).
   - Publicar.

   > Si el archivo `latest.yml` no está en el release, los clientes no detectan
   > la actualización.

4. Las instancias instaladas en clientes detectarán la nueva versión la
   próxima vez que abran la app.

## Publicación automatizada (opcional)

`electron-builder` puede subir el release solo si se le pasa un token:

```powershell
$env:GH_TOKEN = "ghp_..."   # token con permiso `repo`
npm run build:win -- --publish always
```

Esto crea el draft release y sube los binarios + `latest.yml` en una sola
operación. Cuando se quiera dejar visible el release, basta con publicarlo
desde la UI de GitHub.

## Notas de firma de código

- **Windows**: la app no está firmada, por eso `verifyUpdateCodeSignature` está
  en `false` en `@electron-builder.yml`. SmartScreen mostrará "Editor
  desconocido" la primera vez; al actualizar se mantiene el comportamiento.
- **macOS**: el auto-update **no funciona sin firma + notarización** de Apple.
  Es una restricción del sistema operativo, no de electron-updater.
- **Linux**: solo `AppImage` soporta auto-update; `.deb` y `.rpm` requieren
  apt/dnf manualmente.

## Repositorio público vs privado

GitHub Releases son **gratis y sin límites razonables** para repos públicos.
Si el repo `sechgio/antares` pasa a privado, los clientes necesitarían un token GitHub
para descargar — en ese caso conviene migrar a un host estático (S3, Cloudflare
R2, un VPS con nginx) cambiando el `provider` en `@electron-builder.yml`.
