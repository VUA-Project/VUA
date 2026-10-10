# Desktop resource usage v0.2

> Document version: 1.0.0
> Status: Candidate
> Scope: Read-only local Main/preload resource snapshot; independent of Provider RPC
> Updated: 2026-10-10

`DesktopSystemApiV2.readResourceUsageV2()` uses the local-only
`vua:system:resource-usage-v2` IPC. Main applies the same local sender check as the
retained V1 port. V1's method and six-field shape remain available unchanged.

`SystemResourceUsageV2` has `schemaVersion: 2`, the retained RAM/VRAM byte fields and
`sampledAt`, plus nullable `cpuUsagePercent`, `gpuUsagePercent`, `gpuName` and `gpuKind`
(`discrete`, `integrated`, `unknown`, or null). Percentages are finite 0–100 observations.
Unavailable, unsupported, invalid or stale readings are null, never guessed zeroes.
The timestamp is not displayed in the panel.

## Observation and selection

Main launches one Windows read-only helper through the bundled host executable's
`--observe-system-resources` mode. It starts no task database, migration or AMF services.
Native PDH queries use language-neutral counter paths and two-second intervals. CPU uses
`Processor Information(_Total)` across logical processors and processor groups; sockets
are not averaged as separate equally sized CPUs. GPU engine samples are grouped by
adapter LUID, physical node and engine, summed across processes for that engine, then
represented by its busiest engine. PID and raw counter names never reach the renderer.

DXGI supplies hardware identity/capacity. Software/remote adapters are excluded; D3D12's
UMA flag distinguishes shared integrated graphics without brand-name or capacity guesses.
When discrete cards exist, select the busiest measured discrete card, with VRAM pressure
and identity as tie breakers. Otherwise select one available hardware card. Never average
idle adapters. GPU utilization and VRAM usage/capacity all come from that same card/node.
UMA memory is not reported as discrete VRAM or counted again against RAM. An unclassified
or linked-node capacity remains unavailable rather than borrowing another adapter's size.
Selected hardware name/type appears in details; this is a resource overview, not a claim
to identify the GPU used by a particular game.

Main expires the helper sample after six seconds, drops it on failure, retries a closed
helper after thirty seconds, and closes the helper on app exit. RAM remains a current OS
read. Browser-only development does not fabricate a system host.

## Presentation

The compact label is **resource headroom**, not remaining computing performance:
`100 − mean(available CPU %, GPU %, RAM %, VRAM %)`. Unknown dimensions are excluded and
the available count is exposed in the accessible description and details. Any dimension
at 90% or more has an independent compact indication and highlighted meter, so a healthy
mean cannot conceal saturation. Details show four named rows, nullable sensors, the
selected GPU and observed memory capacities. This mean does not forecast FPS or task speed.

Model/collector tests cover missing readings, saturation, split/invalid frames, stale
samples, shared memory, multiple synthetic GPUs and restart/stop. Native UI checks verify
the local port and presentation. Multiple physical GPUs/CPU sockets, linked nodes and
driver-specific behavior require separate hardware evidence; unit fixtures do not replace it.
No standalone schema/vector suite has frozen this desktop-only face.

Sources: [Microsoft GPU aggregation explanation](https://devblogs.microsoft.com/directx/gpus-in-the-task-manager/),
[language-neutral PDH counters](https://learn.microsoft.com/en-us/windows/win32/api/pdh/nf-pdh-pdhaddenglishcounterw),
[D3D12 architecture/UMA](https://learn.microsoft.com/en-us/windows/win32/api/d3d12/ns-d3d12-d3d12_feature_data_architecture).

## Document changelog

- 1.0.0 (2026-10-10): add the V2 utilization snapshot, one-card memory pairing, conservative fallback/freshness and the qualified resource-headroom summary while retaining V1.
