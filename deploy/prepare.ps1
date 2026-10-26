# Gets an installed copy ready to run after it was installed or updated:
# Laravel's settings file and secret key, its libraries, the database's
# tables, and (once) the password and stocks that older versions saved as
# JSON. Each step changes nothing when there is nothing to do. install.ps1
# and update.ps1 run it in a new process, so the steps of the version just
# installed are the ones that run.
#
#   powershell -ExecutionPolicy Bypass -File deploy\prepare.ps1

param(
    # For trying it out on another copy and data folder; by default the
    # installed copy and the data folder from the settings.
    [string] $App = '',
    [string] $DataDir = ''
)

. (Join-Path $PSScriptRoot 'common.ps1')

if (-not $App) {
    $App = $AppDir
}
if (-not $DataDir) {
    $DataDir = (Read-Settings).DataDir
}
$Composer = Find-Tool 'composer' @((Join-Path $env:LOCALAPPDATA 'Programs\Composer\composer.bat'))
$artisan = Join-Path $App 'artisan'

# Laravel's settings for this copy. Error details stay off the page here.
$envFile = Join-Path $App '.env'
if (-not (Test-Path $envFile)) {
    $lines = (Get-Content -Path (Join-Path $App '.env.example') -Encoding utf8) -replace '^APP_DEBUG=.*$', 'APP_DEBUG=false'
    # Without the byte order mark Windows PowerShell adds to UTF-8 files,
    # which Laravel would read as part of the first setting's name.
    [System.IO.File]::WriteAllLines($envFile, $lines, (New-Object System.Text.UTF8Encoding $false))
    Write-Log "Created Laravel's settings file $envFile."
}

Invoke-Tool $Composer 'composer' @('install', '--working-dir', $App, '--no-dev', '--no-interaction', '--no-progress', '--prefer-dist') | Out-Null

if (-not (Select-String -Path $envFile -Pattern '^APP_KEY=.+' -Quiet)) {
    Invoke-Tool $Php 'php' @($artisan, 'key:generate', '--force', '--no-interaction') | Out-Null
    Write-Log 'Created the secret key in the settings file.'
}

# The database lives in the data folder, next to the JSON files it replaces.
$env:STOCK_PANEL_DATA_DIR = $DataDir
$migrated = Invoke-Tool $Php 'php' @($artisan, 'migrate', '--force', '--no-interaction')
$done = @($migrated | Where-Object { $_ -match 'DONE' }).Count
if ($done -gt 0) {
    Write-Log "Updated the database in $DataDir ($done change(s))."
}
$imported = Invoke-Tool $Php 'php' @($artisan, 'stock-panel:import-json', '--no-interaction')
if ($imported -match 'Imported') {
    Write-Log "$(($imported | Where-Object { $_ -match 'Imported' }) -join ' ')".Trim()
}
