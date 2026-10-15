# Documentation governance

> Updated: 2026-10-16

## 1. Document types

| Type | Location | Versioning |
| --- | --- | --- |
| Entry and goal | README editions, `AGENTS.md`, `CONTRIBUTING.md`, `docs/README.md`, `docs/north-star.md` | Git history |
| Product scope | `docs/product-boundary.md`, `docs/compatibility/` | Git history |
| Plans and measurement | `docs/development-outline.md`, `docs/development/`, `docs/eval/` | Git history |
| Architecture and design | `docs/architecture/`, `docs/design/` | Git history |
| Contracts | `docs/protocols/`, `schemas/` | Own version per contract (§2) |
| Decisions | `docs/decisions/` | Immutable; replaced by a new decision |
| Release notes | `docs/release/` | One set per product release, kept as published |
| Archive | `docs/archive/` | Historical records, kept unchanged |

[AGENTS.md](../../AGENTS.md) defines the order of authority between these documents.

## 2. Contracts

A contract document defines wire or storage behavior and carries its protocol or format version
and status:

- **Draft:** being written.
- **Candidate:** exercised by code; freeze prerequisites still being completed.
- **Implementation baseline:** the version current code is built and verified against.
- **Accepted:** in force; used for decisions and contracts that predate the freeze record.
- **Frozen:** stable. A normative change creates a new version; the previous version stays
  available with its consumers.
- **Superseded:** replaced by a named successor and kept for reference.

A contract is frozen once the repository contains its machine-readable schema (or a recorded
exemption), positive and negative test vectors, and at least one consumer test. Contract
documents keep their own changelog.

## 3. Other documents

Every other document describes the current state, and Git keeps its history. Its header may
carry `> Updated: YYYY-MM-DD`, a one-line `> Scope:` and, until the document is accepted, a
`> Status:` such as Draft or Backlog. Version numbers and changelog sections belong to
contracts only.

## 4. Registry

[REGISTRY.md](../REGISTRY.md) lists contracts, schema directories and decisions with their
version, status, owner and last review date. A registry row changes in the same commit as the
contract it describes.

Release notes name the released commit and the contract versions the release serves.

## 5. Language

- **Documentation, contracts, schemas, source code, comments, commit messages and pull
  requests** are written in English. Literal UI strings, source-language examples and official
  license texts keep their original language.
- **README and release notes** are written natively in English, Simplified Chinese, Japanese and
  Korean: `README.md`, `README_ZH.md`, `README_JA.md`, `README_KO.md`, and release notes
  `vX.Y.Z.md`, `vX.Y.Z_ZH.md`, `vX.Y.Z_JA.md`, `vX.Y.Z_KO.md`. Each edition is written for its own
  readers. An edition drafted with machine assistance carries the note "awaiting native review"
  until a native speaker reviews it. Release notes up to v0.6.7 stay in Chinese as published.
- **Desktop UI** text uses the i18n system in English, Simplified Chinese, Japanese and Korean,
  with one shared terminology table. Each language is written natively for its players. More
  languages can be added.
- **SOP** player-facing text follows the UI languages; its structured fields are English.

The local `docs-zh/` mirror is retired.

## 6. Writing style

- Describe what the product, component or process does and how to use it.
- State verified facts with their environment and date, for example "Verified on Windows 11 with
  Unity 2022.3.22f1 on 2026-10-20".
- Collect limitations and pending work in one place: the release notes' known issues, the N
  sequence status table or the acceptance record.
- Link to the document that owns a rule instead of restating it.
- Player-facing text uses the player's vocabulary. Section numbers, proposal numbers, ruling dates
  and internal component names belong in developer documents and code.
- Developer documents cite contract and schema versions, product versions and decision documents.
  Identifiers from the retired collaboration process stay in the archive.
- Code comments explain intent and constraints; history belongs in Git.
- A commit message is a subject line and a short body. Test evidence goes in the pull request.

## 7. Local environment and evidence

Machine inventories live in the gitignored `_local_environment/` directory, raw real-machine runs
in `_local_real_machine/`, and Eval runs in `_local_eval/`. Each record states the observation
date, software versions, evidence source, and whether the entry was reported, detected or
exercised. Paths, accounts, device identifiers, raw logs and private material stay local; public
documents record the scenario, versions, procedure and sanitized result.

## 8. Archive and retirement

Move a document to `docs/archive/` when it no longer describes current work, together with a
pointer to its replacement. Before retiring a contract version, check its schema, test and
runtime consumers; older contract versions can still be served. Archived content keeps its
original wording.

## 9. One owner per rule

The product boundary owns scope, the N sequence owns delivery outcomes and acceptance, the Eval
owns measurement, release policy owns versions, architecture owns responsibilities, protocols own
wire and storage behavior, and engineering rules own implementation and evidence safeguards.
Other documents link to these owners.
