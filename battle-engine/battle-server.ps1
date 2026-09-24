# battle-server.ps1 - run the Campus Forge battle backend as a background
# service on this PC (engine + Cloudflare quick tunnel, see start-public.ps1).
#
#   powershell -ExecutionPolicy Bypass -File battle-engine\battle-server.ps1 [action]
#
# Actions (admin required except status/logs; the script elevates itself):
#   install    check prerequisites, register the "CampusForge Battles" scheduled
#              task (SYSTEM, at boot, no login needed), disable sleep on AC
#              power, start it and wait until battles are live   (default)
#   start      start the task and wait until battles are live
#   stop       stop the task, kill engine + tunnel, clear the published URL
#   restart    stop + start
#   status     task state, processes, published URL and whether it answers
#   logs       show the last lines of the supervisor / engine / tunnel logs
#   uninstall  stop and remove the scheduled task
#   run        (used by the task) supervisor loop: runs start-public.ps1 and
#              restarts it 30 s after it exits, forever
#
# Logs: battle-engine\logs\ (supervisor.log, start-public.log, engine.log, cloudflared.log)

param(
    [ValidateSet('install', 'start', 'stop', 'restart', 'status', 'logs', 'uninstall', 'run')]
    [string]$Action = 'install'
)

$ErrorActionPreference = 'Stop'
$TaskName = 'CampusForge Battles'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent $here
$logs = Join-Path $here 'logs'
$supervisorLog = Join-Path $logs 'supervisor.log'
$startPublic = Join-Path $here 'start-public.ps1'
New-Item -ItemType Directory -Force -Path $logs | Out-Null

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Ok($msg) { Say "  [ok]   $msg" 'Green' }
function Bad($msg) { Say "  [fail] $msg" 'Red' }

function Test-Admin {
    ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

# --- self-elevate for actions that need it ------------------------------------
if ($Action -in 'install', 'start', 'stop', 'restart', 'uninstall' -and -not (Test-Admin)) {
    Say 'Administrator rights needed; relaunching elevated (approve the UAC prompt)...' 'Yellow'
    Start-Process powershell -Verb RunAs -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', "`"$($MyInvocation.MyCommand.Path)`"", $Action)
    exit 0
}

# --- .env (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) --------------------------
$config = @{}
$envFile = Join-Path $repo '.env'
if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') { $config[$Matches[1]] = $Matches[2].Trim('"', "'") }
    }
}

function Service-Headers {
    @{ apikey = $config.SUPABASE_SERVICE_ROLE_KEY; Authorization = "Bearer $($config.SUPABASE_SERVICE_ROLE_KEY)" }
}

function Get-PublishedUrl {
    try {
        $rows = Invoke-RestMethod -Headers (Service-Headers) -TimeoutSec 15 `
            -Uri "$($config.SUPABASE_URL.TrimEnd('/'))/rest/v1/app_config?select=value&key=eq.battle_engine_url"
        return $rows[0].value
    } catch { return $null }
}

function Clear-PublishedUrl {
    try {
        $h = Service-Headers; $h.Prefer = 'return=minimal'
        Invoke-RestMethod -Method Patch -Headers $h -ContentType 'application/json' -Body '{"value":null}' -TimeoutSec 15 `
            -Uri "$($config.SUPABASE_URL.TrimEnd('/'))/rest/v1/app_config?key=eq.battle_engine_url" | Out-Null
        return $true
    } catch { return $false }
}

function Test-Engine([string]$origin) {
    if (-not $origin) { return $false }
    try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Uri "$origin/api/v1/battle/features").StatusCode -eq 200 }
    catch { return $false }
}

# Every process that belongs to the backend, wherever it was started from.
function Get-BackendProcesses {
    Get-CimInstance Win32_Process | Where-Object {
        $cl = $_.CommandLine
        $cl -and $_.ProcessId -ne $PID -and (
            ($_.Name -eq 'powershell.exe' -and ($cl -like '*start-public.ps1*' -or $cl -like '*run-engine.ps1*' -or
                ($cl -like '*battle-server.ps1*' -and $cl -match '\brun\b'))) -or
            ($_.Name -eq 'java.exe' -and $cl -like '*campusforge-battle-engine*') -or
            ($_.Name -eq 'cloudflared.exe' -and $cl -like '*--url http://localhost:*'))
    }
}

function Find-Exe([string]$name, [string[]]$extra) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    (@($(if ($cmd) { $cmd.Source })) + $extra) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}

function Wait-Live([int]$seconds = 300) {
    Say "Waiting for the engine and tunnel to come up (up to $([int]($seconds / 60)) min)..."
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        $url = Get-PublishedUrl
        if ($url -and (Test-Engine $url)) {
            Say ''
            Say "Battles are LIVE at $url" 'Green'
            Say 'The site https://igdaiiitd.github.io/TheFury/ picks this up automatically.' 'Green'
            return $true
        }
        Start-Sleep -Seconds 5
        Write-Host '.' -NoNewline
    }
    Say ''
    Bad "Not live after $seconds s. Check: battle-server.ps1 logs"
    return $false
}

function Stop-Backend {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task -and $task.State -eq 'Running') { Stop-ScheduledTask -TaskName $TaskName; Ok 'scheduled task stopped' }
    $procs = @(Get-BackendProcesses)
    foreach ($p in $procs) { & taskkill /PID $p.ProcessId /T /F 2>&1 | Out-Null }
    if ($procs.Count) { Ok "killed $($procs.Count) backend process(es)" } else { Ok 'no backend processes running' }
    if ($config.SUPABASE_URL -and $config.SUPABASE_SERVICE_ROLE_KEY) {
        if (Clear-PublishedUrl) { Ok 'published URL cleared (Battle tab hidden)' } else { Bad 'could not clear the published URL' }
    }
}

switch ($Action) {
    'run' {
        # Supervisor loop executed by the scheduled task (as SYSTEM). The current
        # run's output goes to start-public.log / .err.log (replaced on restart);
        # supervisor.log keeps the start/exit history.
        $ErrorActionPreference = 'Continue'
        $runLog = Join-Path $logs 'start-public.log'
        while ($true) {
            Add-Content -Encoding ascii $supervisorLog ("[{0:yyyy-MM-dd HH:mm:ss}] starting start-public.ps1" -f (Get-Date))
            $p = Start-Process powershell.exe -Wait -PassThru -WindowStyle Hidden `
                -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$startPublic`"" `
                -RedirectStandardOutput $runLog -RedirectStandardError "$runLog.err"
            $last = (Get-Content $runLog -Tail 1 -ErrorAction SilentlyContinue)
            Add-Content -Encoding ascii $supervisorLog ("[{0:yyyy-MM-dd HH:mm:ss}] start-public.ps1 exited ({1}): {2}; restarting in 30 s" -f (Get-Date), $p.ExitCode, $last)
            Start-Sleep -Seconds 30
        }
    }

    'install' {
        Say "Campus Forge battle backend - install`n" 'Cyan'
        $problems = 0
        $java = Find-Exe 'java' @("$env:ProgramFiles\Common Files\Oracle\Java\javapath\java.exe")
        if ($java) { Ok "java: $java" } else { Bad 'java not found (install JDK 17+)'; $problems++ }
        $cf = Find-Exe 'cloudflared' @("$env:ProgramData\chocolatey\bin\cloudflared.exe", "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe")
        if ($cf) { Ok "cloudflared: $cf" } else { Bad 'cloudflared not found (choco install cloudflared -y)'; $problems++ }
        $jar = Get-ChildItem (Join-Path $here 'target') -Filter 'campusforge-battle-engine-*.jar' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($jar) { Ok "engine jar: $($jar.Name) ($($jar.LastWriteTime))" } else { Bad 'engine jar missing: run setup-forge.ps1, then mvn clean package in battle-engine\'; $problems++ }
        if (Test-Path (Join-Path $repo 'forge-engine\forge-gui\res\cardsfolder')) { Ok 'Forge card database: forge-engine\forge-gui\res' } else { Bad 'Forge card database missing: run setup-forge.ps1'; $problems++ }
        if ($config.SUPABASE_URL -and $config.SUPABASE_SERVICE_ROLE_KEY) { Ok ".env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" } else { Bad ".env must define SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY ($envFile)"; $problems++ }
        if ($problems) { Say "`nFix the $problems problem(s) above and run install again." 'Red'; exit 1 }

        Say "`nStopping anything already running..." 'Cyan'
        Stop-Backend

        Say "`nRegistering scheduled task '$TaskName'..." 'Cyan'
        $action = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $here `
            -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$($MyInvocation.MyCommand.Path)`" run"
        $trigger = New-ScheduledTaskTrigger -AtStartup
        $trigger.Delay = 'PT1M'   # let networking come up after boot
        $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
            -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
            -Description 'Campus Forge battle engine + Cloudflare quick tunnel (battle-engine\battle-server.ps1)' -Force | Out-Null
        Ok 'task registered (runs as SYSTEM at boot, no login needed)'

        & powercfg /change standby-timeout-ac 0
        & powercfg /change hibernate-timeout-ac 0
        Ok 'sleep/hibernate disabled on AC power'

        Say "`nStarting..." 'Cyan'
        Start-ScheduledTask -TaskName $TaskName
        [void](Wait-Live)
        Say "`nManage it with: battle-server.ps1 status | logs | restart | stop | uninstall"
    }

    'start' {
        if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) { Bad "not installed; run: battle-server.ps1 install"; exit 1 }
        Start-ScheduledTask -TaskName $TaskName
        [void](Wait-Live)
    }

    'stop' { Stop-Backend }

    'restart' {
        Stop-Backend
        Start-Sleep -Seconds 3
        Start-ScheduledTask -TaskName $TaskName
        [void](Wait-Live)
    }

    'status' {
        $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($task) {
            $info = Get-ScheduledTaskInfo -TaskName $TaskName
            Say "Task:      $($task.State)  (last run $($info.LastRunTime), result $($info.LastTaskResult))"
        } else { Say 'Task:      not installed' 'Yellow' }
        $procs = @(Get-BackendProcesses)
        Say ("Processes: " + $(if ($procs) { ($procs | ForEach-Object { "$($_.Name)#$($_.ProcessId)" }) -join ', ' } else { 'none' }))
        Say ("Local:     " + $(if (Test-Engine 'http://localhost:17175') { 'engine answering on http://localhost:17175' } else { 'engine not answering on :17175' }))
        $url = Get-PublishedUrl
        if (-not $url) { Say 'Published: (none) - Battle tab hidden on the site' 'Yellow' }
        elseif (Test-Engine $url) { Say "Published: $url  (LIVE)" 'Green' }
        else { Say "Published: $url  (NOT answering)" 'Red' }
    }

    'logs' {
        foreach ($f in 'supervisor.log', 'start-public.log', 'engine.log', 'cloudflared.log') {
            $p = Join-Path $logs $f
            Say "`n===== $f =====" 'Cyan'
            if (Test-Path $p) { Get-Content $p -Tail 25 } else { Say '(none yet)' }
        }
    }

    'uninstall' {
        Stop-Backend
        if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
            Ok "task '$TaskName' removed"
        }
    }
}
