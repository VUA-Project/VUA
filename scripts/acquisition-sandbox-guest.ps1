# Called only by the prepared .wsb configuration. Uses production Rust behavior.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateSet('china_mainland','other')][string]$Region)
$ErrorActionPreference = 'Stop'
$vuaBundle = 'C:\VUA-Test-Bundle'
$vuaResults = 'C:\VUA-Test-Results'
$vuaData = 'C:\VUA-Acquisition-Test\data'
$vuaStarted = [DateTime]::UtcNow.ToString('o')
$vuaExit = 1
$vuaFailure = $null
$vuaOutputAccepted = $false
try {
    if ($env:USERNAME -ne 'WDAGUtilityAccount' -or $env:USERPROFILE -ne 'C:\Users\WDAGUtilityAccount') {
        throw 'Refused: this script is for a disposable Windows Sandbox guest.'
    }
    if (!(Test-Path -LiteralPath $vuaResults -PathType Container)) { throw 'Missing dedicated result mapping.' }
    if (Get-ChildItem -LiteralPath $vuaResults -Force | Select-Object -First 1) { throw 'Use a new result folder; do not overwrite a previous run.' }
    $vuaOutputAccepted = $true
    $vuaManifest = Get-Content -LiteralPath (Join-Path $vuaBundle 'manifest.json') -Raw | ConvertFrom-Json
    foreach ($vuaFile in $vuaManifest.files) {
        if ($vuaFile.path -notin @('sandbox-acquisition-smoke.exe','guest.ps1')) { throw 'Unexpected acceptance input.' }
        if ((Get-FileHash -LiteralPath (Join-Path $vuaBundle $vuaFile.path) -Algorithm SHA256).Hash -ne $vuaFile.sha256) { throw 'Acceptance input hash changed.' }
    }
    Copy-Item -LiteralPath (Join-Path $vuaBundle 'manifest.json') -Destination (Join-Path $vuaResults 'manifest.json')
    $vuaWindows = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
    [ordered]@{startedAt=$vuaStarted; region=$Region; edition=$vuaWindows.EditionID; build=$vuaWindows.CurrentBuild; scope=$vuaManifest.scope} |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $vuaResults 'started.json') -Encoding UTF8
    $env:VUA_PROVIDER_DATA = $vuaData
    $env:VUA_SANDBOX_INSTALL_CONSENT = 'install-official-clients-in-disposable-sandbox'
    & (Join-Path $vuaBundle 'sandbox-acquisition-smoke.exe') --install-vendors $Region 2>&1 | ForEach-Object {
        $_ | Add-Content -LiteralPath (Join-Path $vuaResults 'events.jsonl') -Encoding UTF8
        Write-Host $_
    }
    $vuaExit = $LASTEXITCODE
} catch { $vuaFailure = $_.Exception.Message; Write-Host $vuaFailure }
finally {
    if ($vuaOutputAccepted -and (Test-Path -LiteralPath $vuaData -PathType Container)) {
        Get-ChildItem -LiteralPath $vuaData -File -Recurse | Where-Object { $_.Name -match '\.(json|db)(-wal|-shm)?$' } | ForEach-Object {
            $vuaRelative = $_.FullName.Substring($vuaData.Length + 1)
            $vuaDestination = Join-Path (Join-Path $vuaResults 'guest-evidence') $vuaRelative
            New-Item -ItemType Directory -Path (Split-Path -Parent $vuaDestination) -Force | Out-Null
            Copy-Item -LiteralPath $_.FullName -Destination $vuaDestination
        }
    }
    if ($vuaOutputAccepted) {
        [ordered]@{startedAt=$vuaStarted; finishedAt=[DateTime]::UtcNow.ToString('o'); region=$Region; exitCode=$vuaExit; failure=$vuaFailure; status=$(if ($vuaExit -eq 0) {'passed'} else {'failed'})} |
            ConvertTo-Json | Set-Content -LiteralPath (Join-Path $vuaResults 'finished.json') -Encoding UTF8
    }
}
exit $vuaExit
