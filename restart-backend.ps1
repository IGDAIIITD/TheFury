# Restarts the Campus Forge backend cleanly (Windows / PowerShell).
$ErrorActionPreference = 'Stop'
$backend = Join-Path $PSScriptRoot 'backend'
$jar = Join-Path $backend 'target\campusforge-backend-0.0.1-SNAPSHOT.jar'

if (-not (Test-Path -LiteralPath $jar)) {
    throw "Backend jar not found: $jar`nBuild first: mvn clean package -DskipTests (from $backend)"
}

Get-Process java -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

$log = Join-Path $backend 'backend.log'
Start-Process -FilePath 'java' -ArgumentList '-jar', 'target\campusforge-backend-0.0.1-SNAPSHOT.jar' `
    -WorkingDirectory $backend -RedirectStandardOutput $log -RedirectStandardError "$log.err" -WindowStyle Hidden

Write-Host "Backend starting... PID logged at $log (port 17172)"
