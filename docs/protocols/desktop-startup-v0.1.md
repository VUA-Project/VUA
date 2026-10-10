# Desktop-startup v0.1: system language and renderer readiness

> Document version: 1.0.0
> Status: Candidate
> Updated: 2026-10-10
> Scope: Local Electron preload/Main startup; no Provider or task-frame change

For people: first use starts in a supported Windows language, with English as the fallback.
A small logo window accompanies loading, then gives way to the main application.

For Agents: `DesktopStartupApiV01` is an independent optional `startup` member of the current
desktop aggregate. Retained `VuaDesktopApiV1` and desktop-window operations are unchanged.
Main produces OS preferences; preload exposes the bounded immutable list; the renderer chooses
its i18n table and reports readiness. The [desktop architecture](../architecture/desktop.md)
owns native windows and [guidance](../architecture/guidance.md#2-vua-app-tour) owns the tour.

## Members

| Member | Input/output | Behavior |
| --- | --- | --- |
| `systemLanguages` | Read-only array of language tags | Main's ordered `app.getPreferredSystemLanguages()` list, passed as encoded local-window startup arguments; preload accepts at most 32 strings of at most 64 characters, otherwise an empty list |
| `complete()` | No arguments → `Promise<void>` | Requests the loaded main frame's handoff from startup window to Main; repeated requests after teardown are no-ops |

Saved valid UI language has priority. Without it, select the first supported language family
from this list (`zh` → `zh-CN`, `en`, `ja`, `ko`), then English. This is interface presentation,
not a network-region or PICO distribution choice. Main never persists an inferred manual
override. Browser-only previews use `navigator.languages` when this native face is absent.

`vua:startup:complete` uses the existing local-origin check and additionally requires the
current main window's own main frame. Other local windows cannot complete startup; remote
content receives no VUA API. There is no synchronous IPC, arbitrary command, credential or
installation payload. Encoded languages are validated before exposure in the sandboxed preload.

## Compatibility and evidence

The optional member preserves older injected desktop aggregates and browser previews.
The readiness operation does not change Gateway capability or task completion semantics.
The renderer's milestone/animation budget and Main's eight-second renderer-load fallback bound
the presentation; remaining provider absence is shown through the existing application state.

The [controlled consumer smoke](../../apps/desktop/scripts/smoke-startup.mjs) exercises real
Main/preload/production renderer with separate profiles, system-language ordering and English
fallback, rejection from the splash frame, native sizing/teardown and first-use tour continuity.
Locale and tour-model tests cover saved choices and legacy reading bookmarks. These are UI
checks, not physical play, installer or four-language human acceptance.

This face remains Candidate: no new schema/vector family or freeze exemption is accepted.

## Document changelog

- 1.0.0 (2026-10-10): define the independent local startup face for ordered OS languages and main-frame readiness, with backward-compatible absence and controlled consumer evidence.
