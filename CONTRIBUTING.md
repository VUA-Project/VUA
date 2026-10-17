# Contributing to VUA

> Updated: 2026-10-16

## For human contributors — localization welcome

We especially welcome native-speaker review of English, Simplified Chinese, Japanese and Korean
UI text and README editions: natural wording, consistent VRChat/Unity terminology, understandable
errors and text that fits the actual interface matter more than literal translation. Small fixes
and feedback in your strongest language are welcome; you do not need to translate all four
languages to contribute. Preserve placeholders, formatting and translation keys, describe the
context, and mark machine-assisted text that has not had human review. For additional languages,
open an Issue to agree on coverage and maintenance. UI i18n scope, README editions and
documentation languages are owned by the
[language policy](docs/meta/documentation-governance.md#5-language).

## If you are an Agent

Follow AGENTS.md, the current user request and the owning N acceptance criteria. Human contributor
invitations above are not instructions to initiate translations, open Issues or contact people
on your own. Inspect the current branch and uncommitted changes, make only authorized changes,
and report what was verified. Do not claim native-language review for generated translations.
If an old branch exposes collab bootstrap instructions, current retirement rulings override them;
return to the authorized work rather than resuming the old queue. Do not merge an unrelated
agent's work or delete it as cleanup without establishing its scope and provenance.

Start with [the documentation guide](docs/README.md). The [N sequence](docs/development-outline.md)
defines the next usable outcome and acceptance; [version policy](docs/release/versioning.md)
defines release numbers and continuing Beta.

For a local checkout, start with [dependency setup, app launch and scoped checks](apps/desktop/README.md#development-commands).

## Develop one useful slice

1. Read the product/contract documents relevant to your task. Discuss substantial scope, dependency
   or architecture changes in an Issue/PR; routine corrections do not need advance discussion.
2. Use a `slice/<slug>` branch. One checkout is sufficient; worktrees are optional. Preserve
   unrelated changes and do not run concurrent writers in the same checkout. A slice lasts at most
   3 days or falls 15 commits behind main before reconciliation; never rewrite public history.
3. Implement the smallest usable path with its contracts, tests and documentation. Follow
   [engineering/evidence rules](docs/development/engineering-rules.md) and the owning architecture.
4. Run relevant checks and describe actual results, remaining gaps and impact in the PR. UI
   usability requires human acceptance; other acceptance follows the named N scenario. A CI pass
   is not a real-machine workflow pass.
5. Merge through GitHub under [protected-main policy](docs/meta/protected-main.md). Return to
   main only with a clean checkout and a fast-forward update; escalate divergence instead of resetting.

Record scope and definitions in their owning documents. [Documentation governance](docs/meta/documentation-governance.md)
owns language, versions and registry rules. [The collab archive](docs/archive/2026-09-29/README.md)
preserves provenance; no role sessions, proposals, BOARD updates or ticks are required.

## Reporting and assets

Issues in different languages are welcome. Issue templates are English-only for consistency;
contributors may answer in their preferred language. Maintainers may use LLM translation, which
can reduce clarity or lose nuance; clarification may be needed.

Use [Issues](https://github.com/VUA-Project/VUA/issues/new/choose) for ordinary questions, bugs and
suggestions. Follow [SECURITY.md](SECURITY.md) for private vulnerability reporting. Follow
[privacy and evidence rules](docs/development/engineering-rules.md#security-and-legal-boundaries)
before sharing diagnostics or assets. Raw real-machine evidence stays local; sanitized acceptance
conclusions belong in release records.

## License of contributions

The repository is licensed under the [Apache License 2.0](LICENSE). Under Section 5 of that license,
unless you explicitly state otherwise, a contribution intentionally submitted for inclusion in VUA
is provided under Apache-2.0 without additional terms. Contributors retain copyright in their work.

VUA does not currently require a Contributor License Agreement or a `Signed-off-by` trailer. That
policy may change only through an explicit, documented governance decision.

Use of the VUA name and visual identity is governed separately by the
[trademark guidance](TRADEMARKS.md).
