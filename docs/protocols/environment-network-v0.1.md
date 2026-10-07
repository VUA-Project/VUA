# Environment network checks v0.1

> Document version: 0.1
> Status: Candidate
> Family: environment-network

An additive query carried by application contract v0.1 and Desktop Gateway v1. It does not
alter the frozen `environment.getSnapshot` TCP facts or deployment v0.1.

## Request and capability

Operation/capability: `environment.checkNetwork`; kind: `query`.
Both boundaries accept exactly `params: { intent: { route, region } }`.

- `route`: `desktop_play` or `pico_pcvr`.
- `region`: `auto`, `china_mainland` or `other`.

No caller URL, host, credentials, command ID or extra property is accepted. Application
envelope fields remain `contractVersion`, `requestId`, `correlationId`, `kind`, `method`, `params`.
Gateway uses its existing `schemaVersion`, `requestId`, `method`, `params` envelope. Empty request
or correlation IDs are invalid. Absent wiring advertises unavailable and returns
`vua.network.unavailable`; malformed params return `vua.network.invalid_intent`. Both use
`errors.network.failed`, with application categories `unavailable` and `validation` respectively.

## Response

Success value contains exactly `{ networkReport }`. The report contains:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Literal `0.1` |
| `intent` | Accepted route/region selection |
| `detectedRegion` | `china_mainland`, `other`, or `unknown`; always unknown for a manual selection |
| `effectiveRegion` | Detected category for auto; otherwise the explicit selection |
| `capturedAt` | UTC RFC3339 observation timestamp |
| `durationMs` | Nonnegative integer total elapsed milliseconds |
| `results` | Exactly one observation per selected target in the order below |

Desktop targets: `steam_store`, `steam_community`, `steam_download`, `vrchat_web`.
PICO appends `pico_connect`. No missing/duplicate/extra/reordered targets are accepted by the
consumer. Observations contain exactly `target`, `status`, `elapsedMs`, `httpStatus`.

| Status | `httpStatus` | Interpretation |
| --- | --- | --- |
| `reachable` | Integer 200–299 | HTTPS request returned success |
| `redirected` | Integer 300–399 | Redirect stopped; open the official page to inspect |
| `http_error` | Integer 400–599 | Server responded; review access or service status |
| `timeout` | null | Request or batch deadline expired |
| `connection_failed` | null | Transport failed; no DNS/TLS/proxy root cause is invented |
| `probe_error` | null | Local client/runtime could not run the check |

`elapsedMs` measures elapsed time to headers/failure, never game ping or throughput. Partial
failure is a successful query containing observations. No aggregate `ready`, automatic
configuration change, account state, public IP, response body or raw error string exists on
this face. The current query is bounded, read-only, explicitly triggered and non-durable.

## Sources and implementation

- [Architecture and user behavior](../architecture/network-onboarding.md)
- [Schema](../../schemas/environment-network/v0.1/network.schema.json),
  [positive/negative vectors](../../schemas/environment-network/v0.1/vectors.json)
- [Rust use case](../../crates/orchestrator/src/network.rs),
  [HTTPS adapter](../../crates/project-manager/src/network_probe.rs),
  [Provider boundary](../../crates/provider-host/src/network_routes.rs)
- [TypeScript types/guards](../../packages/contracts/src/environment-network.ts),
  [consumer test](../../apps/desktop/src/renderer/gateway/live-network-port.test.ts)

## Document changelog

- 0.1 (2026-10-03): introduce first-play HTTPS checks as an additive Candidate family.
