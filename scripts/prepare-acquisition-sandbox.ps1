# Prepare isolated acceptance inputs. This script does not enable Windows features,
# launch Sandbox, execute vendor installers, or change existing client installations.
[CmdletBinding()]
param([string]$OutputRoot)
$ErrorActionPreference = 'Stop'
$vuaWorkspace = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $vuaWorkspace '_local_real_machine/acquisition-sandbox'
}
$vuaOutput = [IO.Path]::GetFullPath($OutputRoot)
if ((Test-Path -LiteralPath $vuaOutput) -and (Get-ChildItem -LiteralPath $vuaOutput -Force | Select-Object -First 1)) {
    throw 'Choose a new empty output folder; previous acceptance evidence is retained.'
}
New-Item -ItemType Directory -Path $vuaOutput -Force | Out-Null
$vuaBuildConfig = Join-Path $vuaOutput 'build-config.toml'
@'
[target.x86_64-pc-windows-msvc]
rustflags = ["-C", "target-feature=+crt-static"]
'@ | Set-Content -LiteralPath $vuaBuildConfig -Encoding Ascii
Push-Location $vuaWorkspace
try {
    & cargo build --release --locked --target x86_64-pc-windows-msvc --config $vuaBuildConfig -p vua-project-manager --example sandbox-acquisition-smoke
    if ($LASTEXITCODE -ne 0) { throw 'Acceptance executable build failed.' }
    $vuaBundle = Join-Path $vuaOutput 'bundle'
    New-Item -ItemType Directory -Path $vuaBundle | Out-Null
    $vuaExecutable = Join-Path $vuaBundle 'sandbox-acquisition-smoke.exe'
    Copy-Item -LiteralPath (Join-Path $vuaWorkspace 'target/x86_64-pc-windows-msvc/release/examples/sandbox-acquisition-smoke.exe') -Destination $vuaExecutable
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'acquisition-sandbox-guest.ps1') -Destination (Join-Path $vuaBundle 'guest.ps1')
    $vuaSources = @(& git ls-files -- crates Cargo.toml Cargo.lock) + @(
        'crates/project-manager/src/steam_install.rs', 'crates/project-manager/src/pico_install.rs',
        'crates/project-manager/examples/sandbox-acquisition-smoke.rs',
        'scripts/acquisition-sandbox-guest.ps1', 'scripts/prepare-acquisition-sandbox.ps1'
    )
    $vuaIdentities = @($vuaSources | Sort-Object -Unique | ForEach-Object {
        $vuaSource = Join-Path $vuaWorkspace $_
        if (Test-Path -LiteralPath $vuaSource -PathType Leaf) {
            [ordered]@{path=$_; sha256=(Get-FileHash -LiteralPath $vuaSource -Algorithm SHA256).Hash}
        }
    })
    [ordered]@{
        preparedAt=[DateTime]::UtcNow.ToString('o'); commit=(& git rev-parse HEAD).Trim()
        branch=(& git branch --show-current).Trim(); dirtyTree=[bool](& git status --porcelain --untracked-files=normal)
        scope='Steam desktop service installation/handoff; PICO adapter acquisition/installation/reinspection. No play, headset or host UAC acceptance.'
        files=@(
            [ordered]@{path='sandbox-acquisition-smoke.exe'; sha256=(Get-FileHash -LiteralPath $vuaExecutable -Algorithm SHA256).Hash},
            [ordered]@{path='guest.ps1'; sha256=(Get-FileHash -LiteralPath (Join-Path $vuaBundle 'guest.ps1') -Algorithm SHA256).Hash}
        )
        sourceFiles=$vuaIdentities
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $vuaBundle 'manifest.json') -Encoding UTF8
    foreach ($vuaRegion in @('china_mainland', 'other')) {
        $vuaResults = Join-Path $vuaOutput "results-$vuaRegion"
        New-Item -ItemType Directory -Path $vuaResults | Out-Null
        $vuaBundleXml = [Security.SecurityElement]::Escape($vuaBundle)
        $vuaResultsXml = [Security.SecurityElement]::Escape($vuaResults)
        @"
<Configuration>
  <vGPU>Disable</vGPU>
  <Networking>Enable</Networking>
  <AudioInput>Disable</AudioInput>
  <VideoInput>Disable</VideoInput>
  <PrinterRedirection>Disable</PrinterRedirection>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <MemoryInMB>4096</MemoryInMB>
  <MappedFolders>
    <MappedFolder><HostFolder>$vuaBundleXml</HostFolder><SandboxFolder>C:\VUA-Test-Bundle</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$vuaResultsXml</HostFolder><SandboxFolder>C:\VUA-Test-Results</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\VUA-Test-Bundle\guest.ps1 -Region $vuaRegion</Command></LogonCommand>
</Configuration>
"@ | Set-Content -LiteralPath (Join-Path $vuaOutput "$vuaRegion.wsb") -Encoding UTF8
    }
    @'
Prepared acceptance bundle. Do not run the executable on the host.

Enable firmware virtualization and Windows Sandbox separately, with the author's approval.
Open china_mainland.wsb. The guest uses the actual VUA Steam service and PICO adapter;
official installers are downloaded inside the guest, verified and executed there.
No Steam/VRChat account is used. Inspect results-china_mainland/finished.json and events.jsonl.
Close that Sandbox after reviewing output, then open other.wsb for a fresh global baseline.
Sandbox cannot run both configurations at once. Each .wsb launch performs real installations.
Keep the guest open if an installer requires attention; inspect rather than automatically retry.

Only this bundle is mapped read-only. Only the dedicated result directory is mapped writable.
No host client directories, user profile, projects, clipboard, microphone or camera are shared.
The guest is temporary; closing it removes installed clients and guest data. Results persist.
This tests missing clients, installed entry files and Steam's VRChat handoff. It does not
prove host UAC prompts, login/update completion, Steam library games, drivers or headset play.
'@ | Set-Content -LiteralPath (Join-Path $vuaOutput 'README.txt') -Encoding Ascii
    Write-Output "Prepared: $vuaOutput"
} finally { Pop-Location }
