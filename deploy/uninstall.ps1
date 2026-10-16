# Removes the scheduled tasks and stops the installed server. The installed
# copy and the log stay in %LOCALAPPDATA%\PersStockPanel (delete the folder
# to remove them); the data file is never touched.
#
#   powershell -ExecutionPolicy Bypass -File deploy\uninstall.ps1

. (Join-Path $PSScriptRoot 'common.ps1')

foreach ($taskName in @($ServerTaskName, $UpdateTaskName)) {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Log "Removed the scheduled task '$taskName'."
    }
}

# Stop the installed app's PHP server, and only that one.
$installedPublic = Join-Path $AppDir 'public'
Get-CimInstance Win32_Process -Filter "Name = 'php.exe'" |
    Where-Object { $_.CommandLine -like "*$installedPublic*" } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -Confirm:$false
        Write-Log "Stopped the installed server (process $($_.ProcessId))."
    }
