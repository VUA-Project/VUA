# VUA Desktop App (@vua/desktop)


> Status: Accepted
> Scope: Electron Main / Preload / Renderer, package scripts, and quality gates
> Updated: 2026-10-04
> Authority: development entry point; product boundary and contracts live in `docs/`

## Development commands

Run commands below from the repository root. The current [Windows CI baseline](../../.github/workflows/ts.yml)
uses Node.js 24 and Rust 1.97.1; [package.json](../../package.json) pins pnpm 11.19.0.
Install the Windows Rust/MSVC build prerequisites before starting: the initial desktop build
also compiles the Rust Provider. Unity and user accounts are needed for their corresponding real
flows, not for editing the desktop shell.

```powershell
pnpm install --frozen-lockfile
pnpm --filter @vua/desktop build
pnpm dev:desktop
```

This launches the development app, not a verified user installer. For a change, choose the relevant
checks below; documentation-only edits need document/link checks rather than a local full build.
The existing remote PR workflow still determines its own required checks.
The development launcher does not rebuild the Rust Provider; repeat the build after backend changes.

| Command | Purpose |
| --- | --- |
| `pnpm dev:desktop` | Joint Main + Renderer development launch |
| `pnpm --filter @vua/desktop typecheck` | Strict type check for both renderer and electron tsconfigs |
| `pnpm --filter @vua/desktop test` | vitest unit tests |
| `pnpm --filter @vua/desktop build` | Builds `@vua/orchestrator-provider` first, then emits to `dist/` |
| `pnpm --filter @vua/desktop check` | typecheck + test + build + boundary, i18n, contrast and leakage checks |
| `pnpm --filter @vua/desktop smoke:remote-permissions` | Real remote permission smoke (evidence written to `_local_m1/<version>/`, not committed; the `_local_m*` directory names are historical M-line naming) |
| `pnpm --filter @vua/desktop start` | Build, then launch the unpacked app with Electron (`pnpm build && electron .`; no installer is produced) |
| `pnpm --filter @vua/desktop smoke:m2-deliverables` | Provider lifecycle and task-recovery smoke: kill/disconnect, restart recovery, multi-window event broadcast (evidence under `_local_m2/<version>/`, not committed) |
| `pnpm --filter @vua/desktop smoke:remote-content` | Isolated remote WebContentsView red-line smoke: no preload/Node, permission and navigation denials (evidence under `_local_m4/<version>/`, not committed) |
| `pnpm --filter @vua/desktop smoke:download-port` | Download-port event normalization smoke against a local HTTP fixture, including policy denial and cancel/rebind (evidence under `_local_m4/<version>/`, not committed) |
| `pnpm --filter @vua/desktop smoke:f4-deliverables` | Aggregates the remote-permissions, remote-content and download-port smokes and records their exit codes and evidence locations |
| `pnpm --filter @vua/desktop smoke:production-review` | Production-page Chromium DOM regression with a synthetic Gateway; no production or remote services |
| `pnpm --filter @vua/desktop smoke:import-dialog` | Material-import dialog Chromium DOM smoke with a synthetic Gateway; no production or remote services |
| `pnpm --filter @vua/desktop smoke:resource-monitor` | Top-bar resource-monitor Chromium DOM smoke with a synthetic host; asserts zero window-blur listener leaks via CDP |
| `pnpm --filter @vua/desktop preview:overlay` | Interactive overlay preview windows: desktop surface by default, `--vr` VR surface, `--both`, or offscreen `--capture` |

Quality gates: `check:boundary` (Gateway only via the barrel; renderer must not import `electron`/`node:`/`@tauri-apps`),
`check:i18n` (no CJK literals; locale tables aligned, including table validation), `check:contrast` (WCAG AA in 5 contexts),
`check:leak` and `check:forest-leak` (production leakage checks).

## Development data and parallel checkouts

Development runs automatically use a separate profile per checkout, including linked Git
worktrees. On Windows the default is
`%LOCALAPPDATA%\VUA-dev\<checkout-name>-<canonical-path-hash>` (falling back to the app-data
directory when LOCALAPPDATA is unavailable). The normalized absolute checkout path determines
identity; the current terminal directory, Git branch and commit do not. Moving a checkout creates
a different default profile. Native window titles (including taskbar/Alt+Tab) show its development
label; the `desktop-profile` startup diagnostic prints the selected directories.

The profile contains both BDL/task databases, settings, material associations, managed warehouse
and production directories, download staging, guide reading state and browser storage/cache.
Electron userData and sessionData are configured together before initialization. Account
persistence policy is unchanged. Steam/PICO installations, external client accounts and physical
devices remain shared machine resources; coordinate installation and headset tests.

The old `%APPDATA%\@vua\desktop` directory stays untouched. New profiles start empty. To reuse
data, close the source/target VUA processes and copy a complete consistent profile into a compatible
checkout's selected directory. Do not copy only a live SQLite .db file (WAL data may still be
pending), edit its schema version or let an older build open a newer profile. A normal branch
switch keeps the checkout profile; use a separate test profile when exercising older/incompatible
schemas.

For a disposable test or an explicit data copy, choose an absolute directory for this shell:

```powershell
$env:VUA_DEV_USER_DATA = Join-Path $env:TEMP 'vua-profile-test'
$env:VUA_DEV_PORT = '5174'
pnpm dev:desktop
Remove-Item Env:VUA_DEV_USER_DATA, Env:VUA_DEV_PORT
```

`VUA_DEV_USER_DATA` overrides development data only; relative/empty paths fail before startup.
`VUA_DEV_PORT` selects the renderer port (default 5173). Use distinct ports when running multiple
development checkouts concurrently. Each process needs its own profile; explicitly choosing the
same directory disables that separation. Build/use the matching Provider from each checkout,
and keep profiles/evidence local and out of Git.

Packaged builds use `%APPDATA%\VUA` and ignore development profile overrides.

## Migration and verification records

- Presentation asset migration record: [MIGRATION_ASSETS.md](MIGRATION_ASSETS.md);
- Legacy repository asset ledger: `docs/migration/asset-ledger.md`;
- Release notes: `docs/release/`.
