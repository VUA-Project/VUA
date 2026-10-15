# Local library migration: material boundaries and preview

> Status: Draft — grouping design for author review; not migration acceptance
> Updated: 2026-10-12
> Owner: AMF

## Delivered entry points

The library offers **Import a local item**, retaining explicit folder/file copy-in semantics.
Each selected entry is one library card; its companion files stay in its details. A small adjacent
arrow opens **Import multiple items (library migration)** on click or hover. The migration entry
currently provides a read-only structural preview of explicitly selected directories. It lists
ordinary files without interpreting their purpose, expands directories on demand, reports links,
read failures and limits, and never extracts archives or submits an import. Every boundary remains
unconfirmed. Directory reads are capped at 1000 immediate entries and the UI at 16 levels; these
limits mean incomplete review, never an empty or fully classified source.

This checkpoint deliberately supplies no automatic grouping writer. The design below must be
resolved before adding migration execution. Existing [intake](../protocols/library-intake-v0.2.md),
[file/reference maintenance](../decisions/library-file-maintenance.md) and
[N5 acceptance](../development-outline.md#n5-audit-and-redo-material-management) remain authoritative.

## The unit the player confirms

A material is a user-confirmed group of local source files, independently named, managed and
selected in the library. A directory may represent a material, a classification, a wrapper or a
mixture. A file extension, one UnityPackage, a BOOTH-looking number, an Avatar name, a thumbnail or
a content hash cannot by itself establish a material boundary.

The single-item route is explicit intent: the selected directory is one material and keeps its
relative layout, even when it has many packages, versions or subdirectories. Multi-item migration
has explicit collection intent, but does not imply that its immediate children are products.
The host does not open other managers' databases, sessions or credentials to guess this intent.

## Automatic work before confirmation

Automatically collect **structural facts**: actual ordinary files/directories, relative paths,
sizes, read errors, link exclusions, and scan completeness. Reuse a clearly identified supported
export manifest only through a separately defined reader; an arbitrary JSON file is not a manifest.
No format/role classification is needed to retain PSD, FBX, textures or instructions.

Then propose navigable structure rather than silently declaring products:

| Observed structure | Proposal and initial selection |
| --- | --- |
| Collection root chosen by the user | Show it as the reviewed collection; no material is confirmed |
| Directory containing only child directories | Suggest reviewing the children; could still be a single asset wrapper |
| Directory with one child | Offer opening the child; never silently discard the wrapper name/files |
| Directory containing ordinary files | Show those files together with its child directories; material boundary unconfirmed |
| Several sibling ZIPs/UnityPackages | Show separate candidate inputs; do not assume separate products or merge matching names |
| Recognized export manifest naming units | Show manifest-derived suggestions with their source; filesystem discrepancies remain unresolved |
| Empty, unreadable or partially scanned directory | Show the actual state; do not count it as a ready material |

Names such as Clothes, Assets, Manuka, v1, old, shared or Booth are optional **navigation hints**,
not deciding rules. Confidence scores must not conceal ambiguity. The first design should not
require AI or internet access. BOOTH lookup is a separate user action after material boundaries
are established; it cannot grant account membership or content equality.

## The preview controls

Each directory has three explicit choices: **one material**, **collection — review its contents**,
or **exclude from this import**. A collection can contain both materials and deeper collections.
The initial state is unconfirmed. A single bulk command, **these selected sibling folders are
separate materials**, applies a player's decision without requiring a form for every item.
The player can undo this choice or change one row before submitting.

For loose files at a collection level, allow explicit grouping into a named material, choosing
individual files as separate materials, or exclusion. Multiple selected files can be grouped
without moving their originals. README, license and common texture files are never silently
assigned to the nearest package, duplicated into all children or discarded. A confirmed group
may include a subtree and explicit sibling files; their paths relative to the reviewed root are
preserved. Cross-root combinations require an explicit root namespace rather than flattening
same-name files.

Show **confirmed materials**, **unassigned files**, **excluded files** and **unreadable/unscanned
areas** separately. The final import button operates only on explicitly confirmed complete groups.
The default whole-collection submission remains blocked while coverage is unresolved. An optional
partial import must name the selected complete groups and leave an explicit remainder; a count
such as "24 materials" must not pretend the entire source was inspected.

## Mechanical invariants for the execution slice

1. **Coverage:** every observed ordinary source file has exactly one disposition: assigned to one
   confirmed material, explicitly excluded, or unresolved. Scan failures/limits are unresolved,
   never implicit exclusions. Executed groups have complete coverage of their declared selections.
2. **No overlap:** selecting a parent as a material prevents also selecting its descendant as a
   separate material. Changing to a collection makes the unresolved remainder visible; the API
   must reject overlaps instead of silently dropping one of the confirmed groups.
3. **No silent deduplication:** equal bytes in different paths/groups retain their physical copy
   identities. Content hashes continue to reuse inspection facts. Source reconciliation follows
   the [product boundary](../product-boundary.md#production-scope-and-product-rulings-user-ruling-2026-09-22).
4. **No flattening or overwriting:** preserve relative paths; Windows case aliases, invalid names,
   collisions and conflicting archive-member paths require an explicit resolution or a failure.
5. **No original mutation:** review is read-only and execution copies into managed storage. Group
   edits never move/delete originals, rewrite earlier entries or retarget saved references.
6. **Freshness:** revalidate the selected source inventory before execution and each copy. Moves,
   additions, removals, link substitution and content drift invalidate the relevant review; do not
   automatically reshape groups around new files. Destination bytes still need actual copy/hash
   verification, rather than a preview metadata assertion.
7. **Lineage:** retain ZIP originals and extraction/member relationships inside the confirmed
   material. A ZIP is not evidence that its contents are one product. Expansion is the existing
   managed intake action after confirmation, with its separate failure outcome.
8. **Observable work:** use the existing AMF task channel for copying, cancellation, explicit
   retry and restart inspection. Replaying a confirmed group must not make duplicate entries;
   changing the plan requires a new command identity. Completed groups and unfinished groups are
   reported separately. UI limits must not masquerade as the existing 200-input command limit.

These are requirements for a new versioned grouped-intake face, not permission to reinterpret
frozen `warehouse.import` or the existing per-path commands. A candidate face should submit a
bounded list of named groups with explicit source roots/relative selections and the reviewed
inventory identity. AMF owns normalization, overlap/freshness validation, copying and storage.
Renderer edits a plan; Electron grants only the existing explicit local input and structural read
capability. Do not let a browser-provided path become a file-system write authority.

## Corner-case review matrix

All cases use synthetic files for repository tests. Real collections stay local. Expected behavior
is an observable grouping/coverage decision, not merely successful traversal.

| Input | Required preview/result |
| --- | --- |
| One garment, ten Avatar-specific UnityPackages | Keep one unit through single-item intake; migration does not auto-split by package count |
| One garment, source PSD/FBX, textures, instructions | Retain every ordinary companion within the confirmed unit |
| A texture-only material or shader-only folder | Can be confirmed as a material; no UnityPackage requirement for storage |
| Two products in one flat folder | Require explicit file groups; filenames alone cannot determine ownership of companion files |
| Clothes/shop/Avatar/product directories | Review arbitrary nesting; no fixed depth creates products |
| A product with Assets/Textures/Editor subdirectories | Those names do not turn it into a collection automatically |
| Collection with one child; nested wrapper directories | Preserve wrapper context; navigation does not finalize a boundary |
| Same product ID, v1/v2 and edited copies | Preserve chosen version/group boundaries and byte differences |
| Same title/image/ID on unrelated products | No automatic merging or account-content equivalence |
| Identical files at multiple paths | Preserve deliberate physical duplicates and independent groups |
| Parent and child both selected; alias paths | Flag/resolve selection overlap before copying |
| Loose archives plus shared license/README | Account for all loose files; no nearest-name assignment or silent discard |
| ZIP plus its old manually extracted tree | Do not assume equal/current content or automatically delete one copy |
| ZIP containing a whole multi-product collection | Keep archive indivisible initially; archive-content grouping needs an explicit separate design |
| Nested ZIP, encrypted/corrupt archive | Preserve original; distinguish structural preview from later expansion success |
| Empty directory, empty file, dot-prefixed companions | Report actual content; no implicit hidden-file or empty-file exclusion |
| Symbolic link/junction to a sibling, outside root or back to an ancestor | Mark link; do not follow it or recurse forever |
| User selects managed warehouse or its ancestor | Refuse recursive intake instead of copying the destination into itself |
| Access-denied child or disappearing file | Preserve unresolved error; no claim of complete coverage |
| Deep/large directory hitting a preview limit | Show the limit and unresolved remainder; no automatic acceptance |
| C:, another local drive, redirected Desktop/Documents, network root | Use actual native paths; no hardcoded C: or username assumptions |
| Unicode, case-only aliases, long names and root-name collisions | Preserve representable names; report alias/collision/path failures |
| Unity project (Assets, Packages, ProjectSettings, generated caches) | Surface project-shaped structure; do not silently discard caches or treat every Assets child as a product |
| Files added/changed between preview and confirmation | Require refreshed review for affected groups; never silently absorb new content |
| Cancellation halfway through a group and app restart | Retained copies/records remain visible; unfinished work waits for explicit inspection |
| Repeated migration and previously saved Recipe references | Preserve existing copies/references; explicit new import versus idempotent replay is distinguishable |

## Delivery sequence

The current change finishes single-item card scope, origin filtering, scroll-aware selection,
card removal and the directory picker, then exposes the read-only migration preview. The next
slice should implement the boundary-editing model and coverage tests from this matrix before
adding grouped copying. Real mixed-library acceptance and human UI review stay in N5; this draft
does not declare them complete or introduce a new release prerequisite.
