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
# Laravel's router script sends every address that is not a file in public/
# to Laravel. OPcache is off: in PHP 8.5.11's built-in server it makes calls
# to mb_* functions reach the wrong function once the fileinfo extension
# (which Laravel needs) is loaded.
$router = Join-Path $AppDir 'vendor\laravel\framework\src\Illuminate\Foundation\resources\server.php'
& $Php -d opcache.enable=0 -S "127.0.0.1:$($settings.Port)" -t (Join-Path $AppDir 'public') $router 2>&1 | Out-Null
Write-Log "The server stopped (exit code $LASTEXITCODE)."
