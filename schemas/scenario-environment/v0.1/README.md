# Scenario environment v0.1

Candidate. [Owning protocol](../../../docs/protocols/scenario-environment-v0.1.md).
`request.schema.json` describes the application query envelope; `result.schema.json` describes
successful result bodies. Examples/results include positive and negative vectors. Runtime
guards additionally check required-component completeness and readiness/next-action consistency.

Consumers: `scenario_environment_wire`, `scenario_environment`,
`packages/contracts/src/scenario-environment.test.ts`, and the independent desktop read-port test.
