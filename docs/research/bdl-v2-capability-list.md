# BDL v2 Capability List: Compatibility / Dependency Analysis

> Status: Draft — awaiting product-owner ruling; no normative effect until accepted
> Scope: The future capability layer above the BDL v1 boundary research ([`bdl-v1-boundary`](bdl-v1-boundary.md))
> Precondition: All of v1's IN/OUT, schema admission rules, and crawl discipline remain in
> force; this document only adds, it never overturns
> Updated: 2026-10-02

## The question v2 answers

v1 froze "what is stored and what is filterable"; v2 answers "**how relationships are
acquired and how they are used**" — the compatibility/dependency analysis the old cloud
BDB tried to achieve in one giant leap. The old BDB failure path was: build a corpus-wide
giant relationship database first, then make the pipeline fill it. The v2 counter-thesis:

**Relationships grow on demand — only what the user searches for gets fetched, and only
what has been fetched gets analyzed.**

## Three invariants (one per old-BDB failure mode)

1. **No pre-built matrix.** The relationship graph grows incrementally from observations
   the user already has. There is no "crawl everything, then analyze" phase and no
   inflationary fields reserved for a future matrix; every edge must name the query it
   serves at write time.
2. **No automatic assertions.** Analysis output is always the triple *evidence +
   provenance + confirmation state* — filterable, rankable, coverage-measurable.
   Blocking compatibility conclusions require user confirmation (same posture as v1
   IN-3). Automatic coverage was the old BDB's failure metric (corpus evidence: coverage
   "passed" only 7.6%), not a v2 goal.
3. **No new crawler.** Fetching is always an AMF material-acquisition act inside the
   user's own workflow: visible, cancellable, honoring the 6-seconds-per-request rule
   and robots.txt record-keeping. BDL only consumes AMF-validated source observations
   (the standing boundary in `docs/architecture/bdl.md`); autonomous background
   refresh does not exist.

## IN — capabilities

| # | Capability | Description | Precondition / evidence source |
| --- | --- | --- | --- |
| V2-1 | Normalized storage of relationship evidence | Author-declared dependencies and compatibility (body text, appended paragraphs, variant names) become first-class records with full provenance: page region, `content_hash`, `observed_at`, `processor_version`, extraction-rule version | The extraction spec v0.2 open item "compatibility/dependency extraction rules" completed under the same methodology; v1 IN-3 corpus coverage evidence (40%) |
| V2-2 | User-driven relationship expansion (one-hop deepening) | When a viewed product declares "corresponds to / compatible with X", AMF acquisition may **propose** adding X's product page to the acquisition flow; it happens only on user confirmation; observations enter BDL validated as usual | Existing AMF browse/download ports; no new fetching surface |
| V2-3 | Local relationship graph (incremental, versioned) | Two edge kinds: product↔product (declared compatibility / same series) and product↔package (author-declared dependency); every edge carries evidence kind, confirmation state, provenance pointer; lands as a versioned schema migration, never reshaped in place on v1 tables | V2-1; extension of the v1 schema admission rules (below) |
| V2-4 | Consumption of the alias/entity-resolution table | The "networked, periodically updated table" reserved by v1's OUT is consumed here as an evidence input: locally cached, licensed, provenance-carrying, invalidatable and reloadable as a whole; **no local automatic alias derivation** — pattern-hunting in page structures remains a failure mode | Needs ruling: table source, maintainer, license, cache and invalidation policy |
| V2-5 | Dependency evidence → Recipe supply | "This outfit needs lilToon" becomes an evidence record feeding Recipe dependency declaration (ruling recorded 2026-09-05: dependency declaration belongs to the Recipe layer); BDL supplies evidence only, never declares | The Recipe v0.3 dependency-declaration consumption interface |
| V2-6 | Relationship query surface | Per-product relationship views, find outfits for an Avatar, find dependency gaps; based strictly on locally observed data — gaps are honestly reported as "not observed" and become V2-2 proposal sources | V2-3; the five v1 boundary queries keep passing |

## OUT — v2 still does not do

- **Corpus-wide pre-crawling and a pre-built network-wide compatibility matrix** — the
  original old-BDB failure path, never to appear in a plan;
- Autonomous/background crawling, daemon-style refresh, distributed crawling (inherited
  from v1 OUT);
- Automatically asserting compatibility and blocking flows on it — eligible for
  discussion only after a confirmation state machine exists;
- Discovering alias patterns from page structure automatically (aliases come only from
  networked-table consumption or manual curation);
- Runtime compatibility verdicts — "does it actually run once installed" belongs to
  Assembly/Inspection verification evidence; BDL holds page evidence only;
- Public API, frontend service (inherited from v1 OUT; widening the read surface needs a
  separately accepted contract).

## Analysis method boundary

- **Real HTML first, rules second**: compatibility/dependency extraction rules are
  produced under the same process as the extraction spec v0.2 — induced from real product
  pages in the local corpus (including the golden anchor products and the products they
  declare), versioned into a document, then implemented as a pipeline against golden
  assertions plus synthetic fixtures. Rules are never written first and examples fitted
  afterwards.
- **The analysis recipe is local code**: cleaning, matching, and the confirmation state
  machine are local implementations; "analysis logic" is never fetched from the network.
- Every relationship must answer four questions: which observation, which page region,
  which rule, who confirmed.

## Schema admission (v1 rules + v2 additions)

- Inherited from v1: a field must answer "which IN row, which filter/mapping query needs it".
- v2 addition: a relationship edge must answer how three things are stored — **evidence
  kind, confirmation state, provenance pointer**; relationship rows without an evidence
  chain may not exist. Alias cache tables must carry a license field and a whole-table
  version field.

## Boundary queries (all must pass before the v2 schema freezes)

Fixtures = the two golden anchor products + local archives of the products they declare +
clearly-marked synthetic relationship rows (same verification discipline as v1).

1. Given an Avatar, list locally observed claimed-compatible outfits, tiered by
   confirmation state;
2. Given an outfit, list author-declared package dependencies, directly feedable to Recipe;
3. Given any relationship, trace the full provenance chain (observation → page region →
   rule → confirmer);
4. Given a search term, report local coverage and gaps; gaps convert into acquisition
   proposals;
5. Alias cache rows' license and source version are traceable and invalidatable as a whole.

## Sequencing and prerequisites

- **Does not block v1 delivery**: the minimal BDL SQLite schema for the v1 boundary landed on
  2026-09-06 (`schemas/bdl/v0.1`; the current frozen production format is `schemas/bdl/v0.2`,
  frozen 2026-09-22); the v2 relationship layer follows as a versioned migration and does not
  jump the gun inside the v1 schema's scope.
- Prerequisite research items (in dependency order):
  1. The compatibility/dependency extraction rules written up (extraction spec open
     item 2; methodology already fixed);
  2. Source and license ruling for the networked alias/compatibility table (the only
     open item in V2-4);
  3. The Recipe v0.3 dependency-declaration interface for consuming BDL evidence
     (the Recipe v0.3 suite froze on 2026-09-08).
