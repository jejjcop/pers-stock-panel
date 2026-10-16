# Runs the installed app on http://127.0.0.1:<port>, using the data folder
# from the settings. Started at login by a scheduled task and keeps running
# until logout. PHP reads the files on every request, so updates take effect
# without a restart.

. (Join-Path $PSScriptRoot 'common.ps1')

$settings = Read-Settings
if (Test-PortInUse $settings.Port) {
    Write-Log "Port $($settings.Port) is already in use, so the server was not started. Close the program using it, then run the '$ServerTaskName' task."
    exit 1
}

$env:STOCK_PANEL_DATA_DIR = $settings.DataDir
Write-Log "Starting the server on http://127.0.0.1:$($settings.Port) with data in $($settings.DataDir)."
# The built-in server logs every request to its error output; that is not
# kept. Windows PowerShell would treat those lines as errors and stop the
# script, so errors only continue here.
$ErrorActionPreference = 'Continue'
& $Php -S "127.0.0.1:$($settings.Port)" -t (Join-Path $AppDir 'public') 2>&1 | Out-Null
Write-Log "The server stopped (exit code $LASTEXITCODE)."
