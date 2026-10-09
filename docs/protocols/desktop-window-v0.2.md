# Desktop-window v0.2: main Help navigation

> Document version: 1.0.0
> Status: Candidate
> Updated: 2026-10-10
> Scope: Local Electron preload/Main navigation; no Provider or task-frame change

For people: preparation chapters and hardware introductions open inside the main Help page,
with the same reading bookmark. They do not create another reader window.

For Agents: `DesktopWindowApiV2` extends the retained `DesktopWindowApiV1`.
`VuaDesktopApiV2` changes only the type of its `window` member; the V1 interface remains intact.
The producer is Electron Main/preload and the consumer is the main renderer's App shell.
[Guidance architecture](../architecture/guidance.md) owns the presentations and progress.

## Operations and events

| Member | Input/output | Behavior |
| --- | --- | --- |
| `showEncyclopedia(target?)` | Optional `GuideTargetV1` or null → promise of `{ visible: boolean }` | Explicitly restores/focuses Main and requests its Help encyclopedia page; never creates a reader window |
| `encyclopediaTargetEvents.subscribe(listener)` | Listener receives `GuideTargetV1` or null; returns unsubscribe | Main-target delivery after the local main renderer is listening; unsubscribe is idempotent and does not remove other subscribers |

A target contains a nonempty `topic` string of at most 64 characters and an optional `section`
string of at most 64 characters. Main reuses `parseGuideTargetPayload`: malformed shapes reject
with `invalid guide target`; unrelated object fields are not forwarded. Null/undefined means
ordinary reopening and restores the reading bookmark. The renderer owns the content vocabulary,
falls back safely for unknown identifiers, and consumes each target with a local nonce/ack.

`visible: true` means a live main window was available and the navigation request was accepted;
it does not prove the chapter rendered, software readiness or guide completion. A missing or
destroyed main window returns `visible: false` without creating another window.

## Delivery and trust

- `vua:knowledge:show` accepts only the existing trusted local sender origin. External content
  receives no VUA preload capability.
- `vua:knowledge:listening` accepts a boolean only from Main's own main-frame WebContents at the
  allowed local origin. Child frames and other local windows cannot declare Main ready.
- Main keeps only the latest pending target until listening is established. A pending null is
  a real reopen request, distinct from no request. Full document navigation resets readiness;
  hash/page navigation leaves the current subscription intact. Closing Main clears transient state.
- `vua:knowledge:target` is sent only to Main. Preload registers the listener before announcing
  readiness, and reports unavailable only after its final subscription is removed.
- This navigation face grants no filesystem, installer, account, plugin, AMF or task authority.
  Reading uses the existing local topic/section bookmark and shared four-language content.

## Compatibility and evidence

Retain V1 `showReader`, reader events, game-guide and task-window behavior. Existing V1 callers
still get the ordinary separate reader window; current preparation UI entries use V2. The game
guide retains its own native following/opacity lifecycle. No frozen Provider, stored task or
reading-bookmark schema is changed by this face.

Types live in [desktop-gateway.ts](../../packages/contracts/src/desktop-gateway.ts); both ends live
in [Main](../../apps/desktop/src/electron/main.ts) and [preload](../../apps/desktop/src/electron/preload.ts).
The [controlled consumer smoke](../../apps/desktop/scripts/smoke-help-navigation.mjs) exercises
Play → hardware, contextual requests across page changes, multiple subscriptions, reading return,
same-window behavior, appearance and big-screen layout. Existing target-validation and reading
tests retain malformed-input and positioning cases. Physical-headset and four-language human
review remain release evidence, not results established by these checks.

This face remains Candidate: TypeScript shapes and consumer checks are executable, but no new
machine-readable schema/vector family or freeze exemption has been accepted.

## Document changelog

- 1.0.0 (2026-10-10): define the additive v0.2 main Help navigation face with queued local targets, explicit compatibility and controlled consumer evidence.
