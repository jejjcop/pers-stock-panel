# Shared settings and helpers for the deployment scripts. The installed app,
# its settings and its logs live in %LOCALAPPDATA%\PersStockPanel, outside
# OneDrive and outside the working copy used for development.

$ErrorActionPreference = 'Stop'

$InstallRoot = Join-Path $env:LOCALAPPDATA 'PersStockPanel'
$AppDir = Join-Path $InstallRoot 'app'
$LogFile = Join-Path $InstallRoot 'deploy.log'
$SettingsFile = Join-Path $InstallRoot 'settings.json'
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

function Test-PortInUse([int] $Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}
