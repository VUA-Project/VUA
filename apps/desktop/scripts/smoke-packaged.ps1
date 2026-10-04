param([string]$ZipPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Exercise the actual ZIP outside the checkout with no developer toolchain on PATH.
# Every run gets an isolated profile; no real app settings, accounts or installs are touched.
$desktopRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $desktopRoot 'package.json') -Raw | ConvertFrom-Json).version
if (-not $ZipPath) { $ZipPath = Join-Path $desktopRoot "out/VUA-$version-windows-x64-preview.zip" }
$zip = (Resolve-Path -LiteralPath $ZipPath).Path
$hashAlgorithm = [Security.Cryptography.SHA256]::Create()
$zipStream = [IO.File]::OpenRead($zip)
try { $zipHash = [BitConverter]::ToString($hashAlgorithm.ComputeHash($zipStream)).Replace('-', '') }
finally { $zipStream.Dispose(); $hashAlgorithm.Dispose() }
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('VUA ZIP smoke ' + [guid]::NewGuid().ToString('N'))
# Construct non-ASCII names without relying on Windows PowerShell's script-file encoding.
$unicode = ([char]0x7528).ToString() + ([char]0x6237).ToString()
$first = Join-Path $fixtureRoot "$unicode first launch"
$moved = Join-Path $fixtureRoot "$unicode moved app"
$smokeProfile = Join-Path $fixtureRoot 'isolated profile'
$failureProfile = Join-Path $fixtureRoot 'missing provider profile'
$summaryPath = Join-Path $desktopRoot 'out/packaged-smoke.json'
$environmentNames = @('PATH', 'VUA_RENDERER_URL', 'VUA_PROVIDER_EXECUTABLE', 'VUA_DEV_USER_DATA', 'ELECTRON_RUN_AS_NODE')
$savedEnvironment = @{}
foreach ($name in $environmentNames) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$checks = [System.Collections.Generic.List[string]]::new()

function Invoke-PackagedApp([string]$ProgramDirectory, [string]$DataDirectory, [bool]$ExpectSuccess) {
    $executable = Join-Path $ProgramDirectory 'VUA.exe'
    $process = Start-Process -FilePath $executable -ArgumentList "`"--vua-smoke-test=$DataDirectory`"" `
        -WorkingDirectory $fixtureRoot -WindowStyle Hidden -PassThru
    try {
        if (-not $process.WaitForExit(60000)) { throw 'Packaged app exceeded the 60-second process timeout' }
        $process.Refresh()
        if (($process.ExitCode -eq 0) -ne $ExpectSuccess) { throw "Unexpected packaged app exit code: $($process.ExitCode)" }
        $report = Get-Content -LiteralPath (Join-Path $DataDirectory 'packaged-smoke.json') -Raw | ConvertFrom-Json
        if (($report.status -eq 'passed') -ne $ExpectSuccess) { throw "Unexpected smoke result: $($report.status)" }
        return $report
    } finally {
        if (-not $process.HasExited) {
            # Only the process tree launched above is eligible for forced cleanup.
            & "$env:SystemRoot/System32/taskkill.exe" /PID $process.Id /T /F | Out-Null
        }
        $process.Dispose()
    }
}

try {
    Expand-Archive -LiteralPath $zip -DestinationPath $first
    foreach ($required in @('VUA.exe', 'resources/app.asar', 'resources/provider/vua-orchestrator-provider.exe', 'resources/notices/LICENSE-VUA.txt', 'resources/README.txt')) {
        if (-not (Test-Path -LiteralPath (Join-Path $first $required) -PathType Leaf)) { throw "Missing package file: $required" }
    }
    $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
    $env:VUA_RENDERER_URL = 'http://127.0.0.1:1/should-not-load'
    $env:VUA_PROVIDER_EXECUTABLE = Join-Path $fixtureRoot 'should-not-exist.exe'
    $env:VUA_DEV_USER_DATA = 'invalid-relative-dev-profile'
    [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $null, 'Process')
    $initial = Invoke-PackagedApp $first $smokeProfile $true
    if ($null -ne $initial.previousMarker) { throw 'Fresh profile unexpectedly contained previous data' }
    if ($initial.version -ne $version) { throw 'Packaged product version differs from package.json' }
    $checks.Add('Fresh Unicode/space directory: real renderer, Gateway and bundled Provider; developer overrides ignored')

    # Verify both absolute move targets stay inside this run's newly-created fixture directory.
    foreach ($candidate in @($first, $moved)) {
        if (-not ([IO.Path]::GetFullPath($candidate)).StartsWith(([IO.Path]::GetFullPath($fixtureRoot) + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Move target escaped the smoke fixture'
        }
    }
    Move-Item -LiteralPath $first -Destination $moved
    $restarted = Invoke-PackagedApp $moved $smokeProfile $true
    if ($restarted.previousMarker -ne 'persisted') { throw 'Renderer profile did not survive moving the ZIP directory' }
    if (Get-ChildItem -LiteralPath $moved -Filter '*.db' -Recurse -File) { throw 'App wrote a database into its program directory' }
    $checks.Add('Moved ZIP restart: persistent profile outside the application directory')

    Rename-Item -LiteralPath (Join-Path $moved 'resources/provider/vua-orchestrator-provider.exe') -NewName 'provider.saved.exe'
    $failure = Invoke-PackagedApp $moved $failureProfile $false
    if ($failure.error -notlike '*bundled VUA backend is missing*') { throw 'Missing Provider did not produce the expected startup failure' }
    $checks.Add('Missing bundled Provider: nonzero exit and explicit diagnostic, no checkout fallback')
    $summary = @{ status = 'passed'; testedAt = (Get-Date).ToUniversalTime().ToString('o'); version = $version; checks = $checks.ToArray(); zipSha256 = $zipHash; fixtureRoot = $fixtureRoot }
    $summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
    Write-Output "Packaged smoke passed ($($checks.Count) cases). Evidence: $summaryPath"
} catch {
    @{ status = 'failed'; testedAt = (Get-Date).ToUniversalTime().ToString('o'); error = $_.Exception.Message; fixtureRoot = $fixtureRoot; checks = $checks.ToArray() } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
    throw
} finally {
    foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
}
