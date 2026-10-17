# AMF production Recipe v0.4

> Document version: 0.3.0
> Status: Candidate
> Updated: 2026-10-15
> Owner: AMF

This format connects saved declarations to the real material-first production path. It is separate
from frozen Recipe v0.2/v0.3 and selection drafts. It does not change those consumers. The closed
[schema](../../schemas/amf-recipe/v0.4/recipe.schema.json), Rust validator and TypeScript validator
share positive and negative vectors; cross-reference and uniqueness rules also require validation.

A document contains a name, exact admitted Unity version, original package content identities,
an Avatar prefab, supported outfit bindings/switches and exact observed VPM dependency versions.
Package references contain their original filenames and lowercase SHA-256 values; material IDs
derive from that digest. Prefab paths are package-relative `Assets/` paths. Absolute machine paths,
warehouse copy IDs, scene GlobalObjectIds, snapshots and asset bodies are not document fields.
Unknown fields are rejected. The current supported settings are binding mode, an observed humanoid
bone, switch label and default activation. Arbitrary Unity edits are not represented by this format.

Saving requires current project fingerprints and a verified saved-scene selection. The retained
requested selection alone is insufficient. Capture includes selected inputs and dependencies
actually referenced by the active saved Avatar. Inputs used only by another Avatar are excluded
when that dependency observation is present. Older Candidate runs without it
retain their prepared inputs conservatively rather than silently dropping a required shader or
material package; sharing must establish the referenced subset separately. Local saving and use
require no BOOTH attribution or login.

The [material-first face](amf-production-v0.1.md) exposes `listRecipes`, `getRecipe`, `saveRecipe`
and `prepareRecipe`. Documents use AMF's revisioned document store under `recipes-v04`. Saving
creates a new retained document. Reopening validates its identity and format. Preparing from a
Recipe resolves local packages by content, verifies their present bytes, admits the exact Editor,
and installs pinned dependencies in a new independent work project. Missing inputs produce a
named failure before creating a project; supplying them permits another attempt. Actual Unity
inspection must confirm prefab targets and dependency versions before the saved choices become
reviewable. Preparation never silently executes assembly; the ordinary digest review still applies.

## Sharing and receiving

The closed [share schema](../../schemas/amf-recipe/v0.4/share.schema.json) wraps the Recipe with
one native BOOTH product ID per referenced material. It permits no asset bodies, extra payload
fields, local scene identities or machine paths. A UTF-8 JSON file and a `vuar0.4.` base64url paste
text represent the same declaration; decoded content is limited to 256 KiB. Unknown fields,
versions, broken references and unbounded option arrays are rejected at both native and desktop
boundaries. Imported content does not execute operations or download anything.

Sharing first obtains a reviewed source plan. AMF retains a local origin sidecar when saving,
bound to the Recipe digest and the saved scene's reference observation. Old Candidate saves
without that observation must be reinspected and saved again. Only the Recipe's material set is
queried against BDL artifact and entry metadata; unrelated library entries do not become export
requirements. Existing unambiguous correlations are reused. Missing or multiple candidates need
an explicit choice. The UI supports selecting several materials and assigning a purchased/cached
BOOTH product, searching public product candidates, or reading a product URL.

Export binds the Recipe revision and current source choices to the reviewed digest, validates the
entire supplementation before writing anything, and remembers user-confirmed choices by material
content identity in AMF's local `recipe-source-choices.json`. These are Recipe source-selection
preferences; they do not rewrite BDL observations or claim store-original authenticity. Imported
author statements remain attached only to that received Recipe and are not promoted to the local
confirmed-choice store. Neither a source statement nor an exported Recipe grants purchase rights.

Import previews validated references/settings before saving. Reimporting the same declaration is
idempotent, including when it comes first as text and then as JSON. The receiver has an independent
local Recipe identity. Actual reproduction still resolves and verifies the receiver's own original
files and exact dependencies; missing files fail before creating a project. The desktop clipboard
and file-dialog helpers accept only the validated declaration and reconstruct its text, never an
arbitrary caller-provided blob or output path.

## Remaining acceptance

The Candidate connects local saving, sharing, receiving, new-project reproduction and reviewed
application to a selected, observed owned Avatar whose inputs are already prepared. It preserves unmentioned
outfits, supports both setting priorities, creates another Avatar in the same project, and permits
cancellation without execution. Selecting unowned scene targets and adding new input packages remain
open parts of the [product boundary](../product-boundary.md). Explicit removal, additional supported scalar edits,
existing external-project copies and experimental VPM material intake remain separate work.
N4 acceptance and player visual review remain owned by
[the N sequence](../development-outline.md#n4-recipe-and-multi-flow-reproduction).

## Document changelog

- 0.3.0 (2026-10-15): connect bounded managed-Avatar overlay choices and capture dependencies of only the active Avatar.

- 0.2.0 (2026-10-15): add bounded BOOTH-reference sharing, reviewed source supplementation, remembered choices and idempotent received declarations.

- 0.1.0 (2026-10-15): introduce closed saved declarations and connect them to current scene facts, local content resolution and pinned preparation.
