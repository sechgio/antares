$ErrorActionPreference = 'Stop'

# Provisión del toolchain multimedia del editor para CI.
# Descarga un autobuild de BtbN con versión y fecha fijadas y verifica el
# SHA-256 del zip; los binarios extraídos se instalan con el verificador del
# propio repositorio (node scripts/prepare-editor-media.js), que comprueba
# cada exe contra media/manifest.json antes de copiarlos a media/.
$mediaDir = Join-Path $env:GITHUB_WORKSPACE 'media'
$ffmpeg = Join-Path $mediaDir 'ffmpeg.exe'
$ffprobe = Join-Path $mediaDir 'ffprobe.exe'

$zipUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-31-13-27/ffmpeg-n9.0.1-11-ge47273f4d9-win64-gpl-9.0.zip'
$zipSha256 = 'ec9db2cda1f5894ab95446076ad8bf49379db4b53c02e778ad3b49adf91fec83'

if (-not ((Test-Path $ffmpeg) -and (Test-Path $ffprobe))) {
    $stage = Join-Path $env:RUNNER_TEMP 'editor-media'
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    $zip = Join-Path $stage 'ffmpeg-editor-toolchain.zip'
    curl.exe -L --fail --retry 3 --retry-all-errors --silent --show-error -o $zip $zipUrl
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
    if ((Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower() -ne $zipSha256) {
        throw 'El zip de ffmpeg descargado no coincide con el SHA-256 fijado'
    }
    $extract = Join-Path $stage 'extract'
    Expand-Archive -Path $zip -DestinationPath $extract -Force
    $bin = Join-Path (Get-ChildItem $extract -Directory | Select-Object -First 1).FullName 'bin'
    $staged = Join-Path $stage 'media'
    New-Item -ItemType Directory -Force -Path $staged | Out-Null
    Copy-Item -LiteralPath (Join-Path $bin 'ffmpeg.exe') -Destination (Join-Path $staged 'ffmpeg.exe')
    Copy-Item -LiteralPath (Join-Path $bin 'ffprobe.exe') -Destination (Join-Path $staged 'ffprobe.exe')
    node scripts/prepare-editor-media.js install $staged
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

node scripts/prepare-editor-media.js verify
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

"ANTARES_FFMPEG_DIR=$mediaDir" | Out-File -LiteralPath $env:GITHUB_ENV -Append

& $ffmpeg -hide_banner -version
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
