# Protected-main integration policy

Collab is archived and retired as of 2026-09-28. Its special checkout/coordination duties below
are historical and inactive; ordinary branch-and-PR development is the only current workflow.
The user authorized transfer to VUA-Project on 2026-09-28. Update the remote only after verifying
the same repository identity at its new owner; never recreate or mirror-push a replacement.

This policy supersedes older local-main merge/direct-push instructions in collab, role prompts,
.zcode agent prompts, and recurring prompts. Read it before any integration action.

1. All work uses a feature branch and GitHub PR. Ordinary development may switch branches
   in one checkout; linked worktrees are optional. Never commit, merge or push directly on main.
2. Merge through GitHub only after applicable tests and required checks succeed and review
   conversations are resolved. Preserve merge commits; do not rewrite public history. Current
   single-maintainer staffing does not require an independent approving review. Another agent
   using the same account is not an independent reviewer.
3. After a remote merge, fetch and fast-forward the canonical main checkout. Stop and report if
   main diverged or local changes obstruct the update; never reset or discard another process's work.
   Ordinary checkouts follow the same fast-forward-only rule when returning to main.
4. (Retired with the collab archive, 2026-09-29; historical.) Collab-only changes used a PR,
   preferably batched with an existing integration, with no extra local full-suite run beyond
   the remote required checks; idle rounds created no commits, PRs, syncs, or status churn.
   Documentation checks now ride with ordinary PRs.
5. (Retired with the collab archive, 2026-09-29; historical.) Before server enforcement, the
   designated operator obtained acknowledgment that integration and automatic main-push helpers
   were paused. No automatic main-push helpers are active; never treat silence as acknowledgment.
6. Required checks are selected only after real PR evidence. Do not bypass failed/pending checks,
   manufacture approvals, or recreate a repository after an access failure. If protection needs
   emergency adjustment, stop automatic integration and obtain an explicit user ruling; record
   the exact change and restoration. There is no standing agent/admin bypass.
7. The user released the organizational-transfer review hold on 2026-09-29, subject to the
   requested README and Issue-template corrections. Preserve repository identity and history. Never create VUA-Project/VUA as a placeholder or
   recreate VUA-PHR/VUA after transfer. Never independently change remotes, mirror-push, delete
   repositories, or reinitialize worktrees to recover access. Report access failures to the operator.

The foundation assignment contains the full transfer invariants and cutover checklist:
[historical execution context](../archive/2026-09-29/collab/assignments/2026-09-22-repository-foundation_EN.md).

## Development and integration identities (user ruling, 2026-10-11)

After publishing v0.6.6 Ibis, development commits, feature-branch pushes and PR creation use
the author's personal GitHub account. Retain the existing organization publishing identity
only for merge confirmation. Preserve repository identity, history, existing credentials and
the branch/PR/check rules above. Account switching does not authorize direct main writes,
repository recreation or silent use of the integration identity for development.

For **v0.6.7 only**, the user authorized VUA-PHR to publish the release on 2026-10-13,
because the personal development account Aran52 currently has read-only access to the
canonical repository. This publication exception does not grant collaborator permissions
or change the personal-account development and organization-account merge responsibilities.
