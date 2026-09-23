# restart-all.ps1 — Stop, rebuild, and restart everything (DB, engine, backend, frontend)
# Usage: powershell -File restart-all.ps1

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$maven = "C:\Users\student\AppData\Local\Temp\opencode\apache-maven-3.9.9\bin\mvn.cmd"
$node = "C:\Users\student\AppData\Local\Temp\opencode\node-v20.18.0-win-x64"
$deno = "C:\Users\student\.deno\bin"

Write-Host "`n=== 1/6 Stopping processes ===" -ForegroundColor Cyan
Get-Process java -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process deno -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "  java + deno killed"

Write-Host "`n=== 2/6 Building forge-engine ===" -ForegroundColor Cyan
Push-Location "$root\forge-engine"
& $maven -pl forge-headless -am install -DskipTests -q
Pop-Location
if ($LASTEXITCODE -ne 0) { Write-Host "  FORGE BUILD FAILED" -ForegroundColor Red; exit 1 }
Write-Host "  forge-engine OK"

Write-Host "`n=== 3/6 Building backend jar ===" -ForegroundColor Cyan
Push-Location "$root\backend"
& $maven -q clean package -DskipTests
if ($LASTEXITCODE -ne 0) { Write-Host "  BACKEND BUILD FAILED" -ForegroundColor Red; Pop-Location; exit 1 }
Pop-Location
Write-Host "  backend jar OK"

Write-Host "`n=== 4/6 Building frontend ===" -ForegroundColor Cyan
Push-Location "$root\web-client"
$env:Path = "$node;$env:Path"
& npm run build
Pop-Location
Write-Host "  frontend OK"

Write-Host "`n=== 5/6 Starting backend ===" -ForegroundColor Cyan
Push-Location "$root\backend"
Start-Process -NoNewWindow -FilePath "java" -ArgumentList "-jar","target\campusforge-backend-0.0.1-SNAPSHOT.jar" -RedirectStandardOutput "backend.log" -RedirectStandardError "backend.log.err"
Pop-Location

Write-Host "`n=== 6/6 Starting frontend (Deno) ===" -ForegroundColor Cyan
Push-Location "$root\web-client"
$env:DENO_INSTALL = "C:\Users\student\.deno"
$env:Path = "$deno;$env:Path"
Start-Process -NoNewWindow -FilePath "deno" -ArgumentList "run","--allow-net","--allow-read","--allow-env","serve.mjs" -RedirectStandardOutput "deno.log" -RedirectStandardError "deno.log.err"
Pop-Location

Write-Host "`n=== Waiting for services ===" -ForegroundColor Cyan
Start-Sleep -Seconds 6

$ok = $true
try {
  $r = Invoke-WebRequest -Uri "http://localhost:17172/api/v1/auth/login" -Method POST -ContentType "application/json" -Body '{"email":"x","password":"x"}' -ErrorAction Stop
} catch { if ($_.Exception.Response.StatusCode.value__ -eq 401 -or $_.Exception.Response.StatusCode.value__ -eq 403) { Write-Host "  Backend (17172): UP" -ForegroundColor Green } else { Write-Host "  Backend (17172): UNEXPECTED $($_.Exception.Response.StatusCode)" -ForegroundColor Yellow; $ok=$false } }
try {
  $r = Invoke-WebRequest -Uri "http://localhost:17170" -ErrorAction Stop
  Write-Host "  Frontend (17170): UP" -ForegroundColor Green
} catch {
  Write-Host "  Frontend (17170): DOWN" -ForegroundColor Red; $ok=$false
}

Write-Host "`n=== Done ===" -ForegroundColor $(if($ok){'Green'}else{'Red'})
