# run-engine.ps1 - start the battle engine with settings from the repo-root .env
#
#   powershell -ExecutionPolicy Bypass -File battle-engine/run-engine.ps1
#
# Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (required) and optionally
# CAMPUSFORGE_CORS_ALLOWED_ORIGINS, BATTLE_AI_BATTLES_ENABLED, SUPABASE_JWT_SECRET
# from ../.env. Real environment variables win over .env values.

param(
    [int]$Port = 17175,
    [string]$Heap = '1g'
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path (Split-Path -Parent $here) '.env'

if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
            $name = $Matches[1]; $value = $Matches[2].Trim('"', "'")
            if (-not [Environment]::GetEnvironmentVariable($name)) {
                [Environment]::SetEnvironmentVariable($name, $value)
            }
        }
    }
}

foreach ($required in 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY') {
    if (-not [Environment]::GetEnvironmentVariable($required)) {
        throw "$required is not set (add it to $envFile)"
    }
}
if (-not $env:CAMPUSFORGE_CORS_ALLOWED_ORIGINS) {
    $env:CAMPUSFORGE_CORS_ALLOWED_ORIGINS = 'https://igdaiiitd.github.io,http://localhost:17170,http://127.0.0.1:17170'
}

$jar = Get-ChildItem (Join-Path $here 'target') -Filter 'campusforge-battle-engine-*.jar' -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike '*.original' } | Select-Object -First 1
if (-not $jar) {
    throw "No engine jar in battle-engine/target. Build it first: setup-forge.ps1, then 'mvn clean package' in battle-engine/."
}

Write-Host "Battle engine on http://localhost:$Port  (CORS: $env:CAMPUSFORGE_CORS_ALLOWED_ORIGINS)"
Push-Location $here   # Forge card data resolves relative to battle-engine/
try {
    & java "-Xmx$Heap" -jar $jar.FullName "--server.port=$Port"
} finally {
    Pop-Location
}
