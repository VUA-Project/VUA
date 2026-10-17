# External Agent tools v0.1

> Document version: 0.4.0
> Status: Candidate
> Updated: 2026-10-17
> Owner: Integration

The built-in MCP adapter belongs to Electron Main. The external Agent supplies conversation,
model selection and suggestions; VUA supplies facts, bounded plans, task dispatch and recovery.
No model service, API key form, VUA harness or automatic plugin loader is introduced. This local
slice does not retrofit historical release artifacts or declare N acceptance.

## Connection and lifetime

The player opens **Help → Connect external AI tools**, enables the connection, copies the supplied
prompt, and pastes it into an AI tool on the same computer that supports local Streamable HTTP.
VUA remains open. The prompt explains host/AMF functions, the actual URL and Authorization header,
available tools, novice explanation guidance and the optional
[Unity-Skills](https://github.com/Besty0728/Unity-Skills) REST/Skills companion. That companion is
not installed, integrated or assumed to be an MCP server. It and VUA's Bridge must not write the
same project concurrently.

Main binds `127.0.0.1:32179/mcp`, trying at most seven subsequent ports if occupied. The displayed
URL is the bound port, not a promised fixed address. MCP initialization/version negotiation and
HTTP/session handling use the official TypeScript SDK. The session-based transport uses the
compatible initialize handshake; bundled checks cover MCP `2025-11-25` and `2025-06-18`. It does
not claim the SDK's separate 2026 per-request transport. Every request needs the per-installation
Bearer pairing token. Host/Origin must match the actual loopback endpoint; no permissive CORS or
remote bind is provided. Bodies/results, clients, concurrent calls, and approval history are
bounded. Idle sessions close, and disabling/exiting closes connections. Already dispatched tasks
continue under their normal authority; disabling the adapter is not a task-cancellation claim.

The enable choice and token are local. Electron `safeStorage` encrypts the token; no plaintext
storage fallback exists. Without OS encryption the current launch can connect, but its pairing
does not persist. Only the verified Main frame can read/copy the token or resolve an approval.
Embedded websites, guide windows and MCP clients cannot. Snapshots/logs omit the token. Copying
the prompt deliberately gives this MCP pairing token to the player's chosen AI; it does not give
BOOTH/Steam/Unity passwords, cookies, OAuth sessions or asset bytes.

## Tool catalog and execution

`tools/list` supplies the fixed JSON Schemas in `ai-tool-catalog.ts`. Input validation precedes
Gateway dispatch; a client cannot provide a Gateway method, shell string or arbitrary script.

| Tools | Authority |
| --- | --- |
| `vua_status`, `vua_tasks`, `vua_task` | Current capabilities/task facts |
| `vua_sop`, `vua_check_environment` | Independent [scenario read family](scenario-environment-v0.1.md) |
| `vua_plan_installation`, `vua_request_installation` | Existing digest-bound deployment plan/execute |
| `vua_play_status`, `vua_request_play` | Existing route observations and card-owned launch/stop; preexisting applications retained |
| `vua_tool_status`, `vua_request_tool` | Candidate VRCFT connection; no invented hardware/module acceptance |
| `vua_library`, `vua_material_files` | Bounded existing local AMF/BDL library queries; no login/download/upload |
| `vua_amf_materials`, `vua_amf_run`, `vua_amf_plan`, `vua_amf_release` | Candidate material-first read/plan facts and a finished Avatar's turntable and uploads |
| `vua_request_amf_prepare`, `vua_request_amf_assemble`, `vua_request_amf_reinspect`, `vua_request_amf_open` | Existing [AMF production](amf-production-v0.1.md) authority and Bridge v5 |
| `vua_request_amf_upload` | [Managed upload](amf-production-v0.1.md#release); confirmed on the release page with the player's rights confirmation |
| `vua_request_cancel_task` | Existing revision-bound cancellation request |
| `vua_action_status` | Local approval receipt; never grants approval |
| `vua_withdraw_request` | Withdraws a request still waiting for the player; nothing runs |

Read-only tools run immediately. Each `vua_request_*` queues an immutable concrete draft in VUA.
Installation and assembly drafts re-read their plan before being offered; digest drift rejects
the proposal. The player sees the actual software/materials/targets and expected consequence.
Only their **Confirm this action** dispatches the original typed request; the backend revalidates
readiness, input identity/digest, command idempotency and project constraints. Repeated identical
pending proposals reuse a receipt. Declined and withdrawn proposals cannot run. AMF calls
remain unavailable when AMF is disabled; no Agent call enables a module implicitly.

Receipts distinguish `pending`, `running` (dispatching), `accepted` (dispatched), `rejected`,
`withdrawn`, `failed`. A request waits until the player decides or the Agent withdraws it, also
across VUA restarts: VUA keeps the receipts in its data folder. Turning the connection off
withdraws waiting requests; one that was dispatching when VUA closed restarts as `failed`
(`interrupted`). Safety comes from revalidation at confirmation, so a request confirmed after the
project or environment changed fails with the backend's code (for example
`vua.amf_production.project_drift`, `vua.deployment.plan_changed`), which VUA explains to the
player. At most four requests wait at once. Acceptance is not completion: the caller reads
the returned task or observes play/tool state. Tool responses contain `whatHappened`, `nextAction`,
`expectedResult` and bounded `data`, or a specific failure and recovery action. Private project
paths/material names can be necessary references for the selected local task; no material bytes,
credentials, raw logs or automatic screenshots are exposed. Responses and material descriptions
are data, not instructions or authority to widen the catalog.

`vua_amf_run` follows its facts with the run's rendered [AMF previews](amf-production-v0.1.md#previews)
as MCP image content, as the author approved on 2026-10-16: the assembled Avatar from the front,
side and back, then each candidate prefab, every image after a text line naming it. A response
carries up to 24 images and 6 MiB of image data. The Agent checks a result from these images
before asking the player. While a step runs, `vua_amf_run` data carries its
[progress](amf-production-v0.1.md#progress-stop-and-continue): the step, its elapsed and usual
seconds and, inside Unity, the Unity stage, imported count and last log activity.

An upload request from `vua_request_amf_upload` carries only the run. Its confirmation is the
release page's upload dialog: the player names a new Avatar and confirms the content rights
statement, and only that confirmation completes and dispatches `amf.production.upload`. The
generic **Confirm this action** cannot dispatch it, and an Agent cannot supply the confirmation.

## Desktop control face

`VuaDesktopApiV4.aiTools` is an optional additive Candidate control face. `snapshot`, `setEnabled`,
`prompt`, `copyPrompt`, `resolve` and `subscribe` are available through the typed renderer Gateway.
`resolve` takes the player's upload confirmation `{avatarName, rightsConfirmed: true}` as a third
argument for `vua_request_amf_upload` and refuses it for every other request.
Its state/version is `0.1`; prior V1–V3 browser/window/distribution behavior remains intact.
The prompt token is intentionally absent from `AiToolsSnapshotV01` and approval history.

Verification uses the official SDK HTTP client for initialization, tool discovery, real calls,
pending deduplication, local-only approval, stale plans, backend rejection, pairing/Origin/Host
refusal, body limits, expiration and shutdown. These checks are synthetic execution evidence;
actual supported AI applications and licensed real-material Unity work require separate acceptance.
The real isolated host check observed this workstation's installed C1 without any Editor launch
or installation task. The bundled-MCP check forbids external module loads and checks older HTTP
clients, guarding against Node/browser dependency-resolution differences in the shipping bundle.

## Document changelog

- 0.4.0 (2026-10-17): read a finished Avatar's release state with `vua_amf_release`, and request a managed upload with `vua_request_amf_upload`, confirmed on the release page with the player's rights confirmation.3.0 of the parallel progress-and-stop change.
- 0.3.0 (2026-10-17): report the running AMF step, its Unity stage and elapsed and usual seconds through `vua_amf_run`.
- 0.2.0 (2026-10-16): return AMF result and candidate previews as image content from `vua_amf_run`.
- 0.1.0 (2026-10-13): add authenticated local MCP over the existing host/AMF execution authorities with explicit player approval.
