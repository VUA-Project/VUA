# Website tests v0.1

> Document version: 0.1
> Status: Candidate
> Family: website-tests

Additive query/capability `environment.testWebsites`, carried by application contract v0.1 and
Desktop Gateway v1. The existing `environment.checkNetwork` regional query remains unchanged.

Request params contain only `{ urls: string[] }`: one to twelve unique HTTPS URLs, at most
2048 characters each, without credentials, fragments or nonstandard ports. No cookies, custom
headers, script or shell arguments are accepted. Both TS boundaries and the Rust Provider
validate the request. Invalid params return `vua.network.invalid_intent`; absent composition
returns `vua.network.unavailable`, using `errors.network.failed`.

Success contains only `{ websiteTests: WebsiteObservation[] }`, exactly one result per URL in
request order. Each observation has `url`, nonnegative integer `elapsedMs`, `status` and
nullable integer `httpStatus`. Status/code pairs are `reachable`/200–299, `redirected`/300–399,
`http_error`/400–599, or `timeout`, `connection_failed`, `probe_error` with null status code.
An HTTP denial remains a response, not a successful website test. Transport errors contain no
raw logs or response bodies. Partial failures preserve the other observations.

The Rust adapter runs the batch concurrently and bounds redirects and elapsed time. Requests
carry no browser session. A HEAD refusal (405/501) falls back to GET response headers only.
Local website preferences are UI state; no results or account data are persisted by this query.

Schema: [website-test.schema.json](../../schemas/website-tests/v0.1/website-test.schema.json).
Implementation: [types and guards](../../packages/contracts/src/website-test.ts),
[Provider route](../../crates/provider-host/src/network_routes.rs),
[adapter](../../crates/project-manager/src/network_probe.rs).

## Document changelog

- 0.1 (2026-10-07): introduce selected/custom website tests for the compact play-environment cards.
