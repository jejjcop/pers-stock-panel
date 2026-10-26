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

Stop-InstalledServer
