# Unity Bridge v5: AMF production

> Document version: 0.9.0
> Status: Candidate
> Updated: 2026-10-18

This separate producing face admits the exact development pair `2022.3.22f1` and
`2022.3.22f1c1`, retaining the complete running version. It does not change v1-v4 behavior.
The fixed entry point is `Vua.Editor.Bridge.AmfProductionEntryPoint.Run`.

Operations are `amf_prepare`, `amf_inspect`, `amf_assemble` and `amf_turntable`. The command envelope has `schemaVersion: 5`,
`commandId`, `projectId`, `operation`, `dryRun`, optional `expectedProjectFingerprint` and
`payload`. `payload.planRef` names an `*.amf-plan.json` request under the managed project's
`.vua/bridge/`; `payload.planHash` is its lowercase 64-character SHA-256 (without a prefix).
Other legacy envelope payload fields have no v5 semantics. This request is separate from frozen
Recipe/production-plan files. `dryRun` is true only for inspection.
The file's closed format is `schemaVersion: "0.1"`, `runId`, `sources` (sourceId/role/assetPaths)
and `selection`, with optional `applyTarget` for Recipe application. Mutating assembly requires an exact current fingerprint and a saved
managed scene. It validates all prefab/target/menu inputs before changes.

Preparation creates a new empty managed work scene and refuses an existing scene. Inspection
reads the selected source paths and the saved managed scene, reports actual prefab descriptor,
bone and MA facts, and changes no scene. Saved ownership resolves exact scene objects; a missing
object is never replaced by a same-name match. It checks current prefab identity, actual binding
targets, owned switches, activation, missing scripts and renderer references. `observedSelection`
is available only when all retained relationships can be represented and verified; it reflects
current scene settings rather than the last requested selection. Missing or changed relationships
remain explicit diagnostics. Assembly uses stable run/instance-owned objects, public MA
components, scene-local targets and an independent managed scene. An unowned collision is a
failure, not permission to edit an existing object. Return facts include actual target names,
source-to-instance mapping, binding and menu checks, descriptor recognition, diagnostics,
complete Editor version and project fingerprint. SDK build/upload and visual review are separate.
`usedSourceIds` records inputs whose asset paths occur in the selected Avatar's actual dependency graph,
so Recipe capture need not include unrelated automatic inputs that were only imported.

Recipe application and continued editing bind `applyTarget.avatarGlobalObjectId` to the exact
selected owned Avatar, making that ownership scope active without matching display names.
`newAvatarKey` is either null for an overlay or a digest-derived new scope for another Avatar in
the same scene. `writeSourceIds` admits only selected outfits whose supported settings change,
or all selected outfits for a new Avatar. Unmentioned or unchanged objects are observed without
reconfiguring their components. Existing ownership keys and scene objects are retained; a reused
new scope is rejected. `avatars` observes each retained owned Avatar's relationships and settings separately,
allowing preservation to be verified rather than inferred from an ownership file. Dependency
collection uses [Unity's object dependency API](https://docs.unity3d.com/2022.3/Documentation/ScriptReference/EditorUtility.CollectDependencies.html)
for the active Avatar so another scene Avatar does not expand a saved Recipe.

Every operation sets the work project's company and product name to `VUA` and `VUA Avatar Work`.
Unity keeps the VRChat SDK sign-in per company and product, so one sign-in serves every work
project. `sdkSignedIn` is `yes` when the SDK holds a saved sign-in for that product, `no` when it
holds none and `unknown` when the SDK cannot be asked. `missingShaderMaterials` lists the selected
sources' materials and the active Avatar's renderer materials that Unity draws with its error
shader because their shader is absent, with the warning `amf.shaders.missing`.

After inspection and assembly, `sdkReview` carries the VRChat SDK's own checks of the active owned
Avatar. The Bridge runs the SDK control panel's Avatar check (the avatar builder's
`OnGUIAvatarCheck` in SDK 3.10.5) against a hidden panel instance, without opening the panel, and
reads the panel's error, warning and information lists into `issues` as `{level, text, canFix}`:
`level` is `error`, `warning` or `info`, `text` is the SDK's own sentence and `canFix` names an
item the SDK offers Auto Fix for. `stats` lists each performance category the SDK rates as
`{category, rating, text}`, computed with the SDK's performance calculation for the project's
build target (`platform` `pc` or `android`); `rating` runs from `Excellent` to `VeryPoor` and
`overall` is the SDK's overall rating. `state` is `checked`; `partial` when the SDK stopped
part-way, keeping the items found before; `unavailable` when the SDK offers no check, with
`detail`; and `not_run` for preparation and the turntable bake. The check only reads: the scene,
assets and settings stay as they are. At most 64 items are kept, each text up to 600 characters.

After inspection and assembly, the Bridge renders the active owned Avatar at 512×512 from the
front, side and back (camera yaw 0°, 90° and 180°) and lists them in `previews` as
`{view, path}`. During inspection it also renders each prefab candidate from the front at
256×256, up to 128 candidates, into the candidate's `preview`; a candidate without an image has an
empty `preview`. Each render copies the object into its own preview scene, lit by the white
three-light rig of the `build_preview` turntable, on an opaque neutral grey background, so the
work scene and its lighting stay unchanged. Images are opaque PNG files under
`.vua/previews/<commandId>/` in the work project, named `front.png`, `side.png`, `back.png` and
`candidate-NNN.png`; paths are relative to the project root with `/` separators. Rendering runs in
`-batchmode` with a graphics device. A failed render adds the warning `amf.preview.failed` and the
operation continues with its facts.

A batch run writes its Unity log to `.vua/logs/<commandId>.log` in the work project. The entry
point writes `[VUA] stage=bridge` when it starts, `[VUA] stage=previews` before rendering and
`[VUA] stage=finishing` before it writes the result, each as one line without a stack trace. AMF
reads these lines with Unity's own messages for its [live progress](amf-production-v0.1.md#progress-stop-and-continue).
A stopped run ends with Unity's process tree; the next run opens the project as Unity left it.

## Turntable

`amf_turntable` bakes the release turntable of the finished Avatar. It takes the same request file
as inspection (`dryRun` false, no `expectedProjectFingerprint`), opens the saved work scene,
observes it like inspection and renders the active owned Avatar 60 times at 512×512, camera yaw
0° to 354° in 6° steps, with the rig and background of the three views above. The frames are
`frame-00.png` … `frame-59.png` under `.vua/turntables/<commandId>/`, and `data.turntable` reports
`{folder, frames: 60, size: 512}`; other operations report an empty folder with zero frames and
size. The operation renders no previews and leaves the work scene unsaved and unchanged. A render
failure fails the operation.

The caller bakes only for a finished run whose project Unity does not hold and whose fingerprint
matches the run's last check. It records the turntable when the observed scene fingerprint equals
the run's, every frame is a regular PNG of at most 640 KiB inside the work project, and the folder
is a plain command name under `.vua/turntables/`. The turntable stays bound to that scene; once
the scene changes, the release room shows the three views and offers to bake again. Earlier
turntable folders are removed after each bake.

## Managed upload in the open Editor

The official VRChat SDK builds and uploads an Avatar through its public builder API,
`VRC.SDK3A.Editor.IVRCSdkAvatarBuilderApi.BuildAndUpload(target, avatar, thumbnailPath,
cancellationToken)`. SDK 3.10.5 hands out the builder (`VRCSdkControlPanel.TryGetBuilder`) only
while its control panel window is open, requires a signed-in account allowed to publish Avatars
(`APIUser.CurrentUser.canPublishAvatars`) and shows VRChat's copyright ownership agreement inside
that panel once per session and Avatar. Upload therefore runs in the Editor's interface, not in
batch mode. The Bridge reaches these SDK types by reflection, so the package compiles in every
project it is installed into.

1. The player confirms the content rights statement in VUA for this upload and, for a new
   Avatar, its name. VUA then writes `.vua/bridge/amf-upload.json`:
   `{schemaVersion: "0.1", runId, uploadId, avatarGlobalObjectId, avatarName, thumbnail,
   rightsConfirmed: true}`. `thumbnail` is the front preview under `.vua/previews/`.
2. When no Editor holds the project, VUA starts Unity Hub and opens the project, as for the SDK
   handoff. The Editor's VUA observer (interface mode only) reads the request when the run marker
   matches, opens the work scene, selects the owned Avatar and opens the SDK control panel.
3. The observer waits for the builder and the VRChat sign-in, which stay entirely inside the SDK
   panel. It adds a `PipelineManager` when the Avatar has none. An Avatar without a blueprint ID
   is a new VRChat Avatar: it gets the player's name, an empty description, private release
   status and the front preview as thumbnail. An Avatar with a blueprint ID keeps its details on
   VRChat, read through `VRCApi.GetAvatar`, and its thumbnail.
4. It calls `BuildAndUpload` and writes `.vua/bridge/amf-upload.progress.json` lines
   `{runId, uploadId, stage, progress, status}` from the builder's build and upload events. Stages
   are `sdk_panel`, `sign_in`, `checking`, `building`, `uploading` and `finishing`; VUA adds
   `starting` before the Editor answers. `progress` is the upload share from 0 to 1, or -1.
5. It ends with one `.vua/bridge/amf-upload.result.json`: `{runId, uploadId, outcome, blueprintId,
   reason, detail, errors, firstUpload, sceneSaved}`. `outcome` is `succeeded`, `failed` or
   `cancelled`. `reason` names why an upload did not succeed: `sign_in_required`,
   `no_publish_permission`, `validation` (with the SDK's `errors`), `ownership`,
   `agreement_declined`, `build`, `build_blocked`, `upload`, `thumbnail_missing`, `avatar_missing`,
   `scene_not_saved`, `interrupted`, `editor_unavailable`, `timeout`, `cancelled` or `unknown`;
   `detail` carries the SDK's own message. After a first upload the SDK writes the new blueprint ID
   into the scene, and the observer saves the work scene so later uploads update the same Avatar.

Stop writes `.vua/bridge/amf-upload.cancel` with the upload ID; the observer cancels the SDK's
token and answers `cancelled`. A domain reload ends a running upload: the observer remembers the
started upload in `.vua/bridge/amf-upload.started` and answers `interrupted` instead of building it
twice. VUA accepts only answers bound to its run and upload ID, of at most 256 KiB, and a success
only with a VRChat Avatar ID of the form `avtr_<uuid>`. It waits up to 10 minutes for the Editor to
pick up the request and up to 90 minutes in all.

Requests and results are atomically written under the controlled Bridge directory. File hash,
run binding, exact Editor pair, allowed operations and path containment are checked by Unity.
The caller additionally validates schema version, operation, command identity and receipt status.
The v5 source files are installed only into a real-SDK/MA production project, and are excluded
from legacy conversion scaffolds that intentionally use minimal compile stubs.

## Document changelog

- 0.9.0 (2026-10-18): read the VRChat SDK's own Avatar checks and performance ratings into `sdkReview` after inspection and assembly.
- 0.8.0 (2026-10-17): bake the 60-frame release turntable with `amf_turntable`, and upload through the SDK builder in the open Editor after the player's rights confirmation in VUA.
- 0.7.0 (2026-10-17): write bridge, previews and finishing stage lines to the run log.
- 0.6.0 (2026-10-16): render the active Avatar from three sides after inspection and assembly, and each prefab candidate during inspection.
- 0.5.0 (2026-10-16): share one company and product name across work projects, report the SDK sign-in state and list materials whose shader is absent.
- 0.4.0 (2026-10-15): bind Recipe application to observed Avatar identities, support independent same-scene Avatar scopes, and observe retained Avatars separately.

- 0.3.0 (2026-10-15): report source dependencies actually used by the saved scene for Recipe capture.
- 0.2.0 (2026-10-14): observe retained scene objects and current supported settings during reinspection and restoration.
- 0.1.0 (2026-10-13): define a separate Candidate N3 entry point, exact f1/c1 identity, hash-bound requests and observed result relationships.
