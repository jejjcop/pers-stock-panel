# Shared settings and helpers for the deployment scripts. The installed app,
# its settings and its logs live in %LOCALAPPDATA%\PersStockPanel, outside
# OneDrive and outside the working copy used for development.

$ErrorActionPreference = 'Stop'

$InstallRoot = Join-Path $env:LOCALAPPDATA 'PersStockPanel'
$AppDir = Join-Path $InstallRoot 'app'
$LogFile = Join-Path $InstallRoot 'deploy.log'
$SettingsFile = Join-Path $InstallRoot 'settings.json'
# The version (commit) of the installed copy that prepare.ps1 last finished.
$PreparedFile = Join-Path $InstallRoot 'prepared.txt'
$Repository = 'jejjcop/pers-stock-panel'
$ServerTaskName = 'Pers Stock Panel - server'
$UpdateTaskName = 'Pers Stock Panel - update'

# Scheduled tasks do not always see an up-to-date PATH, so the tools are
# looked up by full path first.
function Find-Tool([string] $Name, [string[]] $Candidates) {
    foreach ($candidate in $Candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }
    throw "$Name was not found."
}

$Git = Find-Tool 'git' @('C:\Program Files\Git\cmd\git.exe')
$Gh = Find-Tool 'gh' @('C:\Program Files\GitHub CLI\gh.exe')
$Php = Find-Tool 'php' @('C:\php\php.exe')

function Write-Log([string] $Message) {
    New-Item -ItemType Directory -Force $InstallRoot | Out-Null
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $LogFile -Value $line -Encoding utf8
    Write-Output $line
    # Keep the log from growing forever.
    $lines = Get-Content -Path $LogFile -Encoding utf8
    if ($lines.Count -gt 2000) {
        $lines | Select-Object -Last 1000 | Set-Content -Path $LogFile -Encoding utf8
    }
}

function Read-Settings {
    if (-not (Test-Path $SettingsFile)) {
        throw "No settings found at $SettingsFile. Run deploy\install.ps1 first."
    }
    return Get-Content -Raw -Path $SettingsFile -Encoding utf8 | ConvertFrom-Json
}

# Runs a program and returns its output; throws with the program's own
# message if it fails. Both output streams are captured: in a scheduled task
# with no console, git fails when its error output goes nowhere, and Windows
# PowerShell would otherwise treat that output as errors.
function Invoke-Tool([string] $Path, [string] $Name, [string[]] $Arguments) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $Path @Arguments 2>&1 | ForEach-Object { "$_" }
    } finally {
        $ErrorActionPreference = $previous
    }
    if ($LASTEXITCODE -ne 0) {
        throw "$Name $($Arguments -join ' ') failed: $(($output | Where-Object { $_ }) -join ' / ')"
    }
    return $output
}

function Invoke-Git([string[]] $Arguments) {
    return Invoke-Tool $Git 'git' $Arguments
}

function Test-PortInUse([int] $Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

# Stops the installed app's PHP server, and only that one.
function Stop-InstalledServer {
    if (Get-ScheduledTask -TaskName $ServerTaskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $ServerTaskName
    }
    $installedPublic = Join-Path $AppDir 'public'
    Get-CimInstance Win32_Process -Filter "Name = 'php.exe'" |
        Where-Object { $_.CommandLine -like "*$installedPublic*" } |
        ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -Confirm:$false
            Write-Log "Stopped the installed server (process $($_.ProcessId))."
        }
}

function Restart-InstalledServer {
    Stop-InstalledServer
    $port = (Read-Settings).Port
    for ($i = 0; $i -lt 20 -and (Test-PortInUse $port); $i++) {
        Start-Sleep -Milliseconds 250
    }
    Start-ScheduledTask -TaskName $ServerTaskName
    Write-Log "Restarted the server on http://127.0.0.1:$port."
}

# Runs the installed version's prepare.ps1 unless that version is already
# prepared, then restarts the server if the way it is started has changed.
# A preparation that fails is tried again on the next update.
function Initialize-InstalledApp {
    $script = Join-Path $AppDir 'deploy\prepare.ps1'
    if (-not (Test-Path $script)) {
        return  # a version from before Laravel, which needs no preparing
    }
    $head = "$(Invoke-Git @('-C', $AppDir, 'rev-parse', 'HEAD'))".Trim()
    $prepared = if (Test-Path $PreparedFile) { (Get-Content -Raw -Path $PreparedFile).Trim() } else { '' }
    if ($prepared -eq $head) {
        return
    }

    $powershell = Join-Path $PSHOME 'powershell.exe'
    Invoke-Tool $powershell 'prepare.ps1' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script) | Out-Null

    # Without a known earlier version, the server may still run the way an
    # older version started it.
    $restart = $true
    if ($prepared) {
        try {
            $changed = Invoke-Git @('-C', $AppDir, 'diff', '--name-only', $prepared, $head, '--', 'deploy/start-server.ps1')
            $restart = [bool]($changed | Where-Object { $_ })
        } catch {}
    }
    if ($restart -and (Get-ScheduledTask -TaskName $ServerTaskName -ErrorAction SilentlyContinue)) {
        Restart-InstalledServer
    }
    Set-Content -Path $PreparedFile -Value $head -Encoding ascii
}
