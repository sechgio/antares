$ErrorActionPreference = 'Stop'

& C:\msys64\usr\bin\bash.exe -lc 'pacman -S mingw-w64-x86_64-pango --noconfirm --needed'
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

if (Test-Path 'C:\msys64\mingw64\bin\python.exe') {
    Remove-Item -LiteralPath 'C:\msys64\mingw64\bin\python.exe' -Force
}

'C:\msys64\mingw64\bin' | Out-File -LiteralPath $env:GITHUB_PATH -Append
'WEASYPRINT_DLL_DIRECTORIES=C:\msys64\mingw64\bin' | Out-File -LiteralPath $env:GITHUB_ENV -Append
