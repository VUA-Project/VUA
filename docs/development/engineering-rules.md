# Engineering and evidence rules

> Scope: Existing implementation and evidence safeguards extracted from AGENTS

Delivery scope and acceptance belong to the [N sequence](../development-outline.md);
architecture belongs to the [system map](../architecture/system.md). These rules retain the
existing safeguards while allowing small, usable slices and explicit non-blocking gaps.

## Honesty discipline

Each rule ships with its check. When a claim cannot be checked, report it conservatively.

1. **The empty state is the final state.** UI surfaces render only data the Gateway actually
   returned; an absent or empty result renders the designed empty state, never guessed or
   placeholder content. Check: renderer pages source every displayed value from Gateway snapshots,
   and the fixture-free production bundle still renders honest empty states.
2. **Failures are presented as failures.** A failed, partial, or simulated run is reported as such;
   mock or fixture outcomes are never presented as real results. Check: status surfaces,
   diagnostics, and release notes cite the actual run, and simulated peers are labeled as
   simulations in both UI and reports.
3. **Recovery never resumes implicitly.** A task found in a non-terminal state after restart or
   drift surfaces as `inspect_required` and waits for an explicit decision; it never silently
   continues. Check: recovery maps non-terminal tasks to `RecoveredDisposition::NeedsInspect` /
   `inspect_required`, and restart-recovery tests assert that no implicit resumption occurs.
4. **Mocks and fixtures never leave DEV.** Fixture gateways and demo data exist only behind
   development gates. Check: `import.meta.env.DEV` gating plus dead-code elimination in the
   production build, and `pnpm --filter @vua/desktop check:leak` fingerprint-scans the production
   bundle for fixture payloads.
5. **No end-to-end claim without real-machine evidence.** Declaring a flow verified end-to-end
   requires citing the real run (date, environment, artifacts, evidence location); otherwise report
   exactly what was and was not exercised. Check: gate acceptances and release notes name their
   evidence, and "evidence kept locally" entries point to real local output.

## Security and legal boundaries

For VRChat interaction and authentication, follow the [product boundary](../product-boundary.md#vrchat-interaction-and-privacy).
The README explains these constraints to players; it does not authorize new API operations.

- Never commit paid assets, paid `.unitypackage` content, user Unity projects, cookies, tokens,
  order data, production databases, private logs, credentials, or `.env` files.
- BOOTH access uses the user's own local session and authorization. Do not bypass purchase, payment,
  age, authentication, or access controls.
- Credentials and purchased files remain local and are never relayed through project-operated
  servers.
- Repository and cloud-CI tests use structurally representative synthetic data without real product
  or user content. Local read-only compatibility tests may access public BOOTH pages. Local Unity
  integration and smoke tests may use assets lawfully obtained by the developer; assets, projects,
  page captures, configuration, logs, and outputs remain local.
- Before bundling a third-party binary, audit its license, redistribution terms, update source,
  signatures, notices, and removal path.

## Implementation discipline

- Define the owning contract before cross-module changes. Keep vendor adapters and Electron handlers thin.
- Add regression tests for correctness and recovery defects; run checks relevant to each slice.
- Long operations must be observable, cancellable, recoverable and safely retryable where permitted
  by the contract. Capability detection takes precedence over assumptions about installed software.
- Every dependency has an owner, purpose, license and removal path.
- Keep one vertical capability together: schema, Rust, TypeScript, tests and documentation.
  Synchronize contracts through Git merges, not manual copies between branches.
- Do not widen community plugin execution privileges without a separately accepted isolation decision.
- Never report a known failed test or simulated flow as a pass to close a gate.

## Ownership safeguards

Use the system map for the six-crate layout: new adapters belong in their owning crate, not in
the application core. Framework/vendor types stay behind domain ports. Desktop/VR overlays
consume application services and never host business decisions. Trusted core modules use explicit
VUA-owned composition; community extensions cannot receive its in-process authority.
Catalog classification is core/plugin/external; registration grants no execution or distribution
authority, and release risk is derived by the gate rather than self-assigned. These constraints
are carried forward from the previous workspace instructions, not new product scope.
