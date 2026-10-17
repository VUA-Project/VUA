# North Star Eval

> Updated: 2026-10-16

The North Star Eval measures whether VUA solves real player problems. It is a set of cases, each
taken from a player's own words, with a starting state and a pass condition that can be checked.
The [north star](../north-star.md) defines what VUA is for; this Eval is how progress toward it is
measured.

## Cases

Cases live in [cases.md](cases.md). Each case has:

| Field | Content |
| --- | --- |
| ID | Stable identifier: `A-` settings, `B-` symptom to solution, `C-` tools, `P-` Avatar production |
| Player's words | The request as a player would phrase it |
| Source | Interview, community research or N-stage acceptance |
| Starting state | Software, versions, devices, project or materials needed to begin |
| Pass condition | The observable result that counts as solved |
| Verification | Closed loop or guided (below) |
| N stage | The stage whose work the case exercises |
| Status | `candidate` (proposed), `ready` (starting state reproducible, pass condition agreed) or `retired` |

**Closed loop.** VUA observes the relevant state before and after. The case passes when VUA's
post-check confirms the result, for example the Unity Bridge reporting no material with a
missing shader, or the installed tool version matching the requested one.

**Guided.** The cause sits where VUA reads no data, such as in-game state. The case passes when
VUA names the correct cause, offers the matching SOP and the player confirms the result.

## Runs

Every case runs in two channels:

- **App run.** A person who has not seen the case before follows the VUA desktop app from the
  starting state.
- **Agent run.** An agent receives the player's words and uses only VUA's MCP tools, with a
  person granting the approvals VUA requests.

A run records the date, VUA version or commit, environment, outcome (`passed`, `failed`,
`blocked` or `not_run`), elapsed time, approvals requested and any outside help used. Raw
evidence stays in the local `_local_eval/` directory; sanitized results go into release notes
and acceptance records.

## Metric

For each channel: the share of `ready` cases that passed in the latest run of each case, and the
median time to pass. Release notes report both numbers together with the list of cases run.

## Adding a case

Add it to [cases.md](cases.md) as `candidate`, keeping the player's words close to the source.
A case becomes `ready` when its starting state can be reproduced and its pass condition is
agreed. Cases drawn from interviews keep personal details out of the repository.
