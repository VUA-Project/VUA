# Independent scenario preparation v0.1

> Document version: 0.1.0
> Status: Candidate
> Updated: 2026-10-13
> Owner: Environment

This family separates an SOP, observed software prerequisites, and installation. Its two new
queries use the existing Desktop Gateway/application envelope. Installation retains the separate
[environment-deployment v0.1](environment-deployment-v0.1.md) plan/execute authority. No Frozen
Editor classifier, installer behavior, task lifecycle or production gate is redefined.

| Entry | Input | Performs | Result / next action |
| --- | --- | --- | --- |
| `environment.getScenarioSop` | `schemaVersion: "0.1"`, `scenario: {scenario, connection?}` | Pure static steps; no filesystem, network, installation or Editor execution | `performed: "sop_only"`; the caller may choose to check software |
| `environment.checkScenarioEnvironment` | `schemaVersion: "0.1"`, `intent` | Existing local software observations only | `performed: "software_check_only"`, `installationStarted: false`; follow SOP or separately plan installation |
| `environment.planDeployment` | Existing deployment intent | Observe and build an exact installation plan, including its installation authority/download policy | Separate digest; no execution |
| `environment.executeDeployment` | Existing intent + confirmed digest + command ID | Existing revalidation, idempotency and task execution | Accepted task, then actual task/step facts |

Scenarios are the closed set `desktop_play`, `pico_pcvr`, `pc_avatar`, `quest_avatar`. Optional
`connection` is `usb`/`wifi` and only applies to PICO; omission does not guess a transport. The
SOP includes recovery. A step's `automatic` flag means VUA supplies an operation for that step,
not that reading the SOP starts it. Account sign-in, actual headset streaming and SDK review
still require their real upstream actions.

The software check returns required components once each in lexical order. Missing observation
is `detection_failed`, never a fabricated installation result. `softwareReady` means these files
were observed as usable. `licenseState: "not_checked"` is mandatory: no claim is made about
authentication, Unity activation, tracking, room entry or SDK build results. Installation/file
inspection does not run the Unity Editor; execution/activation rules belong to
[Unity compatibility](../compatibility/unity-editor.md).

SOP is available even without environment services. A well-formed check with absent services
returns `vua.scenario.unavailable`; malformed input is rejected before capability absence. Checks
create no tasks and do not probe the download region or choose an installation authority.

[Schemas and vectors](../../schemas/scenario-environment/v0.1/) are consumed by Rust wire tests
and TypeScript guards. Counterexample tests assert no installer/region call, no created task,
unknown missing facts, C1 observations, and the independent method sequence. This is technical
verification, not N1 hardware/clean-machine acceptance.

## Document changelog

- 0.1.0 (2026-10-13): separate pure SOP and software-only inspection from the retained deployment plan/execute family.
