# start-public.ps1 - run the battle engine and expose it publicly through a
# Cloudflare quick tunnel (no Cloudflare account or domain needed).
#
#   powershell -ExecutionPolicy Bypass -File battle-engine/start-public.ps1
#
# 1. starts the engine (run-engine.ps1: reads SUPABASE_* from the repo .env)
# 2. starts `cloudflared tunnel --url http://localhost:<port>` and reads the
#    random https://<words>.trycloudflare.com URL it is given
# 3. waits until the engine answers through the tunnel
# 4. publishes the URL to Supabase app_config.battle_engine_url (service role);
#    the GitHub Pages site reads it at load / live, so no rebuild is needed
# 5. keeps watching; on Ctrl+C or if either process dies, clears the URL (the
#    Battle tab disappears) and stops both processes.
#
# Logs: battle-engine/logs/engine.log, battle-engine/logs/cloudflared.log

param(
    [int]$Port = 17175,
    [string]$Cloudflared = ''
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$logs = Join-Path $here 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$engineLog = Join-Path $logs 'engine.log'
$tunnelLog = Join-Path $logs 'cloudflared.log'

function Log($msg) { Write-Host ("[{0:HH:mm:ss}] {1}" -f (Get-Date), $msg) }

# --- settings from the repo .env (real env vars win) ------------------------
$envFile = Join-Path (Split-Path -Parent $here) '.env'
if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
            if (-not [Environment]::GetEnvironmentVariable($Matches[1])) {
                [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim('"', "'"))
            }
        }
    }
}
foreach ($required in 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY') {
    if (-not [Environment]::GetEnvironmentVariable($required)) { throw "$required is not set (add it to $envFile)" }
}
$supabaseUrl = $env:SUPABASE_URL.TrimEnd('/')
$serviceHeaders = @{
    apikey          = $env:SUPABASE_SERVICE_ROLE_KEY
    Authorization   = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"
    Prefer          = 'resolution=merge-duplicates,return=minimal'
}

function Publish-EngineUrl([string]$url) {
    $body = @{ key = 'battle_engine_url'; value = $(if ($url) { $url } else { $null }) } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Post -Uri "$supabaseUrl/rest/v1/app_config?on_conflict=key" -Headers $serviceHeaders -ContentType 'application/json' -Body $body | Out-Null
}

function Test-Engine([string]$origin) {
    try {
        return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Uri "$origin/api/v1/battle/features").StatusCode -eq 200
    } catch { return $false }
}

function Stop-Tree($proc) {
    if ($proc -and -not $proc.HasExited) { & taskkill /PID $proc.Id /T /F 2>&1 | Out-Null }
}

# --- locate cloudflared ------------------------------------------------------
if (-not $Cloudflared) {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    $candidates = @(
        $(if ($cmd) { $cmd.Source }),
        "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe",
        "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
        "$env:ProgramFiles\cloudflared\cloudflared.exe"
    ) | Where-Object { $_ -and (Test-Path $_) }
    $Cloudflared = $candidates | Select-Object -First 1
}
if (-not $Cloudflared) { throw 'cloudflared not found. Install it: winget install --id Cloudflare.cloudflared' }

$engine = $null
$tunnel = $null
$published = $false
try {
    # --- 1. engine ------------------------------------------------------------
    $local = "http://localhost:$Port"
    if (Test-Engine $local) {
        Log "Engine already running on $local (reusing it)"
    } else {
        Log "Starting battle engine on $local (log: $engineLog)"
        $engine = Start-Process powershell -PassThru -WindowStyle Hidden `
            -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$(Join-Path $here 'run-engine.ps1')`"", '-Port', $Port `
            -RedirectStandardOutput $engineLog -RedirectStandardError "$engineLog.err"
        $deadline = (Get-Date).AddMinutes(3)
        while (-not (Test-Engine $local)) {
            if ($engine.HasExited) { throw "Engine exited during startup; see $engineLog and $engineLog.err" }
            if ((Get-Date) -gt $deadline) { throw "Engine did not come up within 3 minutes; see $engineLog" }
            Start-Sleep -Seconds 2
        }
        Log 'Engine is up'
    }

    # --- 2. tunnel ------------------------------------------------------------
    Log "Starting Cloudflare quick tunnel (log: $tunnelLog)"
    if (Test-Path $tunnelLog) { Remove-Item $tunnelLog -Force }
    $tunnel = Start-Process $Cloudflared -PassThru -WindowStyle Hidden `
        -ArgumentList 'tunnel', '--no-autoupdate', '--url', $local `
        -RedirectStandardError $tunnelLog -RedirectStandardOutput "$tunnelLog.out"
    $publicUrl = $null
    $deadline = (Get-Date).AddSeconds(90)
    while (-not $publicUrl) {
        if ($tunnel.HasExited) { throw "cloudflared exited; see $tunnelLog" }
        if ((Get-Date) -gt $deadline) { throw "No trycloudflare URL after 90s; see $tunnelLog" }
        Start-Sleep -Seconds 1
        if (Test-Path $tunnelLog) {
            $m = Select-String -Path $tunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
            if ($m) { $publicUrl = $m.Matches[0].Value }
        }
    }
    Log "Tunnel URL: $publicUrl"

    # --- 3. wait until reachable through the tunnel (DNS can take a moment) ----
    $deadline = (Get-Date).AddMinutes(2)
    while (-not (Test-Engine $publicUrl)) {
        if ($tunnel.HasExited) { throw "cloudflared exited; see $tunnelLog" }
        if ((Get-Date) -gt $deadline) { throw "Engine not reachable through $publicUrl after 2 minutes; see $tunnelLog" }
        Start-Sleep -Seconds 3
    }

    # --- 4. publish -----------------------------------------------------------
    Publish-EngineUrl $publicUrl
    $published = $true
    Log "Published to Supabase app_config.battle_engine_url"
    Log "Battles are live on the Pages site. Press Ctrl+C to stop."

    # --- 5. watch -------------------------------------------------------------
    $failures = 0
    while ($true) {
        Start-Sleep -Seconds 15
        if ($tunnel.HasExited) { throw 'cloudflared stopped' }
        if ($engine -and $engine.HasExited) { throw 'battle engine stopped' }
        if (Test-Engine $publicUrl) { $failures = 0 }
        elseif (++$failures -ge 4) { throw "Engine unreachable through $publicUrl for a minute" }
    }
} finally {
    if ($published) {
        try { Publish-EngineUrl ''; Log 'Cleared app_config.battle_engine_url' } catch { Log "Could not clear the URL: $_" }
    }
    Stop-Tree $tunnel
    Stop-Tree $engine
    Log 'Stopped'
}
