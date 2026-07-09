#!/usr/bin/env pwsh
# Aplica migraciones locales al proyecto Supabase remoto de Antares.
# Requiere (una vez): https://supabase.com/dashboard/account/tokens
#
#   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
#   $env:SUPABASE_DB_PASSWORD = "..."   # Database password del proyecto
#   $env:SUPABASE_PROJECT_ID = "yoyxclndjevkzzclhdcv"
#
# Uso: pwsh scripts/supabase-db-push.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$allowedProjectId = "yoyxclndjevkzzclhdcv"
$projectId = if ($env:SUPABASE_PROJECT_ID) { $env:SUPABASE_PROJECT_ID } else { $allowedProjectId }

if ($projectId -ne $allowedProjectId) {
  Write-Error "Proyecto Supabase no autorizado: $projectId. Solo se permite: $allowedProjectId"
}

if (-not $env:SUPABASE_ACCESS_TOKEN) {
  Write-Error "Falta SUPABASE_ACCESS_TOKEN. Crear en: https://supabase.com/dashboard/account/tokens"
}
if (-not $env:SUPABASE_DB_PASSWORD) {
  Write-Error "Falta SUPABASE_DB_PASSWORD (Database password en Project Settings > Database)."
}

Write-Host "Enlazando proyecto $projectId..."
npx supabase link --project-ref $projectId

Write-Host "Aplicando migraciones..."
npx supabase db push

Write-Host "Listo."
