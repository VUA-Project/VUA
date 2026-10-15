# Versioning policy

> Scope: VUA product releases, tags, packages, and public contracts
> Updated: 2026-10-13

## Product version

VUA product releases follow [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html):
`MAJOR.MINOR.PATCH`, with optional pre-release and build metadata.

- Git release tags use `vMAJOR.MINOR.PATCH`; the `v` is a tag prefix, not part of the SemVer value.
- `0.y.z` is initial development. Public contracts can still change incompatibly, but every breaking
  change must be explicit in release notes and accompanied by the owning protocol/schema/migration.
- Under the 2026-09-30 user ruling, N stages define delivery outcomes and acceptance, not product
  version numbers. Select the release version from its actual changes before publication.
- No `1.0.0`, stable release, or production-safety commitment is scheduled. Only an explicit
  request from the author can change the continuing-Beta policy.
- A published tag and artifact are immutable. Any change is a new version.
- A git tag marks a revision; a tag alone is not a publication. A *published release* is a GitHub
  Release, and a *published artifact* is an installable asset attached to one. Verified mirrors
  may serve the same immutable artifacts with the same version/build/digest; they do not create
  a second release identity. The independent AMF payload rule below also applies to module
  release records. Recorded state
  (2026-10-01): `v0.6.0` is a tag without a GitHub Release, and the only published Release,
  `v0.5.0`, carries no assets — no installable artifact has been published yet.

## Continuing Beta and independent delivery stages

Beta is lifecycle metadata rather than an automatically appended SemVer suffix.
Do not generate v1.0.0 candidates or stable claims from earlier M plans.
Historical tags/artifacts and their original stage labels remain unchanged; adoption of this plan
does not itself bump the current package version or create a release.

The [development sequence](../development-outline.md) owns N1-N7 outcomes and acceptance.
One stage may span several releases, and a release may include useful slices from several stages.
Partial delivery may be released with its remaining acceptance explicit; neither publication nor
a version increment closes a stage. Completion requires its actual acceptance evidence.
Known non-blocking defects may ship with impact/workaround/follow-up disclosed. A pass covers
recorded scenarios, not production safety or all Windows versions. Non-UI acceptance can be
agent-driven; human acceptance is required for UI usability. Private real-run artifacts stay local.

## Selecting a release version

The author explicitly selected **v0.6.6 Ibis** for current-state publication on 2026-10-11.
That number overrides the automatic minor/patch selection convention for this release only.
It remains a continuing-Beta release; publication does not pass pending N stages. NSIS and
independent AMF incremental updates follow this current ZIP release.

The author then explicitly selected **v0.6.7 Ibis** for NSIS/update delivery and the reviewed
library fixes. That selection is a release-specific exception to the automatic minor/patch
convention, not a change to it. AMF starts its separate payload version at **0.1.0**; neither
number declares N-stage or clean-machine/human acceptance complete.

Compare the release candidate with the last published release, not with an N-stage number.
Identify the public application behavior/contracts and any stored-format compatibility changes;
select and record the version before tagging and publishing. Planned version targets are tentative
and may change before publication. Do not reserve a version for each N stage.

During `0.y.z` development, VUA uses this project convention:

- New user-facing capabilities or breaking application/compatibility changes increment the minor
  version and reset the patch to zero. Disclose breaking changes and required migration separately;
  a `0.x` increment does not promise a stable public API.
- Backward-compatible fixes, documentation or packaging corrections to an existing released
  capability increment the patch. Documentation edits alone do not require a product release.
- If a release includes both kinds, use a minor increment. Evaluate changes against the last
  published release even when the work crosses several N stages.

SemVer permits an unstable public API during major-zero development; the convention above gives
VUA predictable release meaning. Only after the author explicitly authorizes `1.0.0` does the
stable-API rule apply: incompatible public API changes increment major, backward-compatible new
functionality increments minor, and backward-compatible fixes increment patch.

Release notes identify delivered slices, relevant N acceptance evidence and pending requirements.
Protocol, schema, persistence and document versions remain independent; product numbering does
not authorize editing a frozen format in place.

## What is independently versioned

Product SemVer does not replace protocol or storage versions:

| Versioned object | Rule |
| --- | --- |
| Desktop product and installer | One product SemVer and one release source of truth |
| Git tag | `v` plus the exact product SemVer |
| Orchestrator Provider | Built and distributed with the matching desktop release; reports transport, build, protocol, and product compatibility |
| First-party AMF payload | Independent SemVer/build and immutable release manifest; explicit host, protocol, Bridge and stored-format compatibility. Installing with VUA does not require future AMF updates to increment the host version |
| Electron runtime | Exact upstream version/platform/architecture/digest; reused only when the required compatible runtime identity matches |
| Unity Bridge | Own machine-readable protocol/package version; compatibility declared explicitly |
| Gateway and community plugin protocol | Own machine-readable contract version; compatibility cannot be inferred from product SemVer alone |
| Recipe, Build Record, persistent schema | Own format/schema version and migration or rejection behavior |
| Private workspace packages | Need not imply a public API; their versions follow release tooling policy |
| Third-party implementation dependencies | Exact dependency versions in the lockfile/inventory; never presented as VUA versions |

The release pipeline generates or verifies the product version across the desktop manifest, Provider
metadata, installer, diagnostic output, and release artifact. Manually maintained duplicate
version strings are not authoritative.

Under the [2026-10-11 delivery ruling](../product-boundary.md#windows-delivery-and-amf-updates-user-ruling-2026-10-11),
each installer records its compatible host/AMF/runtime baseline, and an independent AMF release
records its own version, source/build identity, compatibility, notices and complete verified
payload. The product version remains the host/desktop version; UI and diagnostics identify the
currently installed AMF separately. Module release records/manifests are immutable and mirrors
preserve their identity. Define the concrete manifest and any namespaced module tags before the
first independent publication; this decision does not assign a new product or AMF version.

Payload version does not authorize rewriting frozen protocol or BDL formats. Every relevant
compatibility change follows its owning version/migration rules. Independent payload publication
does not declare N3-N5 or N7 accepted. The [distribution plan](../development/windows-distribution-plan.md)
records pending implementation and validation work.

## Compatibility and communication

- Each public release has release notes; this rule applies going forward. Tag `v0.4.0` predates it
  and has no release notes — the notes series starts at `v0.4.1`. Breaking `0.x` changes name the
  affected API/format and the required migration or reset behavior. Release notes name the
  released commit and the contract versions the release serves, and are written in the languages
  set by [documentation governance](../meta/documentation-governance.md#5-language).
- Deprecation is documented before removal wherever users or community developers need a migration
  window.
- Build metadata such as `+sha.<commit>` may identify CI artifacts but does not affect precedence or
  compatibility.
- Marketing stage names (`pre-alpha`, `alpha`, `beta`, `stable`) never replace the numeric version.

## Third-party changes and compatibility

Third-party integrations may require changes to VUA's application protocols, persisted formats,
and supported version combinations during Beta. This is advance notice of possible change, not
an authorization to silently break an existing contract or a promise to support every upstream
version. Keep vendor-specific types and version handling behind adapters.

For each concrete integration/update, record the upstream version/build, affected operations,
compatibility impact, and verification evidence in the owning implementation slice. Adapter-only
changes do not require a speculative protocol bump. A normative change to a frozen wire/storage
face requires a new explicit version with schemas, producers, consumers and tests updated together;
retain the old definition and state migration, continued support, or explicit rejection behavior.
Release notes explain user action and affected versions before users take the update. Do not
reserve invented fields or promise universal downgrade solely because upstream might change.

Licensing is separate from wire compatibility. VUA's repository license does not replace a
third-party component's license. Before bundling or changing a dependency, record the exact
source/version, applicable terms, notices, redistribution/update/removal requirements and any
excluded components. Keep notices consistent with the actual distributed build. Do not announce
a future VUA license change merely because an integration is planned; any proposed change needs
an explicit decision based on the selected code and distribution. N2 guides Steam library addition
and installation, then invokes independently installed official tools through supported external
entry points. Upstream distributions retain their own licenses; follow
[third-party notices](../../THIRD_PARTY_NOTICES.md) for any future redistribution.
