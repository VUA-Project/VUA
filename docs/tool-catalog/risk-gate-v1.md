# VUA Catalog Risk Gate v1

> Rule ID: `vua.risk-gate/v1`
> Scope: `core / plugin / external` catalog entries
> Updated: 2026-10-02

## Gate algorithm

Before an entry becomes `supported` or is included in a release, the gate:

1. validates the v3 schema, category, capabilities, distribution, and behavior description;
2. compares declared capabilities with described data flow, permissions, side effects, and reviewed implementation;
3. blocks missing, unknown, ambiguous, or under-declared capabilities with `risk: pending`;
4. evaluates every matching rule and selects the highest level;
5. writes or verifies `risk` and `risk_rule`; a contributor-supplied mismatch fails the gate;
6. checks the warning, confirmation, refusal-test, rollback, and approval evidence required by that level.

## Derived rules

| Level | Matching behavior | Required release evidence |
| --- | --- | --- |
| High | Process termination; elevation; security or anti-cheat interaction; credential/session/private-order access; arbitrary code execution; irreversible or broadly scoped system/project mutation | Dedicated warning, explicit confirmation per dangerous action, tested refusal and safe default, security-owner approval |
| Medium | Scoped reversible writes; official installer launch; device/audio/screen input; user data sent to a service; external runtime connection/control; non-trivial Unity/project transformation | Permission disclosure, cancellation/degradation test, data and rollback review |
| Low | Read-only public metadata/status or presentation-only behavior with no private content, system mutation, external data transmission, or privileged capability | Boundary test and ordinary review |

Boundary never lowers risk. External software can still be medium or high because the field describes
user and release risk, not only VUA authority. When evidence matches no known rule, the result is
`pending`, not `low`.

## Current derived examples

- EAC residual-process recovery is **high** because it can terminate a process and interacts with an
  anti-cheat recovery scenario.
- Environment deployment is **medium** because it may launch installers and perform confirmed scoped changes.
- Live translation and voice changing are **medium** because they may send selected text or access audio devices.
- VUA skins are **low** only while limited to validated presentation tokens/assets with no code execution.
