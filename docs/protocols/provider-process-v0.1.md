# Supervised Provider Process Protocol v0.1


> Document version: 0.3
> Status: Implementation baseline (handshake frame face frozen as machine-readable schema per proposal 001)
> Owner: Electron Kernel and Orchestrator Provider adapters
> Updated: 2026-10-10
> Frame version: `0.1`

## Boundary and artifact

The production hosting shape is an independent Rust executable supervised by Electron Main:
`vua-orchestrator-provider.exe`. Renderer code cannot start or access it directly. Its only startup argument is
`--database <absolute path>`; no shell is used, the working directory is the executable directory, and only
`SystemRoot/WINDIR/TEMP/TMP` are inherited. The development build validates a single-EXE artifact shape. The N7 installer
gate owns release signing, exact dependency inventory, and installer pinning with the release certificate; the
current implementation baseline does not claim that a development binary is signed.

On Windows the Provider joins itself to a Job Object with `KILL_ON_JOB_CLOSE`, so managed descendants are collected
after an abnormal Provider exit. Lifecycle baseline **0.3** adds a host-only `BREAKAWAY_OK` exception:
the fixed [external-tool handoff](external-tool-v0.1.md) explicitly launches Steam with
`CREATE_BREAKAWAY_FROM_JOB`, preserving upstream software after VUA/provider exit. Ordinary workers
still inherit containment; the AMF provider keeps the stricter job without this exception. A failed
external breakaway reports handoff failure and never falls back to contained launch. This changes
the internal host lifecycle baseline, not the frozen handshake/frame `0.1` face. Native synthetic
child-process tests pin both collection and retention; vendor and hardware acceptance remain separate.
An adjacent `.provider.lock` holds an exclusive operating-system file lock for one
database. A second Provider must fail startup rather than create two authoritative writers. The lock file may remain;
authority comes from the live file lock, not file existence.

## Transport and handshake

stdin/stdout carries UTF-8 JSON Lines with a one-MiB maximum per frame. stdout is protocol-only and diagnostics use
stderr; the supervisor retains at most 64 KiB of stderr. Both sides frame `frameVersion: "0.1"`, a nonempty
`frameId`, `kind`, and `payload`. Requests and responses share a frame ID; events have independent IDs. Unknown or
invalid frames are explicitly rejected.

After spawn, the supervisor completes `handshake`, verifies Application Contract `0.1` and supported versions, and
only then admits calls. The handshake frame face (request and response) is authoritatively defined by the two JSON
Schemas in `schemas/orchestrator/provider-frame-v0.1/` (proposal 001); the Rust host and the TS supervisor consume
the same positive and negative vectors. A handshake request `payload` must be `null`; a wrong `frameVersion`, an
empty `frameId`, or a non-null `payload` is explicitly rejected with a `protocol_error` frame. The handshake
response reuses the request `frameId` and its `payload` always carries five fields: `contractVersion`,
`supportedContractVersions`, `providerBuildId`, `providerInstanceId`, and the mandatory boolean capability bit
`downloadIngest` (in-process and supervised-process Providers implementing the same contract must agree). Request
and event payloads follow
[Application Contract v0.1](application-contract-v0.1.md) without exposing private Rust types. Unexpected exit
moves the Provider to `failed` and rejects pending calls. Restart is explicit at the higher layer; there is no
unbounded automatic restart loop.

## Recovery and shutdown

Every start creates a new `providerInstanceId`. Active project leases owned by an older instance are marked
`recovery_required` and are never taken over by elapsed time. Nonterminal tasks retain their last truthful state and
report `inspect_required`.

Shutdown proceeds as follows:

1. The supervisor closes admission and sends `prepare_shutdown` with a positive integer `timeoutMs`.
2. The Provider waits within that bound for project-mutation leases owned by its instance to clear. With no blocker,
   it checkpoints, replies `safe_to_stop`, and exits.
3. At timeout it replies `needs_user_choice` with each blocking task's `taskId/revision/state` and stays alive.
4. Waiting repeats the check with a new timeout. Force requires a nonempty `userDecisionId`.
5. Force first marks current-instance leases as requiring recovery, replies `forced` with affected tasks, then
   checkpoints and exits.

Force therefore never presents unknown project state as success, failure, or immediately retryable work. A later
mutation must Inspect first and explicitly take over at a higher generation.

## Document changelog

- 0.3 (2026-10-10): version the host-only explicit external-app breakaway exception; preserve ordinary-worker/AMF containment and the unchanged frozen handshake/frame face.
- 0.2 erratum (2026-10-02): header `Updated` date corrected — it read 2026-09-07, predating the 0.2 erratum (2026-09-28) this document already carried; no content change.
- 0.2 erratum (2026-09-28): stale lane labels removed — the B10/M10 release-signing sentence now assigns that duty to the N7 installer gate, and the Status header drops the B2 prefix to match the REGISTRY status; protocol version and normative content unchanged.
- 0.2 (2026-09-07): handshake frame face frozen — request/response JSON Schemas and both-side
  positive/negative vectors landed (proposal 001); a handshake request `payload` must be `null`
  (violations get `protocol_error`), and the five-field response (mandatory `downloadIngest`) is the
  only valid shape.
- 0.1 (2026-09-02): initial B2 implementation baseline.
