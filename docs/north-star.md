# VUA north star

> Updated: 2026-10-16 (author's ruling)

## Goal

VUA turns a VRChat player's request — "I want to…" or "something is wrong" — into a versioned
SOP based on the real state of their computer, carries it out safely, and records the result so
it can be repeated.

Players use VUA through the desktop app. An AI agent working for a player uses the same
capabilities through MCP. Both receive the same facts, the same SOPs and the same permission
rules.

## What VUA provides

| Layer | What it provides |
| --- | --- |
| Observe | Facts about the local VRChat environment: installed software and versions, relevant settings, devices, readable logs, Unity projects and task state. Each fact carries its source and observation time, and unknown values are reported as unknown. |
| Know | SOPs that map a goal or a symptom to ordered steps. Each step has an expected result, a verification check and the next action on failure. |
| Act | Plan, preview, confirm, execute, re-check and recover. Long work runs as durable tasks; Unity changes go through the versioned Unity Bridge. |
| Reproduce | Task history for environment work, Build Records for Avatar production, and Recipes that rebuild an Avatar in another project. |

## Problems solved first

Interviews with Chinese-speaking players and research on English, Japanese and Korean player
communities (October 2026) agree: Steam already makes installing and starting VRChat easy.
Players get stuck after that.

**a. Settings live in many layers.** Common settings are spread across VRChat, SteamVR, the
headset's PC software, companion tools and Windows. VUA shows where each common setting lives,
reads its current value where possible and opens the place to change it. Examples: Meta/Oculus
streaming quality, OVR Advanced Settings space drag, VRChat safety and performance options.

**b. Symptoms do not lead to solutions.** Tool messages and VRChat's own rules — trust rank,
Shield and Safe Mode, cross-platform fallbacks, performance ranks, upload eligibility — produce
effects far from their cause. VUA goes from symptom to cause to solution: it reads the evidence
it can observe, names the cause and offers the SOP that fixes it. Example: VRCFaceTracking
reports that an older Avatar's face-tracking parameters are unsupported; the fix is an Avatar
change that AMF performs.

**c. Small tools have no common distribution channel.** Beyond a few Steam applications, useful
tools spread by word of mouth, and GitHub downloads are unreliable in mainland China. VUA keeps
a reviewed tool catalog and installs, updates and launches each tool through the channel its
license allows, including verified mirrors.

**d. Finding people and things to do.** Scheduled after a–c: social discovery built on an
adaptation of [VRCX-0](https://github.com/Map1en/VRCX-0) and its exported data for matching
players. Meanwhile, Help points newcomers to existing newcomer communities and events.

**Avatar production (AMF).** Japanese and Korean newcomers name Avatar editing as their biggest
hurdle: matching outfits to Avatars, missing shaders, and setting up Unity, VCC/ALCOM and the
SDK. AMF produces and reproduces an Avatar from the player's own materials, so the player works
with outfits and choices rather than Unity assets, shaders and prefabs. The player sees a few
factory stations, starting from:

| Station | Meaning for the player |
| --- | --- |
| Warehouse | The materials I own |
| Recipe | The Avatar I want |
| Workshop | VUA builds it |
| Release | Ready to upload in the VRChat SDK |

A short production animation shows the work: each movement corresponds to a completed step,
driven by the same task events an agent reads. The stations, animation stages and timing are
tuned during development from real runs. Unity terms appear only in an expandable
technical-details area.

## AI agents

VUA runs an MCP server on the player's computer. The player's own agent supplies conversation
and planning; VUA supplies facts, SOPs, operations and verification. The first MCP slice exposes
read-only observation.

| Level | The agent can | Granted by |
| --- | --- | --- |
| Observe | Read facts, SOPs, tasks and records | Enabling MCP access in VUA |
| Prepare | Create plans, previews and dry runs | Enabling MCP access in VUA |
| Act | Execute a plan | The player approving that plan in VUA |
| Protected | Run high-risk steps as defined by the [risk gate](tool-catalog/risk-gate-v1.md), such as process termination or elevation | The player confirming each step in VUA |
| Player only | Sign-in, purchases, license acceptance, final VRChat upload | The player, in the official application |

Standing approvals for selected low-risk operations are defined with the first MCP slice that
executes changes. Task history records which client started each task. Tool results contain the
facts the operation needs; material files, account data and screenshots stay on the computer.

## SOPs

An SOP is a versioned document, tagged like a Recipe. A changed step produces a new version, and
every task or record that used an SOP references the exact version.

Each SOP records:

- a stable ID, version and title;
- where it applies: software and version ranges, devices, region;
- prerequisites;
- ordered steps, each with its action, expected result, verification check and next action on
  failure;
- who performs each step: VUA, VUA opening the right place, or the player;
- the last verification: date, environment and software versions;
- its source.

Structured fields are English. Player-facing text is written in English, Simplified Chinese,
Japanese and Korean.

## External tools by license

| Tool license | How VUA delivers it |
| --- | --- |
| Permissive open source (MIT, Apache-2.0, BSD and similar) | Mirrors the exact upstream release with its license and notices, verifies the hash against upstream, then installs, updates and launches it |
| Copyleft open source (GPL, LGPL, MPL and similar) | Mirrors the unmodified release together with its corresponding source and license text, then installs, updates and launches it |
| Free to use without an open-source license, including repositories without a license file | Downloads from the official source when the player asks and verifies the file; mirrors only with the author's written permission |
| Paid or store-distributed (Steam, BOOTH and other stores) | Hands purchase and installation to the store, then discovers, launches and observes the installed copy |

The [tool catalog](tool-catalog/README.md) adds license, delivery-channel and verified-version
fields to its entries with the first mirrored tool, and records the license review for each
mirrored release.

## North Star Eval

The [North Star Eval](eval/README.md) is a set of real player problems, each with a verifiable
pass condition. Every case runs twice: through the desktop app with a person, and through MCP
with an agent. The share of cases solved and verified in each channel is VUA's north-star
metric.

## Relation to the N sequence

The [N sequence](development-outline.md) schedules the work; the Eval measures the outcome.

| N stage | Contribution |
| --- | --- |
| N1 | Observe and prepare play environments; settings (a) |
| N2 | External tools and their delivery channels (c) |
| N3 / N4 | Avatar production and Recipe reproduction in AMF |
| N5 | Material library and BOOTH acquisition in AMF |
| N6 | Recovery for every delivered path |
| N7 | Installers, releases and the illustrated guide |

Symptom-to-solution SOPs (b) grow with N1, N2 and N3. An N-stage acceptance run that matches an
Eval case is recorded as a run of that case.
