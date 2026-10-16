# Installs the newest version from GitHub, but only once its tests have
# passed on GitHub Actions. Runs every 15 minutes as a scheduled task; run it
# by hand to update straight away.

. (Join-Path $PSScriptRoot 'common.ps1')

try {
    Invoke-Git @('-C', $AppDir, 'fetch', '--quiet', 'origin', 'main') | Out-Null

    $installed = "$(Invoke-Git @('-C', $AppDir, 'rev-parse', 'HEAD'))".Trim()
    $newest = "$(Invoke-Git @('-C', $AppDir, 'rev-parse', 'origin/main'))".Trim()
    if ($installed -eq $newest) {
        exit 0
    }

    $short = $newest.Substring(0, 7)
    $runs = Invoke-Tool $Gh 'gh' @('run', 'list', '--repo', $Repository, '--workflow', 'tests.yml', '--commit', $newest, '--limit', '1', '--json', 'status,conclusion') |
        Out-String | ConvertFrom-Json
    if (-not $runs) {
        Write-Log "Version $short has no test run on GitHub yet; trying again later."
        exit 0
    }
    if ($runs[0].status -ne 'completed') {
        Write-Log "Version $short is still being tested on GitHub; trying again later."
        exit 0
    }
    if ($runs[0].conclusion -ne 'success') {
        Write-Log "Version $short failed its tests on GitHub ($($runs[0].conclusion)), so it was not installed."
        exit 0
    }

    # The installed copy is never edited by hand, so it can always move
    # straight forward to the new version.
    Invoke-Git @('-C', $AppDir, 'merge', '--ff-only', '--quiet', 'origin/main') | Out-Null
    $subject = "$(Invoke-Git @('-C', $AppDir, 'log', '-1', '--format=%s'))".Trim()
    Write-Log "Installed version $short ($subject). The page shows it after a reload."
}
catch {
    Write-Log "Update failed: $($_.Exception.Message)"
    exit 1
}
