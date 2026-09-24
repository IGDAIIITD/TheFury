# setup-forge.ps1 - recreate the Forge fork that battle-engine embeds, then build it.
#
#   1. clones Card-Forge/forge into <repo>/forge-engine at the pinned commit (blobless +
#      sparse: only forge-core, forge-game, forge-ai and forge-gui/res are checked out)
#   2. applies forge/campusforge-forge.patch (module list trimmed to core/game/ai/headless,
#      flatten plugin moved to process-resources, Cudgel Troll regen timing fix)
#   3. copies forge/forge-headless into the checkout
#   4. mvn -pl forge-headless -am install -DskipTests  (puts forge-headless in ~/.m2)
#
# Usage (from anywhere):
#   powershell -ExecutionPolicy Bypass -File battle-engine/setup-forge.ps1 [-Mvn <path-to-mvn>] [-ForgeDir <dir>] [-SkipBuild]
#
# Idempotent: an existing checkout at the pinned commit is reused; the patch is skipped
# when it is already applied.

param(
    [string]$Mvn = 'mvn',
    [string]$ForgeDir = '',
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$ForgeRepo = 'https://github.com/Card-Forge/forge.git'
$ForgeCommit = 'fd8196a88a8173bd88c745de7578a41eac8cb2e1'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ForgeDir) { $ForgeDir = Join-Path (Split-Path -Parent $here) 'forge-engine' }
$patch = Join-Path $here 'forge\campusforge-forge.patch'
$headless = Join-Path $here 'forge\forge-headless'

function Invoke-Git { git @args; if ($LASTEXITCODE -ne 0) { throw "git $args failed ($LASTEXITCODE)" } }

if (-not (Test-Path (Join-Path $ForgeDir '.git'))) {
    Write-Host "Cloning Forge into $ForgeDir (blobless, this takes a few minutes)..."
    Invoke-Git -c core.longpaths=true -c core.autocrlf=false -c core.eol=lf clone --filter=blob:none --no-checkout $ForgeRepo $ForgeDir
    Invoke-Git -C $ForgeDir config core.longpaths true
    Invoke-Git -C $ForgeDir config core.autocrlf false
    Invoke-Git -C $ForgeDir config core.eol lf   # Forge is `* text=auto`; LF checkout keeps the patch applying
    # Only what forge-headless builds against + the card database it loads at runtime.
    Invoke-Git -C $ForgeDir sparse-checkout set --cone forge-core forge-game forge-ai forge-gui/res
}

Push-Location $ForgeDir
try {
    $head = (git rev-parse HEAD 2>$null)
    if ($head -ne $ForgeCommit) {
        Write-Host "Checking out pinned Forge commit $ForgeCommit..."
        Invoke-Git fetch --filter=blob:none origin $ForgeCommit
        Invoke-Git checkout --force $ForgeCommit
    }

    # A failing reverse-check just means "not applied yet"; keep PS 5.1 from
    # turning git's stderr into a terminating error.
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    git apply --check -R $patch 2>&1 | Out-Null
    $alreadyApplied = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = $prev
    if ($alreadyApplied) {
        Write-Host 'Campus Forge patch already applied.'
    } else {
        Write-Host 'Applying Campus Forge patch...'
        Invoke-Git apply --whitespace=nowarn $patch
    }

    Write-Host 'Syncing forge-headless module...'
    $dest = Join-Path $ForgeDir 'forge-headless'
    # rd with the \\?\ prefix: build output under target\ can exceed MAX_PATH,
    # which PS 5.1's Remove-Item cannot delete.
    if (Test-Path $dest) { & cmd.exe /c "rd /s /q `"\\?\$dest`"" }
    if (Test-Path $dest) { throw "could not remove $dest" }
    Copy-Item -Recurse $headless $dest

    if (-not $SkipBuild) {
        Write-Host "Building forge-headless with '$Mvn'..."
        & $Mvn -q -pl forge-headless -am install -DskipTests
        if ($LASTEXITCODE -ne 0) { throw "maven build failed ($LASTEXITCODE)" }
        Write-Host 'forge-headless installed into the local Maven repository.'
    }
} finally {
    Pop-Location
}
