# N5 rework plan — unified library and acquisition producers

> Document version: 1.5.0
> Status: Accepted
> Scope: Implementation direction for the N5 material-management rework, within the accepted N5 scope
> Updated: 2026-10-08
> Authority: User direction of 2026-10-02 approving this plan's approach after the capability audit;
> acceptance remains owned by the [N sequence](../development-outline.md), scope by the
> [product boundary](../product-boundary.md). Input evidence: [capability audit](n5-capability-audit.md).

## Reading context

This plan sequences implementation slices from the audit's retain/complete/replace decisions. It
adds no product scope: every acceptance claim stays with the N5 rows in the development outline,
and the 2026-09-22 production rulings (provenance experience, BDL base responsibilities,
experimental forensics) apply unchanged. The Steam store+library interface is a design reference
only; VUA is not building a store and never completes purchases for the user.

## Vision (validated with the user, 2026-10-02)

The player's BOOTH account becomes a local library: sign in once inside the embedded browser, and
VUA builds a local catalog of the account's available material (no file bodies), distinguishes
cloud-listed from downloaded material, and downloads only what the user selects. Local imports and
unknown-provenance files live in the same library with honest state badges. The library is the
feeding ground for production (N3) and Recipe reproduction (N4); Recipes keep carrying references
only. Everything account-related stays local and entitlement-respecting.

## Design decisions

**D1 — One library, account catalog as backbone.** The current split (catalog browser reading the
always-empty `products` table vs. warehouse entry list reading local artifacts) becomes one library
view: the account-synced catalog is the backbone, local artifacts attach as state. Local imports
without provenance appear as "unknown source" entries in the same library. Two deliberate
deviations from the Steam reference: the "store" is BOOTH's own site in the isolated embedded
browser (VUA never automates purchase/payment), and "cloud" always means the user's own account,
never a VUA-operated service.

**D2 — Independent entry facts.** Cloud listing, current physical-file presence, acquisition
attempt and production qualification are separate facts. A stored file is not automatically
usable for production; all formats are retained under the user's 2026-10-08 ruling. Explicit
re-download replaces the selected managed file under the
[replacement ruling](../decisions/library-download-replacement.md), while failures keep the old
file. Missing files, legacy replacement ambiguity and unknown provenance remain explicit.
The [provider-side aggregate](../protocols/library-view-v0.1.md) joins products, membership,
physical copies and task folds; the renderer renders, it does not perform the join.

**D3 — Library page shape.** Filter rail (all / not-downloaded / downloading / imported /
missing-files / local-import) + card grid (image, title, price badge, state badge, version chip)
+ detail drawer (media, terms, known dependencies with suggestion-vs-confirmation, associated
files, provenance, actions). Context menu equals a "⋯" menu with full keyboard access (APG
patterns per the design standard); right-click is a shortcut, never the only entry. Menu actions:
open source page, download/re-download, relink, correct source association, switch version,
remove record (distinct from delete files; Recipe-reference effects explained), generate VPM,
set artifact mode. Multi-select → "download selected" → per-item tasks in the notification center.

**D4 — Library sync producer, thin edges.** A reader in the Electron remote-content module fetches
account-library pages **inside the partition session** (cookies never leave Electron; no session
identifiers cross IPC) and ships raw page events to the provider, mirroring the `download.ingest`
pattern. The provider parses (pure logic, synthetic-testable), validates against the closed sets,
and writes through the observation face ([bdl.md](../architecture/bdl.md#observation-write-face),
`record_product_observation`: upsert
idempotency, tombstones, `catalog_updated_seq` in-transaction). Sync is an orchestrator nine-state
task: cancellable, per-page partial-failure honesty, expired-session → blocked with a re-sign-in
route. Only the account's own library pagination is read; no whole-site crawl. Capability
investigation precedes implementation assumptions (outline requirement): S1 starts by checking the
real page formats read-only (public pages now; logged-in pages in user-run local verification).

**D5 — Explicit selective-download initiation.** N5 acceptance requires user-chosen selective
download, so a new versioned contract method lets the library initiate downloads of explicitly
selected items through the partition session (the retry path's `downloadURL` mechanism already
proves the transport; it triggers the same `will-download` pipeline). Per-item user authorization,
booth.pm origin allowlist, no batch entitlement expansion. Capability advertisement gains the
warehouse/catalog/downloads family rows (audit F2).

**D6 — BDL: big as a library, never an actor.** BOOTH domain *knowledge* consolidates in the Rust
material-domain modules (the product-page parser currently stranded in `crates/orchestrator`
relocates during later cleanup; the new listing parser lives in `crates/acquisition`), but BDL
itself stays the evidence ledger and identity map: no network, no sessions, no task authority.
Rationale recorded for future reviewers: (a) credentials must not leave the Electron session
boundary; (b) the Chromium partition session is what makes authenticated access reliable at all —
a synthetic Rust client gains nothing (politeness pacing dominates throughput) and loses
anti-bot resilience; (c) task visibility must stay uniform (one notification center); (d) a pure
ledger is deterministic and cheap to test. Every new capability is a thin producer feeding the
same ledger pattern.

**D7 — Automatic compatibility forensics: a third producer, off by default.** Same ingest pattern;
allowed observation surfaces are the user's actual embedded browsing and Unity usage (via Bridge
production records). Output is evidence rows with provenance in `compatibility_observations`
(table exists; read/write faces and consumers do not — BDL v2 vocabulary completion is part of
this feature, not a prerequisite of S1). The toggle controls only the producer; base storage,
import, and provenance supplementation never depend on it. No evidence renders as unknown;
suggestions are never presented as confirmations.

**D8 — Provenance search for unknown files.** User-initiated "find source": candidate generation
from local clues (acquisition heuristics: archive name, inner filenames, README, package shape) →
two-tier candidate sources (local account catalog first — this is why D4 precedes D8; BOOTH public
search through the partition session second) → user confirms → correlation lands via the existing
`record_artifact_mapping` write face (awaiting its first producer). Follows the ruling: as little
as possible, as late as possible, never repeated once confirmed; a BOOTH ID is the user's
statement, not VUA's certification.

**D9 — UI discipline.** Honest empty states (signed-out library shows a sign-in card, never seed
data); refresh keeps old results; 700 ms busy-token rule; notification-center semantics; standard
error shape (event, object, cause, next step, retry). Four-language i18n from the first slice.
Each slice with UI ships with human UI review as its acceptance gate (N sequence requirement).

## Preserved undecided items

Dependency-completion degradation path and BDL human-correction UI remain undecided per the
product boundary; no slice below may silently resolve them. BDL v2 gaps (terms/compat consumers,
entity/relation slots, `stale`, creators/aliases, product-level version semantics) are scheduled
inside the slices that need them, not as a standalone "finish BDL" slice.

## Slice sequence

| Slice | Contents | Primary audit rows |
| --- | --- | --- |
| S1 Library sync | Capability investigation (real page formats, read-only); catalog-sync v0.1 contract (schema + vectors + consumer test); partition-session reader in Electron; provider parse + observation-face writes; aggregate state query; library page skeleton with three-state badges and sign-in empty state; capability advertisement | E1, B1, F2 |

S1 addendum (1.1.0, user direction + real-machine verification 2026-10-02): the account
library has **three** types — bought (`/library`), gifts (`/library/gifts`), and free
downloads (`/library/free_downloads`, newly added by BOOTH) — all sharing the library-row
grammar and the sync face (the trigger accepts a per-type startUrl). Real signed-in runs
verified: login persistence across restarts, bought and gifts pagination (2 pages each),
free downloads single page (user will grow it to re-verify pagination), 35 unique
products with zero duplicates, resync idempotency, and honest inspect-required recovery
for an interrupted run. UI-side library-type selection rides with S2.

User direction (2026-10-02, third round): the two warehouse track cards (catalog vs
local assets) merge into ONE library page; cloud-vs-local becomes a filter, not a
section switch. The merged-page layout rework (wall visibility floor, production
section placement, below-fold empty card) rides the S3 UI slice.

Slice addendum (1.3.0, 2026-10-03): the VPM import experimental option landed —
`warehouse.import` optional `autoGenerate` (bdl-commands v0.5) injects the existing
AutoGenerateSpec pipeline; the renderer gates the option behind the settings-experimental
toggle exactly as the user specified. D2 v1 landed: download adoption writes
artifact_mappings opportunistically (product id from the delivery's origin URL), and
catalog.list entries carry `importedArtifacts` (bdl-queries v0.6) with an "Imported"
card badge. Full D2 (unified entries joining local-only materials) still rides the
aggregate query slice.
| S2 Selective download | D5 initiation method; download → auto-adopt → state transition; duplicate-decision dialog | E1, E2, A2 |
| S3 Library management | Unified menu (relink, correct source, remove-record vs delete-files with Recipe effects); version chips and switching; local-import entries as unknown-source | B4, B5, E2 |
| S4 Inspection & dependencies | Wire `ArtifactInspector` as the single intake gate; dependency-observation ingestion + consumer page after the pending ruling | A3, D1 |

All slices: synthetic tests in-repo; real-account/real-download runs stay local user-run evidence
(recorded per-run, `not_run` until exercised); no end-to-end claims without those runs.

## Takeover baseline (2026-10-08)

The user stopped the former session, authorized discarding its uncommitted files and requested
sequential work toward Explorer + Steam-library behavior. Committed branch work is retained.
Earlier real runs above remain historical observations, not acceptance evidence for this new
implementation. The new protocol faces are implementation baselines, not frozen releases.

| Work | Current implementation | Remaining evidence or work |
| --- | --- | --- |
| Whole-run sync | [Catalog sync v0.3](../protocols/catalog-sync-v0.3.md): durable begin, ordered selected libraries/pages, receipts, explicit finality and inspect-required restart | New real-account/expired-login/interruption runs and human UI review |
| Selected download | [Library download v0.1](../protocols/library-download-v0.1.md): durable selected-file intent, acknowledged delivery, independent checks, stable replacement and rollback, explicit legacy-copy choice | Real transport cancellation, legacy-copy choice and real-material UI review |
| One library | [Library view v0.1](../protocols/library-view-v0.1.md): provider join, multiple memberships, physical presence, source/status filters and pagination | Same-size edits still require production hash verification; full file-management UI review |
| Selected material destination | [Selection drafts v0.1](../protocols/recipe-selection-draft-v0.1.md): durable reference collections, append, view/rename/remove references, separate production store | Final Recipe design and explicit promotion remain undecided |
| Selected-file removal | [Library maintenance v0.1](../protocols/library-maintenance-v0.1.md): file/reference preview, durable independent results, retained catalog/copy/draft identities, cancellation and inspect-required restart | Explicit inspection resolution for interrupted tasks; human UI/real-material review; record removal remains a separate unimplemented action |
| Generated versions | Changed managed originals mark retained VPM copies superseded; current production resolution excludes those outputs; library exposes old/current counts | Explicit regeneration and package-version allocation still need the next slice; old generator remains compatible |
| Maintenance and production | Existing frozen maintenance and production paths retained | Relink/version switching, provenance correction and production qualification remain incomplete; no N5 acceptance claim |

Checks cover Renderer and Electron TypeScript, runtime wire guards, schema vectors, Gateway
consumer routing, Rust domain/ledger/provider behavior and four-language copy. Synthetic cases
include partial results, replay, restart, failed replacement preserving old files and durable
draft revisions. Real BOOTH credentials, paid materials and Unity projects have not been used
to establish acceptance for this baseline.

The [KonoAsset reference](https://github.com/siloneco/KonoAsset/tree/f83271e53f276df4bb0b60865cfbf86b42f1bbc4)
was read roughly, including its add dialog, BOOTH metadata lookup, local metadata model and
copy-in importer. Its file-management, duplicate handling and import progress provide useful
comparison points. Its manual asset-record form is not adopted as VUA's main intake experience.
This source review is a design reference, not runtime evidence or new product authority.

### Maintenance ruling and next choices

The user accepted keeping catalog records and Recipe/draft references after deleting managed
files, and keeping old generated VPMs after a changed re-download (2026-10-08). The
[owning decision](../decisions/library-file-maintenance.md) records these choices. The new
removal path previews selected copies and affected references, explicitly reports unresolved
Recipe reference shapes, and preserves missing-copy identities. It does not reuse the frozen
VPM-only cleanup command. Synthetic tests exercise replacement restoration, content/path drift,
partial results, cancelled work, reference-read failure and replay without restarting deletion.
Windows path casing and existing directory aliases are included when calculating affected
references, conflicting content evidence and download/removal exclusion. Synthetic cases verify
that an aliased ledger row is not reported as a remaining physical copy, contradictory hashes
refuse deletion, and older interrupted plans still fence later bindings to the same file.
The dialog also preserves the accepted request identity when a receipt is lost and provides an
explicit same-request retry. A production-resolution regression first pins an approved plan to
a generated package, replaces its original, then verifies that a new plan falls back to the
current original while the saved Recipe, approved plan and old package remain unchanged.
Interrupted removal plans keep their conflict fences until an explicit inspection-resolution
action is designed; the baseline can display and replay them, but cannot yet resolve that hold.

The current generator uses a stable package ID but hardcodes version `0.1.0` in
`MaterialExecutor::generate_vpm_only`. It also rejects any existing generated copy. A safe
regeneration slice must define a distinct output revision and publication path so retained old
packages and pinned production inputs remain reproducible; reusing the old path would overwrite
history. The new resolver also needs copy/revision-level lineage: entry and content hash alone
cannot distinguish a retained old output from a fresh output with identical bytes. Package
revision allocation and the relation to visible material versions are held for
the next focused design, without inventing a final Recipe format while the user is away.
The frozen legacy original-cleanup face also predates superseded-output lineage; a successor
must require a current qualified generated revision before offering to remove current originals.
Its frozen contract is not redefined by this slice.

Relinking unchanged missing files can be handled independently. Different-content relink,
version switching, provenance correction, record removal and final Recipe promotion must not
silently retarget saved content-pinned references. Human UI and real-material acceptance remain
open under the N sequence.

## Coexistence with N1

PR #61 was merged and this branch was rebased with its merge structure preserved on
2026-10-08. Conflict resolutions retain N1 runtime/profile isolation, network/website test
contracts and guidance startup alongside N5 image caching, login overlay and library contracts.
The current implementation was restored from its pre-rebase local snapshot. Combined post-rebase
Rust workspace tests and Clippy, desktop tests and Renderer/Electron type checks, Gateway boundary,
four-language table and contrast checks passed. Contract schema/vector tests passed as well.
Production build and fixture-leak checks passed. A new isolated Chromium DOM check covers selected
files, failed reference reads, cancellation finality, recovered operations, stale preview feedback,
same-request receipt recovery and native Escape/focus restoration. It uses only a synthetic Gateway;
real BOOTH/Unity runs and human UI acceptance remain unrun for this takeover implementation.
D6 parser relocation remains later cleanup, not a prerequisite for usable maintenance.

## Document changelog

- 1.5.0 (2026-10-08): implement selected-file removal and retained generated-version facts, record remaining regeneration/Recipe choices and reconcile PR #61.
- 1.4.0 (2026-10-08): record the sequential takeover baseline, replacement/retention and draft rulings, independent library facts and remaining acceptance gaps.
- 1.0.0 (2026-10-02): initial plan consolidating the post-audit design discussion: unified library
  vision, D1–D9 decisions, slice sequence S1–S4, N1 coexistence notes.

- 1.1.0 (2026-10-02): S1 addendum — third library type (free downloads) per user
  direction; real-machine verification facts recorded.

- 1.2.0 (2026-10-02): user direction — merge the two warehouse tracks into one library
  page with a cloud/local filter; layout rework rides S3.

- 1.3.0 (2026-10-03): VPM import experimental option + D2 v1 (adoption correlation +
  importedArtifacts aggregate); full D2 aggregation still pending.
