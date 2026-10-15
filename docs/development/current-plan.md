# Current development plan

> Updated: 2026-10-16

This plan orders the next slices toward the [north star](../north-star.md). Each slice names the
[Eval cases](../eval/cases.md) it moves and what counts as done. The
[N sequence](../development-outline.md) keeps the acceptance rows; this plan sets the order.

## Starting point

- `main` carries the Ibis releases (v0.6.7).
- `slice/north-star` adds the north star, the Eval and the documentation rules.
- `slice/n3-n4-ma-production` (commit `951183fd`, in progress) adds:
  - the material-first AMF production path with managed work projects, real SDK/MA packages,
    Unity Bridge v5, rollback and SDK handoff;
  - Recipe v0.4 saving, sharing and overlay application;
  - the local MCP adapter, with player approval for every change;
  - independent scenario SOP, software-check and installation calls;
  - six Steam tool connections.

  Its contract and synthetic checks pass; real Unity runs come next.

## Slice 1 — Integrate

1. Merge `slice/north-star` into `main`.
2. Bring `main` into `slice/n3-n4-ma-production`. Rewrite its document additions under the new
   writing rules and align the north star with the implemented MCP adapter and SOP calls.
3. Build and run the affected checks locally; run the full suite in CI.
4. Open the pull request, reviewed by area: tools, agent adapter, AMF production.

**Done when** the branch merges into `main` with CI passing.

## Slice 2 — First real production run

1. Install Unity Hub and Unity 2022.3.22f1 on the development machine; the author completes the
   Unity sign-in and license.
2. Run the material-first path with one real Avatar and one outfit made for it. Fix each blocker
   the run exposes, starting with package-manager startup in the managed project.
3. Run the missing-shader case on the same project.

**Eval:** P-02, P-01. **Done when** both pass as closed-loop runs in the app, with evidence in
`_local_eval/`.

## Slice 3 — Player language and the production animation

1. Remove internal references and process vocabulary from UI text; add a shared four-language
   terminology table and a check for Chinese full-width punctuation.
2. Rewrite the Japanese and Korean strings for the AMF, tour and onboarding pages natively.
3. Simplify the AMF stations and keep Unity terms in technical details.
4. Build the first production animation from real run step events, then tune the stations,
   stages and timing with the author after watching real runs.

**Eval:** P-02 app run time and outside-help count. **Done when** the author reviews the AMF
journey in all four languages and completes it without outside help.

## Slice 4 — Versioned SOPs

1. Turn the static scenario SOPs into versioned SOP documents with the fields in the north star.
2. Write the first symptom-to-solution SOPs and serve them through Help and the MCP `vua_sop`
   tool.
3. Record each SOP's last verification.

**Eval:** A-03, B-02, B-03, B-04, B-05. **Done when** these cases are `ready` and pass in both
channels.

## Slice 5 — Eval runs

1. Convert the cases into machine-readable files and define the run record.
2. Run every `ready` case in the app and through an MCP agent; publish the two pass rates and
   median times with the next release.

**Done when** a release reports both metrics.

## Slice 6 — Complex production and Recipe reproduction

1. Run the N3 complex case with the author's real materials, then repeat it in a clean project.
2. Reproduce it from a Recipe in a second project, including reapplication and conflicts.
3. Run both through the MCP agent as well.

**Eval:** P-03, P-04. **Done when** the N3 and N4 acceptance rows pass.

## Slice 7 — Tool delivery by license

1. Add license, delivery-channel and verified-version fields to the tool catalog.
2. Deliver the first GitHub-only tool through the channel its license allows, with mirrors.
3. Test installation from a mainland China network on the author's remote host.

**Eval:** C-01, C-02. **Done when** both pass, including the mainland China run.

## Scheduled after these slices

Social discovery built on VRCX-0 (pain d), the remaining N1 physical rows, N5 real-account
review, and N7 clean-machine installation.

## Working arrangement

- Code, targeted Rust builds and real Unity runs happen on the development machine, one heavy
  job at a time. CI runs the full Rust, TypeScript, smoke and installer checks.
- Mainland China network cases run on the author's remote host.
- The author supplies real materials, account sign-ins and human UI review.
