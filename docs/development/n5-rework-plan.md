# N5 rework plan — unified library and acquisition producers

> Document version: 1.1.0
> Status: Accepted
> Scope: Implementation direction for the N5 material-management rework, within the accepted N5 scope
> Updated: 2026-10-02
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

**D2 — Entry state machine.** `cloud-listed` → `downloading` (nine-state task) → `imported`
(inspected, usable). Side states: `files-missing` (relink offered), `update-available`
(same-name different-content, never silently overwritten), `duplicate-candidate` (explicit
decision), `unknown-source`. State is computed by a provider-side aggregate query
(products × mappings × artifacts × task folds); the renderer renders, it does not join.

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
| S2 Selective download | D5 initiation method; download → auto-adopt → state transition; duplicate-decision dialog | E1, E2, A2 |
| S3 Library management | Unified menu (relink, correct source, remove-record vs delete-files with Recipe effects); version chips and switching; local-import entries as unknown-source | B4, B5, E2 |
| S4 Inspection & dependencies | Wire `ArtifactInspector` as the single intake gate; dependency-observation ingestion + consumer page after the pending ruling | A3, D1 |

All slices: synthetic tests in-repo; real-account/real-download runs stay local user-run evidence
(recorded per-run, `not_run` until exercised); no end-to-end claims without those runs.

## Coexistence with N1

`crates/orchestrator`, `crates/provider-host`, and `packages/contracts` are N1's active files.
S1 deliberately confines Rust changes to `crates/acquisition` (new parser), small
`provider_host.rs` route additions in regions N1 does not touch, and new contract files; the
parser relocation (D6) waits for N1's merge. Expect a small rebase, not a redesign, when N1 lands.

## Document changelog

- 1.0.0 (2026-10-02): initial plan consolidating the post-audit design discussion: unified library
  vision, D1–D9 decisions, slice sequence S1–S4, N1 coexistence notes.

- 1.1.0 (2026-10-02): S1 addendum — third library type (free downloads) per user
  direction; real-machine verification facts recorded.
