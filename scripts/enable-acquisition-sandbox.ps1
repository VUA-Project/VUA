# Run only after the author approves this host Windows-feature change.
#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$vuaHypervisor = (Get-CimInstance Win32_ComputerSystem).HypervisorPresent
$vuaFirmware = (Get-CimInstance Win32_Processor | Select-Object -First 1).VirtualizationFirmwareEnabled
if (!$vuaHypervisor -and !$vuaFirmware) { throw 'Enable virtualization in BIOS/UEFI first. No Windows feature was changed.' }
$vuaFeature = Enable-WindowsOptionalFeature -Online -FeatureName 'Containers-DisposableClientVM' -All -NoRestart
[pscustomobject]@{feature='Windows Sandbox'; restartNeeded=$vuaFeature.RestartNeeded; automaticRestart=$false} | ConvertTo-Json
