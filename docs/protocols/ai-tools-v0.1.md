# External Agent tools v0.1

> Document version: 0.19.0
> Status: Candidate
> Updated: 2026-11-14
> Owner: Integration

The built-in MCP adapter belongs to Electron Main. The external Agent supplies conversation,
model selection and suggestions; VUA supplies facts, bounded plans, task dispatch and recovery.
No model service, API key form, VUA harness or automatic plugin loader is introduced. This local
slice does not retrofit historical release artifacts or declare N acceptance.

## Connection and lifetime

The player opens **MCP** in the top bar (the command bar in Frutiger Aero), enables the connection, copies the supplied
prompt (or copies only the `mcpServers` JSON config snippet via `copyConfig`), and pastes it into an AI tool on the same computer that supports local Streamable HTTP.
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
| `vua_play_setups`, `vua_sop`, `vua_check_environment` | Independent [scenario read family](scenario-environment-v0.1.md) and [play-setup catalog/SOP v0.2](scenario-environment-v0.2.md) |
| `vua_unity_license` | Metadata-only [Unity license hints](unity-license-v0.1.md) and historical checks; starts no program |
| `vua_plan_installation`, `vua_request_installation` | Existing digest-bound deployment plan/execute (`purposes` and/or official-installer `tools`) |
| `vua_local_diagnostics`, `vua_diagnose_symptom`, `vua_request_clear_osc_cache`, `vua_request_update_client_config` | Privacy-safe [local diagnostics](local-diagnostics-v0.1.md), symptom-to-SOP checks, and approval-gated offline OSC cache cleanup and `config.json` cache limit updates |
| `vua_play_status`, `vua_request_play` | Existing route observations and card-owned launch/stop; preexisting applications retained |
| `vua_tool_catalog` | Static curated companion-tool metadata (`vua.tool-catalog/v0.1`: goal category, free vs paid Steam pricing, delivery channel, license, official URL, and status-tool mapping); performs no process or network check |
| `vua_tool_status`, `vua_request_tool` | Candidate Steam connections for VRCFaceTracking, OpenVR Space Calibrator, OVR Advanced Settings, OVR Toolkit, OyasumiVR, OVR Overlay Translator, ChilloutVR, Reborn, Desktop+ and fpsVR |
| `vua_installer_tool_status`, `vua_request_installer_tool` | Official-installer companion tools (`installer-tool v0.1`: SlimeVR Server, VRCT, VRCX, VRCS) |
| `vua_manager_apps`, `vua_request_open_manager` | Sanitized local presence and approval-gated zero-argument breakaway launch of external creator managers ([manager-apps v0.2](manager-apps-v0.2.md): `unity_hub`, `vcc`, `alcom`); local filesystem paths are omitted |
| `vua_pose_graph` | Passive read-only [pose and tracking topology](pose-graph-v0.1.md) (`environment.observePoseGraph` `v0.1`: active OpenXR runtime family, external SteamVR OpenVR drivers, FBT/face bridges and Space Calibrator hints) |
| `vua_library`, `vua_material_files`, `vua_glb_inspect`, `vua_request_library_import_groups` | Bounded local AMF/BDL library queries (including `source: "local"`, `format` (`vrm_or_glb` / `unitypackage`), `availabilityStatus`, `sourceCategory`, `descriptionLinksTo`, and `v0.3` `sort`/`vn3` filters), header-only [GLB and VRM metadata inspection](glb-inspection-v0.1.md) (`library.inspectGlb` `v0.1`), and approval-gated grouped migration intake ([library-migration v0.1](library-migration-v0.1.md)); no login/download/upload |
| `vua_terms`, `vua_terms_check` | Recorded [VN3 terms](terms-v0.1.md) of BOOTH products and one use checked across several; local evidence only |
| `vua_recipes`, `vua_recipe` | Saved local Avatar Recipe summaries and full Recipe documents |
| `vua_amf_materials`, `vua_amf_run`, `vua_amf_plan`, `vua_amf_face_tracking_plan`, `vua_amf_texture_plan`, `vua_amf_lighting_plan`, `vua_amf_outfit_removal_plan`, `vua_amf_release` | Candidate material-first read/plan facts, face-tracking patch plans, decoded texture-memory plans, lilToon brightness alignment plans, outfit removal inventories, and a finished Avatar's turntable and uploads |
| `vua_request_amf_prepare`, `vua_request_amf_assemble`, `vua_request_amf_texture_apply`, `vua_request_amf_lighting_apply`, `vua_request_amf_outfit_remove`, `vua_request_amf_reinspect`, `vua_request_amf_close_editor`, `vua_request_amf_open` | Existing [AMF production](amf-production-v0.1.md) authority and Bridge v5, including digest-verified restore-point mutations |
| `vua_request_amf_local_test` | Local Windows PC SDK test of a finished Avatar; ordinary player approval, no upload rights confirmation |
| `vua_request_amf_upload` | [Managed upload](amf-production-v0.1.md#release); confirmed on the release page with the player's rights confirmation |
| `vua_request_cancel_task` | Existing revision-bound cancellation request |
| `vua_action_status` | Local approval receipt; never grants approval |
| `vua_withdraw_request` | Withdraws a request still waiting for the player; nothing runs |

The two Steam tools accept the `toolId` values from `EXTERNAL_TOOL_IDS` in
`packages/contracts/src/external-tool.ts` apart from VRChat and SteamVR, which agents reach through
the play tools; other IDs are rejected by the MCP input schema.
For example, `vua_tool_status {"toolId":"space"}` reads Space Calibrator's installation and
process facts. `vua_request_tool {"toolId":"space","action":"start"}` queues a request for the
player to approve on the Tools page before dispatch. Actions and observed fields follow
[external tool connection v0.4](external-tool-v0.4.md), and a reinstall stays with the player on the
tool's own page. Installation or a running process does
not establish module, hardware, tracking or OSC configuration.

`vua_amf_plan` without a selection plans VUA's [recommendation](amf-production-v0.1.md) and returns
its reasons; when candidates are equally plausible it returns `recommendation_needs_player` with
the candidates, and no plan is made.

### Compact reads and Resources

`vua_tasks` accepts optional `limit` (integer 1–100, default 20) and `state` (a unique array of
`queued`, `preparing`, `running`, `waiting_for_input`, `paused`, `succeeded`,
`succeeded_with_warnings`, `failed`, `cancelled`). An omitted or empty array selects all states.
It returns `{contractVersion, revision, tasks, total, hasMore}` inside `data`. `total` counts
matching tasks before the limit; `hasMore` reports remaining matching history. Tasks are ordered
by `updatedAt`, newest first, with task ID as a stable tie-breaker. Each summary retains identity,
revision, state, cancellation/recovery disposition, update time, error code and the result's
operation/run reference. `vua_task {taskId}` reads the full task and the same derived evidence.

`vua_status` adds `data.build: {version, commit, dirty, builtAt}`. Electron Main uses the same
build-info source as the desktop build; packaged Main embeds that identity at build time, and
the development Main loads the build-info module when starting the adapter.

`vua_library` returns only the first `imageUrls` entry per product, including a local row's
`sourceMatch.product`. `includeImages: true` returns the complete image lists. This option and
the task filters belong to the MCP adapter; the existing Gateway calls retain their parameters.

The server advertises the MCP `resources` capability and these templates:

| URI template | Read through Gateway | Content |
| --- | --- | --- |
| `vua://amf/runs/{runId}` | `amf.production.get` | Complete current run, including its `revision` and any `revisions` |
| `vua://amf/runs/{runId}/release` | `amf.production.releaseState` | Complete current release state |

`resources/templates/list` discovers the templates. `resources/list` reads existing lines from
`amf.production.list`, returning at most 50 lines (100 resources) per page and a `nextCursor`
for the next page. `resources/read {uri}` returns `contents: [{uri, mimeType: "application/json",
text}]`, where `text` is the complete Gateway value serialized as JSON. A run ID contains 1–100
ASCII letters, digits or hyphens; validation precedes Gateway dispatch. Each read observes current
facts. Compare the run's revision between reads to detect intervening work. Resource contents
share the 256 KiB result bound and authenticated local connection with tools. Resource failures
use MCP protocol errors whose `data` carries the error fields below.

`vua_amf_run` returns a summary plus a `resource_link` to its run URI. The summary retains phase,
revision, progress, selection, source names, the latest 20 steps with their total count, recovery
and result-fact counts. Each prefab has only `path`, `name`, `isAvatar` and `humanoidBoneCount`.

### Structured MCP Prompts

The server advertises the MCP `prompts` capability (`prompts/list` and `prompts/get`) with four
parameter-validated workflow templates (`vua-play-setup`, `vua-diagnose-symptom`,
`vua-amf-assembly`, and `vua-release-check`). Prompt arguments are validated against contract enums
and run-ID bounds before returning structured user messages; invalid prompt names or arguments fail
closed with MCP `-32602` (`unsupported_tool_or_parameters`). Prompts never execute tools or approve
mutations on their own.
SDK review retains its state, platform, overall rating, issue counts by level and category
ratings. A run with version records gives the five newest in `revisions` and their number in
`revisionCount`; the run Resource holds them all. Rendered previews follow the
link as before. `vua_amf_release` returns turntable/editor state, the last observed upload
eligibility, the latest three upload and local-test summaries, their respective counts within
the Gateway view, and a link to the release URI. Read the Resource for full checks, bindings,
diagnostics and SDK explanations.

The report-shaped synthetic regression fixtures assert fewer than 10,000 UTF-8 bytes of text
per default `vua_status`, `vua_tasks`, `vua_amf_run` and `vua_library` response. This measurement
includes preview labels and excludes image bytes and the separate structured-content mirror.

### Errors, change evidence and task source

Every tool error has `isError: true`, with the same JSON body in text and `structuredContent`:

| Field | Meaning |
| --- | --- |
| `error` | Stable adapter or Gateway application error code |
| `message` | Gateway `params.detail` when present, otherwise the adapter's plain-language explanation; capped at 512 Unicode characters after removing absolute paths, URLs, credentials and control characters |
| `nextAction` | Action to resolve the error or reread facts |
| `mutationStarted` | `false`: MCP calls read facts or queue player approval |
| `retryable` | Whether the same arguments may succeed after transient contention or connection failure clears |

The adapter owns this conservative retry table:

| Code | `retryable` |
| --- | --- |
| `gateway_unavailable`, `too_many_requests`, `vua.amf_production.busy` | `true` |
| `connection_disabled`, `unsupported_tool_or_parameters`, `approval_not_found`, `approval_not_waiting` | `false` |
| `review_pending_requests_first`, `installation_plan_changed`, `assembly_plan_changed`, `texture_plan_changed`, `lighting_plan_changed`, `outfit_removal_plan_changed`, `material_or_editor_no_longer_available` | `false` |
| `recommendation_needs_player`, `result_too_large`, `request_failed`, `internal`, `invalid_request`, `unsupported_method` | `false` |
| Every other code, including future application codes | `false` |

`vua_task` and `vua_tasks` attach `change` to identified AMF production tasks:

| Field | Evidence |
| --- | --- |
| `started` | `false` while queued; `true` for preparing/running/waiting/paused/success states, or a matching current run task ID; otherwise `null` |
| `committed` | `true` for `succeeded` or `succeeded_with_warnings`; `false` for other known task states; otherwise `null` |
| `checked` | For a successful task matched by the run's current task ID, whether the last recorded step is `inspect` or `reinspect` and succeeded; otherwise `null` |
| `recovery` | For that matching run, `null` maps to `"none"`, `"restored"` to `"restored"`, and `"restore_failed: <code>"` to `"restore_failed"`; absent or unrecognized evidence maps to `null` |
| `retrySafe` | For a failed task, `true` with evidence it is still queued or its change was restored; `false` when started with a known unrecovered result; otherwise `null`. Other known task states return `false` |

Task evidence is joined using completed-task AMF payloads and Editor handoff receipts, approved dispatch receipts, the
production lane and the current run's task ID. A read fetches at most 100 distinct runs.
Unavailable, removed, superseded or out-of-bound run evidence stays unknown. A later task's run
steps or recovery never stand in for an earlier task. `checked` describes the final Unity
inspection step; its SDK findings remain in the run Resource.

Each task also has `requestedBy`: `"ai_request"` for a task actually dispatched by this adapter
after the player confirmed it; `"vua"` for the remaining tasks, including player actions and
workshop automation. The adapter remembers the latest 256 such task IDs in memory. Approval
queueing, rejection and cancellation of an existing task preserve its source. A restart or
eviction returns the conservative `"vua"` attribution until a new confirmed dispatch occurs.

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

A local test request from `vua_request_amf_local_test` carries only the run. It is reviewed and
approved through the ordinary action queue, then dispatches `amf.production.localTest`. It does
not accept an upload name or rights confirmation. The release summary includes the latest three
local tests, their count and timestamped upload eligibility; the full release Resource retains
the Provider response. A successful local build is not confirmation that the player wore it in VRChat.

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

The Candidate control face also offers optional `clear(ids)`. Only verified local Main-window
IPC can call it; MCP callers cannot clear or confirm requests. The renderer sends the exact
displayed IDs (at most 32), so a new arrival during **Clear all** remains visible. Clearing a
pending request records a rejection without dispatching it. Clearing a running or decided
request hides its card without cancelling work. Main persists the hidden flag alongside its
bounded receipt; `vua_action_status` still returns the decision or result after clearing and
after a restart, subject to the existing receipt retention limit. The snapshot, notifications
and workflow pages omit hidden cards. The MCP page supplies per-request **Clear** and **Clear all**
controls, with an inline explanation of pending and running behavior.

Verification uses the official SDK HTTP client for initialization, tool discovery, real calls,
pending deduplication, local-only approval, stale plans, backend rejection, pairing/Origin/Host
refusal, body limits, expiration and shutdown. These checks are synthetic execution evidence;
actual supported AI applications and licensed real-material Unity work require separate acceptance.
The real isolated host check observed this workstation's installed C1 without any Editor launch
or installation task. The bundled-MCP check forbids external module loads and checks older HTTP
clients, guarding against Node/browser dependency-resolution differences in the shipping bundle.

## Recipe material reads

`vua_recipe_materials(recipeId, materialChoices?)` reads the full local material checklist before
preparation. `vua_recipe_apply_plan(runId, recipeId, avatarGlobalObjectId?, materialChoices?)`
returns the same checklist and observed `recipeDifferences`. `vua_amf_plan` preserves the prepared
Recipe selection and returns its checklist and differences, rather than recommending replacement
prefabs when a Recipe target is missing. The Agent explains all purchase/download/choice needs
and every difference before requesting a change. `vua_request_amf_assemble` accepts optional
`recipeDifferencesConfirmed: true`, required by AMF when the exact digest-bound difference list is
nonempty. The ordinary player approval remains required; a read never approves or downloads.
The [Recipe v0.5 contract](amf-recipe-v0.5.md) owns statuses, match rules and difference shapes.

## Document changelog

- 0.19.0 (2026-11-14): advertise MCP `prompts` (`prompts/list` and `prompts/get` for `vua-play-setup`, `vua-diagnose-symptom`, `vua-amf-assembly`, and `vua-release-check`), add `format` (`vrm_or_glb`, `unitypackage`) filtering on `vua_library`, and add standalone `mcpServers` JSON clipboard copy (`copyConfig`).
- 0.18.0 (2026-11-14): add `vua_tool_catalog` (`vua.tool-catalog/v0.1`), `vua_request_update_client_config` (`diagnostics.updateClientConfig`), `vua_request_library_import_groups` (`library-migration v0.1`), `vua_library` `source: "local"`/`availabilityStatus`/`sourceCategory`/`descriptionLinksTo` filters, and digest-bound AMF post-assembly plan/apply tools (`vua_amf_texture_plan`, `vua_request_amf_texture_apply`, `vua_amf_lighting_plan`, `vua_request_amf_lighting_apply`, `vua_amf_outfit_removal_plan`, `vua_request_amf_outfit_remove`).
- 0.17.0 (2026-11-14): add `vua_pose_graph` (`pose-graph v0.1`) and `vua_glb_inspect` (`glb-inspection v0.1`).
- 0.16.1 (2026-11-14): add `vua_manager_apps` sanitized output and `vua_request_open_manager` (`manager-apps v0.2`).
- 0.16.0 (2026-11-14): add `vua_local_diagnostics`, `vua_diagnose_symptom`, `vua_request_clear_osc_cache` (`local-diagnostics v0.1`), `vua_installer_tool_status`, `vua_request_installer_tool` and `ToolDeploymentIntent` (`installer-tool v0.1` / `environment-deployment v0.1`), `vua_recipes`, `vua_recipe`, `vua_amf_face_tracking_plan`, `vua_library` `v0.3` `sort`/`vn3` filters, and compact `optimizer`/`faceTracking`/`parameterBudget` fields in `vua_amf_run`.
- 0.15.0 (2026-11-12): add Desktop+ and fpsVR to the Steam tools (`external-tool v0.4`).
- 0.14.0 (2026-11-11): add `vua_play_setups` (`environment.listPlaySetups` `v0.2`) and `vua_sop` `selection` (`environment.getScenarioSop` `v0.2`) while keeping `v0.1` scenario SOP queries intact.
- 0.13.0 (2026-11-08): request approved local Avatar tests and read bounded test summaries and upload eligibility.
- 0.12.0 (2026-11-06): add ChilloutVR and Reborn to the Steam tools; VRChat and SteamVR stay with the play tools, and a reinstall stays with the player.
- 0.10.1 (2026-10-31): the connection page opens from its own top-bar button instead of Help.
- 0.10.0 (2026-10-29): expose all six connected Steam tools through contract-derived MCP tool IDs, retaining player approval on the Tools page and installation/process-only observations.
- 0.9.0 (2026-10-24): expose complete Recipe material checklists and reviewed mapping differences.

- 0.8.0 (2026-10-20): add bounded task summaries and filters, full run/release Resources, compact AMF/library reads, build identity, sanitized error envelopes, AMF change evidence and approved-request task attribution.
- 0.7.0 (2026-10-19): read recorded VN3 terms through `vua_terms` and check one use across several products through `vua_terms_check`.
- 0.6.0 (2026-10-19): expose metadata-only Unity license hints and historical check evidence through `vua_unity_license`.
- 0.5.0 (2026-10-18): `vua_amf_plan` without a selection plans VUA's recommendation or returns the tied candidates.
- 0.4.0 (2026-10-17): read a finished Avatar's release state with `vua_amf_release`, and request a managed upload with `vua_request_amf_upload`, confirmed on the release page with the player's rights confirmation.
- 0.3.0 (2026-10-17): report the running AMF step, its Unity stage and elapsed and usual seconds through `vua_amf_run`.
- 0.2.0 (2026-10-16): return AMF result and candidate previews as image content from `vua_amf_run`.
- 0.1.0 (2026-10-13): add authenticated local MCP over the existing host/AMF execution authorities with explicit player approval.
