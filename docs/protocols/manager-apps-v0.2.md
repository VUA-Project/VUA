# Manager apps protocol (`v0.2`)

> Contract ID: `manager-apps`
> Version: `0.2`
> Status: Candidate
> Owner: Environment
> Updated: 2026-11-14

## Purpose

`manager-apps` owns VUA's host-level discovery and local breakaway launch handoff for external Unity and VRChat package managers:

- `unity_hub` — Unity Hub (`Unity Hub.exe`)
- `vcc` — VRChat Creator Companion (`CreatorCompanion.exe`)
- `alcom` — ALCOM (`ALCOM.exe` / `vrc-get-gui.exe`, MIT)

`v0.1` (`environment.inspectManagerApps`, `schemas/manager-apps/v0.1/`) remains unchanged as the read-only executable discovery query. `v0.2` adds `environment.openManagerApp` (`schemas/manager-apps/v0.2/`) so players and permissioned MCP agents can open an already-installed local manager directly from VUA without copying paths or opening a download page.

## Hard boundaries

1. **Read-only toward external projects (Ruling U3)**: `environment.openManagerApp` launches the discovered manager executable with **zero** project-path or mutation arguments. VUA never mutates ALCOM/VCC projects, databases, or private caches in place; see [ALCOM/VCC compatibility](../compatibility/alcom-vcc.md).
2. **Server-side executable resolution only**: Callers pass only the closed enum `managerId` (`"unity_hub" | "vcc" | "alcom"`), never a filesystem path. The host re-resolves the executable from its verified registry and standard product directories and checks that the file is a valid Windows PE (`MZ`) binary before spawning.
3. **Detached breakaway isolation**: Launched managers run with sensitive credentials and internal `VUA_*` environment variables stripped (`strip_sensitive_env`), `CREATE_BREAKAWAY_FROM_JOB` on Windows, null standard streams, and the binary's parent directory as working directory so closing or restarting VUA never terminates the external manager.
4. **Bounded idempotency**: Every `environment.openManagerApp` command carries a `commandId` (`1..=128` ASCII `[A-Za-z0-9_.:-]`). Replaying the same `(commandId, managerId)` within the bounded 4,096-entry ledger returns the original receipt without spawning a duplicate window; reusing a `commandId` for a different `managerId` fails with `vua.manager_apps.command_conflict`.

## Operations

### 1. `environment.inspectManagerApps` (`query`, unchanged from `v0.1`)

- Request schema: `schemas/manager-apps/v0.1/request.schema.json`
- Result schema: `schemas/manager-apps/v0.1/result.schema.json` (`schemaVersion: "vua.manager-apps/v0.1"`)

### 2. `environment.openManagerApp` (`command`, added in `v0.2`)

- Request schema: `schemas/manager-apps/v0.2/open-request.schema.json`
  - `kind`: `"command"`
  - `method`: `"environment.openManagerApp"`
  - `commandId`: `string` (`1..=128` `[A-Za-z0-9_.:-]`)
  - `params`: `{ "managerId": "unity_hub" | "vcc" | "alcom" }`
- Result schema: `schemas/manager-apps/v0.2/open-result.schema.json`
  ```json
  {
    "managerAppLaunch": {
      "schemaVersion": "vua.manager-apps/v0.2",
      "managerId": "alcom",
      "launchedAt": "2026-11-14T03:00:00Z"
    }
  }
  ```

## Error codes

| Code | Category | Meaning |
| --- | --- | --- |
| `vua.manager_apps.invalid_params` | `validation` | Malformed envelope, invalid `commandId`, or unknown `managerId` |
| `vua.manager_apps.command_conflict` | `conflict` | `commandId` already recorded for a different `managerId` or ledger full |
| `vua.manager_apps.not_found` | `precondition` | Requested manager executable was not found or failed PE validation |
| `vua.manager_apps.launch_failed` | `external` | OS process creation failed |
| `vua.manager_apps.unavailable` | `unavailable` | Environment host service is not attached |
