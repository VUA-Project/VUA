# AMF material-first production v0.1

> Document version: 0.13.0
> Status: Candidate
> Updated: 2026-10-18
> Owner: AMF

This face implements the first N3 production path. Users select local library inputs before a
project is prepared. AMF creates an independent managed work project; no external project is
modified. It uses real SDK/MA packages and Unity-observed prefab candidates. The host owns module
lifecycle and tasks, not material roles or assembly semantics. It does not replace frozen
`production.*`, Recipe, plan/job, or Bridge v1-v4 faces.

## Methods

All params have `schemaVersion: "0.1"`. Unknown keys are rejected.

| Method | Kind | Additional params | Result |
| --- | --- | --- | --- |
| `amf.production.list` | Query | none | Local UnityPackage source identities, detected admitted Editors, and retained run summaries |
| `amf.production.get` | Query | `runId` | Run facts, actual candidates, timed steps, checks, recovery state, usual step durations and the running step's progress |
| `amf.production.prepare` | Command | `sources: [{sourceId, role}]`, `editorPath` | Durable `taskId`, `runId` acceptance |
| `amf.production.plan` | Query | `runId`, `selection` | Exact digest-bound selection and effective input roles |
| `amf.production.assemble` | Command | `runId`, `planDigest`, `selection` | Durable task acceptance |
| `amf.production.reinspect` | Command | `runId` | Durable task acceptance; continues a stopped run; never automatically resumes an interrupted assembly |
| `amf.production.rollbackPlan` | Query | `runId` | Digest-bound restore point, current drift notice and current-state preservation promise |
| `amf.production.rollback` | Command | `runId`, `planDigest` | Durable task acceptance; protect current state, restore, then inspect in Unity |
| `amf.production.open` | Command | `runId` | Durable task acceptance; open project, select result and request official SDK panel |
| `amf.production.listRecipes` | Query | none | Retained local Recipe names and revisions |
| `amf.production.getRecipe` | Query | `recipeId` | Validated saved Recipe document |
| `amf.production.saveRecipe` | Command | `runId`, `title` | Save a new Recipe from current verified scene facts |
| `amf.production.prepareRecipe` | Command | `recipeId`, `editorPath` | Durable preparation task using resolved original inputs and pinned dependencies |
| `amf.production.recipeSharePlan` | Query | `recipeId` | Digest-bound referenced-material source choices and unresolved candidates |
| `amf.production.exportRecipe` | Command | `recipeId`, `planDigest`, `sources` | Closed share declaration, paste text and JSON; remember explicit source choices |
| `amf.production.previewRecipeShare` | Query | `text` | Validated received declaration, without saving or execution |
| `amf.production.importRecipe` | Command | `text` | Idempotently saved local received Recipe |
| `amf.production.recipeApplyPlan` | Query | `runId`, `recipeId`, optional `avatarGlobalObjectId` | Observed differences, retained outfits, selectable owned Avatars, target identity and digest |
| `amf.production.applyRecipe` | Command | `runId`, `recipeId`, `planDigest`, `choice`, optional `avatarGlobalObjectId` | Durable overlay or same-project new-Avatar task |
| `amf.production.previewImage` | Query | `runId`, `path` | One preview PNG that the run reports, as `mediaType: "image/png"` and base64 `data` |
| `amf.production.releaseState` | Query | `runId` | The run's turntable (`frames`, `size`, `bakedAt`, `current`), its last 10 uploads newest first and `editorOpen` |
| `amf.production.turntableFrame` | Query | `runId`, `index` (0–59) | One turntable frame as `mediaType: "image/png"` and base64 `data` |
| `amf.production.bakeTurntable` | Command | `runId` | Durable task baking the 60-frame turntable of the finished Avatar |
| `amf.production.upload` | Command | `runId`, `avatarName`, `rightsConfirmed: true` | Durable task building and uploading the finished Avatar with the VRChat SDK |

Roles: `auto`, `avatar`, `outfit`, `dependency`. The player path starts with `auto` sources.
Unity discovers actual prefabs; a unique Avatar/outfit candidate is preselected, while ambiguity
or a static attachment target requires a choice. Assembly requires an observed Avatar and at
least one outfit. Unselected automatic inputs are explicitly shown as `import_only`, not silently
claimed as assembled dependencies. Source IDs resolve only through the module's present local
library; no renderer-provided source or project paths are accepted. Editor paths are reverified
against executable identity: only full `2022.3.22f1` or `2022.3.22f1c1` is admitted.

`selection` contains `avatarPrefab` (asset path) and `outfits` with `sourceId`, `prefabPath`,
`mode` (`merge_armature` or `attach_to_bone`), `bone`, `toggleName`, and `active`. Every chosen
prefab must occur in the run's observed candidates for that source. Bone attachment uses an
observed humanoid bone name, not an arbitrary hierarchy guess. Empty `toggleName` preserves the
material's own menu without adding a new toggle.

Direct UnityPackages and safe UnityPackage members of local ZIP files are selectable without
changing the library originals. Import preflight rejects differing content at a shared path,
inconsistent GUID metadata, file/directory conflicts and Windows case collisions before copying.
Malformed unrelated ZIP files are not offered as package sources.

The plan digest binds the observation revision, candidates, chosen inputs, Editor, project
fingerprints and selection. Reinspection invalidates every earlier confirmation.
Reinspection also reads saved scene ownership and actual object, binding and switch state.
When those relationships are verifiable, editing starts from `facts.observedSelection`, including
supported changes made in Unity. The retained requested `selection` is not proof of current scene
state. Changed or missing relationships are shown before another assembly is reviewed.
Confirmation never survives drift. Preparation may download declared SDK/MA packages into an
isolated package environment and import the chosen files only into the managed work project.
Unknown extra dependencies are reported, not guessed or automatically repaired.

## Applying to a retained Avatar

`recipeApplyPlan` compares a saved declaration with a verified owned Avatar in a managed run.
Omitting the target selects the active Avatar; an explicit identity must resolve to exactly one
observed owned object. Display names never identify a target. Changing the selection recomputes
the comparison before execution, and the execution request retains that identity.
The exact Editor, package versions, prepared content hashes and prefab identities must match;
missing inputs and object ambiguity are distinct from value conflicts. No files or run state change
during comparison. The digest binds the Recipe revision, observations, current project and all
comparison facts. `applyRecipe` accepts `recipe_wins`, `avatar_wins` or `new_avatar`; cancellation
closes the review without an execution request.

An overlay retains outfits absent from the declaration. Conflicting supported values either use
the Recipe or retain the current observation. An empty switch name does not delete an owned
switch. Different prefab identities are not resolved by value priority. A new Avatar is instantiated
in the same managed Unity scene with independent ownership keys; previous Avatars remain intact.
All choices use the protected assembly transaction and verify the actual target and effective
settings before reporting success. Repeated overlays reuse the same object identities. Unchanged
and unmentioned outfits are not reconfigured. Continued ordinary editing also binds the active
object and changes only selected settings; it does not require outfits used only by other Avatars.
Omission of an existing outfit or clearing an existing switch is not an implicit removal.

This Candidate currently compares owned managed Avatars and already prepared inputs. Adding
new input packages to a retained project, selecting unowned scene targets, explicit removal,
and external-project intake remain separate work. Old development work projects need the updated
Candidate Bridge and reinspection before this new capability can be used.

## Project fingerprints

The run record's project fingerprint covers `Assets`, `Packages` and `ProjectSettings`
of the managed work project; symbolic links are refused. AMF computes it with the
cached v2 algorithm: each file's SHA-256 is remembered by path, size and modification
time to the nanosecond, so only files that changed are read again. The total combines
each file's sorted path, length and content hash and carries the prefix
`vua-project-tree-v2:`. Values written before the cache carry the prefix `sha256:`
(the uncached v1 algorithm, which other flows still use unchanged).

The cache lives in `.vua/fingerprint-cache.json` inside the work project, outside the
fingerprinted scopes. It names its `version`, is written atomically (`.pending`, then
rename) and bounded in size; a missing, damaged, future-version or oversized cache
counts as no cache. The cache decides only whether a file's bytes are read again: a file
is re-read when its size or modification time differs from its cached entry, and every
write moves the modification time on NTFS, where work projects live. An added, deleted or
renamed file always moves the value.

A run record that still carries a v1 value is compared by computing v1 once for that
comparison; an unchanged project is never reported as changed because the algorithm
moved on. Once the record matches, saving a Recipe, assembly and the next check rewrite it
with the v2 value; until then the turntable and upload checks repeat the v1 comparison.

## Facts and recovery

Run phases: `preparing`, `inspecting`, `ready`, `assembling`, `restoring`, `succeeded`, `failed`,
`cancelled`, `stopped`, `inspect_required`. Steps have stable keys, readable input names, actual
outcomes and their times. Persisted nonterminal work becomes `inspect_required` after restart;
reinspection or a new preparation is an explicit action. [Stop](#progress-stop-and-continue) ends
a running Unity batch run at once; other work stops at the next step boundary.

Before assembly, the managed project is snapshotted and the exact confirmation/input facts are
rechecked. Failures retain sources and records, report restoration separately, and do not delete
the player's materials. A successful receipt must report actual Avatar/MA/menu relationships.
The retained result records the input hashes, exact Editor and installed VPM versions, snapshot
identity, actual instance targets and per-step state. SDK descriptor recognition is an observation;
official SDK build/upload checks remain `not_run` until actually performed. No upload is automated.

A retained `snapshotId` also enables user-requested restoration. The review digest binds the
run, observation revision, Editor, managed project, restore point and the **current** project
fingerprint. If external edits exist, the review reports `currentChanged`; no current edit is
discarded silently. Execution refuses a stale review. It snapshots the current project and
persists that recovery identity before restoring the reviewed state. Actual Unity inspection
must succeed before the run becomes `ready`; partial restore, cancellation or failed inspection
attempts recovery to the protected current state and reports its outcome separately. The
protected state remains the next restore point, making restoration itself reversible. Interrupted
restoration requires explicit reinspection. Original library inputs are never restoration targets.

## Progress, stop and continue

Step keys are `project`, `materials`, `inspect`, `reinspect`, `snapshot`, `assembly`,
`protect_current` and `restore`. Each step records `startedAt` and `endedAt` as UTC RFC 3339
times; records written before step times carry `null`. Step states are `running`, `succeeded`,
`failed` and `stopped`. `amf.production.get` shows the unfinished step of work whose task no
longer runs as `interrupted`, next to the run phase `inspect_required`.

`amf.production.get` also reports `usualDurations`: for each step key, the median in whole
seconds of the succeeded steps of the 30 most recent runs on this computer. `progress` is `null`
unless a task works on the run (`preparing`, `inspecting`, `assembling`, `restoring`); then it
names the running `step` with its `name`, `startedAt`, `elapsedSeconds`, `usualSeconds` (`null`
before a step of that kind has finished here) and, during a Unity batch run, `unity`.

Task progress events of an `amf.production` task carry `operation: "amf.production"`, `runId`,
`step`, `name`, `startedAt` and, during a Unity batch run, `unity`. During `materials`, `name` is
the material being imported. `step: "open"` marks the Editor opening for the SDK handoff; the
Editor shows its own progress window there.

`unity` comes from the batch run's own log `.vua/logs/<commandId>.log`, read every half second.
`stage` is one of `starting`, `license`, `packages`, `importing`, `compiling`, `bridge`,
`previews`, `finishing` and `fingerprint`, from Unity's own messages, the [Bridge v5](unity-bridge-v5.md) stage
lines, the preview folder and the result file. The last one is VUA's own: after the
Editor exits, `fingerprint` names the [project-file check](#project-fingerprints)
while it reads the work project. Stages move forward; importing and compiling
alternate. While importing, `current` counts the work-project assets Unity has started to import,
and during the first preparation `total` is the number of material files and their folders.
`lastActivityAt` is when the log last grew, or when Unity started until it writes. A page says
Unity has been quiet since that time after two minutes without growth. An event goes out when the
stage changes, when the count moves (at most once a second) and when the activity time moves (at
most every 15 seconds). Events and `get` carry stages, counts and times; log text and paths stay
in the log. The [progress](../../schemas/amf-production-flow/v0.1/progress.schema.json) and
[status](../../schemas/amf-production-flow/v0.1/status.schema.json) schemas carry the vectors.

Stop is task cancellation through `task.requestCancellation`. During a Unity batch run, VUA ends
Unity's whole process tree through its Windows job object within half a second. The work
project, its imported materials and the log stay. A stopped assembly or restoration recovers the
protected project state, as a failure does. The run becomes `stopped` once its materials are in
the work project, otherwise `cancelled`, which a new preparation follows. Continue is
`amf.production.reinspect`: the run is `inspecting` while Unity reinspects the retained project,
preparing its work scene when the stopped run had none, and `ready` afterwards. Confirmations
from before the stop are invalid. Unity's batch mode has no pause, so Stop and Continue serve as
pause, as the author approved on 2026-10-17. Before and after each batch run, VUA removes a
`Temp/UnityLockfile` that no Editor holds, so the next run and the SDK handoff find the project
closed.

## Previews

Every inspection and assembly reports what the Bridge rendered. `facts.previews` lists the active
owned Avatar from the `front`, `side` and `back`, and after inspection each candidate in `prefabs`
carries a `preview`. Each value is a work-project-relative path of the form
`.vua/previews/<commandId>/<name>.png`. Each path names the folder of the command that reported
it, and its resolved location stays inside the work project; a receipt with any other path is
invalid. An image that is missing, not a regular file or larger than 640 KiB is left out of the
facts with the warning `amf.preview.failed`. Before the next Unity run, preview folders that the
run no longer reports are removed.

`amf.production.previewImage` returns one of the paths the run currently reports, after the same
checks and a PNG signature check. The Avatar page shows the three views with the result and a
picture per candidate while choosing prefabs; the [AI tools](ai-tools-v0.1.md) return them as
image content. A preview is a visual aid for the player and the agent; the observed facts above
remain the record of what was assembled.

## Release

A finished run (`succeeded`) leaves the factory through the release room. Its record lives beside
the run in `releases/<runId>.json`; the run's phase and result stay as assembly left them. Both
release commands share the production busy state, add a `turntable` or `upload` step to the
run while they work, and end that step as `succeeded` or `failed` with the reason in its detail.

`amf.production.bakeTurntable` runs [Bridge v5](unity-bridge-v5.md#turntable) `amf_turntable`
for a finished run whose work project Unity does not hold and whose fingerprint matches the run's
last check (`project_open` and `project_drift` otherwise). The turntable is recorded with the
Unity scene fingerprint it shows; `releaseState` reports it as `current` while the run's scene
fingerprint is the same. `amf.production.turntableFrame` serves only the recorded command's
frames, after the containment, size and PNG checks of previews.

`amf.production.upload` requires `rightsConfirmed: true`: the player confirmed the content rights
statement in VUA for this upload. `avatarName` (trimmed, 1–64 characters) names a new VRChat
Avatar; an Avatar already on VRChat keeps its name. With Unity closed, the project must match the
run's last check; with Unity open, the SDK uploads the scene as it is there. The task hands the
upload to the [open Editor](unity-bridge-v5.md#managed-upload-in-the-open-editor), records each
upload's `stage`, upload `progress` and SDK `status` while it runs, and ends with `state`
`succeeded` and the VRChat `blueprintId` (`avtr_<uuid>`), or `failed`/`cancelled` with a
`reason`, the SDK's `detail` and its validation `errors`. Each upload record also names
`sdkSignIn` — `vua_session` when the SDK panel started signed in from the player's experimental
[VRChat session in VUA](vrchat-session-v0.1.md), `panel` when the sign-in happened inside the
panel; older records carry nothing. Task cancellation stops the upload. An
upload still marked running when a new one starts ended with VUA and reads `interrupted`. The
VRChat sign-in and the SDK's own ownership agreement stay inside the SDK; VUA reports only
`sdkSignedIn` from its facts. An AI Agent requests an upload as a pending request that the player
approves on the release page with the same rights confirmation (see [AI tools](ai-tools-v0.1.md)).
The release page shows the SDK's own checks of the finished Avatar from the run facts
(`sdkReview`, read by [Bridge v5](unity-bridge-v5.md) during inspection and assembly): the
performance rank for the build target, the items the SDK refuses an upload with, its reminders,
and the categories rated below Good. The upload confirmation names how many items the SDK
refuses an upload with; the SDK's own check during the upload decides.

## Unity producing face

[Bridge v5](unity-bridge-v5.md) is a separate Candidate entry point for these operations. Frozen
v1-v4 serialization, version gates and vectors remain unchanged. Scene IDs stay local; observed
scene facts feed the separate Candidate [Recipe v0.4](amf-recipe-v0.4.md). Local save/reopen, reviewed sharing/import and
new-project preparation and bounded managed-Avatar application do not establish the full N4 gate or player visual acceptance.

Desktop launches the GUI Editor outside the strict AMF worker job after AMF admits the handoff.
Unity returns a receipt for actual Avatar selection and official SDK panel invocation. This is a
handoff, not a successful build/upload. Disabling AMF does not terminate that player's GUI Editor.

Before each Unity run and Editor handoff, AMF starts Unity Hub when its licensing client is not
running and waits up to 90 seconds for the client. A packaged (MSIX) Hub starts through its
application identity, so the client reads the license from Hub's package folder.

Preparation installs lilToon from its official feed when a selected package bundles lilToon or
carries a lilToon material whose shader none of the selected packages provides.

## Evidence limits

Synthetic tests check contracts, confirmation, recovery and relationships. They do not establish
N3's complex real-material gate or player visual acceptance. N3/N4 acceptance remains owned by
[the N sequence](../development-outline.md#n3-complex-real-material-avatar-production).

## Document changelog

- 0.13.0 (2026-10-18): cached v2 project fingerprints with a per-file hash cache in `.vua/fingerprint-cache.json`, one-time v1 comparison for older records, and the `fingerprint` progress stage for the after-Unity project-file check.
- 0.12.0 (2026-10-18): run facts carry `sdkReview`, the SDK's own Avatar checks and performance ratings, shown on the release page.
- 0.11.0 (2026-10-18): the upload record names `sdkSignIn` (`vua_session` / `panel`), the sign-in source of the SDK panel, and links the experimental [VRChat sign-in](vrchat-session-v0.1.md).
- 0.10.0 (2026-10-17): release the finished Avatar: a recorded 60-frame turntable and managed upload through the VRChat SDK after the player's rights confirmation.
- 0.9.0 (2026-10-17): add step times, usual step durations, Unity stages in task progress and `get`, Stop through task cancellation, and the `stopped` and `inspecting` phases.
- 0.8.0 (2026-10-16): report result and candidate previews and read them through `amf.production.previewImage`.
- 0.7.0 (2026-10-16): start Unity Hub before Unity work and install lilToon for lilToon materials whose shader is absent.
- 0.6.0 (2026-10-15): add observed Recipe differences, reviewed priority choices, same-project new Avatars and preserved unmentioned outfits.

- 0.5.0 (2026-10-15): connect source-reviewed export and idempotent received Recipes through the closed production Gateway.

- 0.4.0 (2026-10-15): connect verified scene settings to local Recipe saving, reopening and pinned new-project preparation.
- 0.3.0 (2026-10-14): expose actual saved-scene observations and prefer verified current settings when editing again.
- 0.2.0 (2026-10-14): extend the Candidate with reviewed, reversible user restoration and continued editing after assembly.
- 0.1.0 (2026-10-13): add the Candidate material-first N3 face, isolated managed-project path, exact confirmation and explicit evidence/recovery limits.
