# One-time setup of the local deployment:
#   - installs the app from GitHub into %LOCALAPPDATA%\PersStockPanel\app
#   - a scheduled task starts its server at login (no window)
#   - a scheduled task installs each new version from GitHub every 15
#     minutes, once its tests have passed there
# Run again to change the settings; it does not touch the data file.
#
#   powershell -ExecutionPolicy Bypass -File deploy\install.ps1

param(
    # The folder with portfolio.json. Defaults to this project's data folder,
    # which OneDrive backs up.
    [string] $DataDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'data'),
    [int] $Port = 8080
)

. (Join-Path $PSScriptRoot 'common.ps1')

$DataDir = [System.IO.Path]::GetFullPath($DataDir)
New-Item -ItemType Directory -Force $InstallRoot | Out-Null

if (Test-Path (Join-Path $AppDir '.git')) {
    Write-Log "Updating the installed app in $AppDir."
    & $Git -C $AppDir fetch --quiet origin main
    & $Git -C $AppDir merge --ff-only --quiet origin/main
} else {
    Write-Log "Installing the app from GitHub into $AppDir."
    & $Git clone --quiet "https://github.com/$Repository.git" $AppDir
}
if ($LASTEXITCODE -ne 0) {
    throw 'Could not get the app from GitHub.'
}
if (-not (Test-Path (Join-Path $AppDir 'deploy\start-server.ps1'))) {
    throw 'The version on GitHub does not contain the deploy scripts yet. Push them first.'
}

[pscustomobject] @{ DataDir = $DataDir; Port = $Port } |
    ConvertTo-Json | Set-Content -Path $SettingsFile -Encoding utf8
Write-Log "Settings saved: data in $DataDir, port $Port."

# conhost --headless runs the scripts without a console window popping up.
$powershell = Join-Path $PSHOME 'powershell.exe'
function New-HiddenAction([string] $Script) {
    $arguments = "--headless `"$powershell`" -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $AppDir "deploy\$Script")`""
    return New-ScheduledTaskAction -Execute 'conhost.exe' -Argument $arguments -WorkingDirectory $AppDir
}

$user = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

$serverSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $ServerTaskName -Force -Principal $principal -Settings $serverSettings `
    -Action (New-HiddenAction 'start-server.ps1') -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $user) `
    -Description "Runs Pers Stock Panel on http://127.0.0.1:$Port." | Out-Null

$updateTriggers = @(
    (New-ScheduledTaskTrigger -AtLogOn -User $user),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15))
)
$updateSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $UpdateTaskName -Force -Principal $principal -Settings $updateSettings `
    -Action (New-HiddenAction 'update.ps1') -Trigger $updateTriggers `
    -Description 'Installs new versions of Pers Stock Panel from GitHub once their tests have passed.' | Out-Null
Write-Log "Scheduled tasks '$ServerTaskName' and '$UpdateTaskName' are set up."

if (Test-PortInUse $Port) {
    Write-Log "Port $Port is in use by another program (probably a server started by hand). Close it, then run: Start-ScheduledTask '$ServerTaskName'"
} else {
    Start-ScheduledTask -TaskName $ServerTaskName
    Write-Log "Server started: open http://127.0.0.1:$Port"
}
