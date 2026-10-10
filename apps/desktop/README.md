# VUA Desktop App (@vua/desktop)


> Status: Accepted
> Scope: Electron Main / Preload / Renderer, package scripts, and quality gates
> Updated: 2026-10-10
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
| `pnpm --filter @vua/desktop smoke:help-navigation` | Controlled Main/preload/renderer navigation: embedded hardware/knowledge, reading return, compact Play cards and light/big-screen appearance; isolated profile, no vendor actions |
| `pnpm --filter @vua/desktop smoke:vrcft` | Native read-only tool discovery and controlled device/connection selection, module guidance and recovery UI; isolated profile, synthetic actions, no vendor/module installation or hardware acceptance |
| `pnpm --filter @vua/desktop build` | Builds `@vua/orchestrator-provider` first, then emits to `dist/` |
| `pnpm --filter @vua/desktop check` | typecheck + test + build + boundary, i18n, contrast and leakage checks |
| `pnpm --filter @vua/desktop smoke:remote-permissions` | Real remote permission smoke (evidence written to `_local_m1/<version>/`, not committed; the `_local_m*` directory names are historical M-line naming) |
| `pnpm --filter @vua/desktop start` | Build, then launch the unpacked app with Electron (`pnpm build && electron .`; no installer is produced) |
| `pnpm --filter @vua/desktop smoke:m2-deliverables` | Provider lifecycle and task-recovery smoke: kill/disconnect, restart recovery, multi-window event broadcast (evidence under `_local_m2/<version>/`, not committed) |
| `pnpm --filter @vua/desktop smoke:remote-content` | Isolated remote WebContentsView red-line smoke: no preload/Node, permission and navigation denials (evidence under `_local_m4/<version>/`, not committed) |
| `pnpm --filter @vua/desktop smoke:download-port` | Download-port event normalization smoke against a local HTTP fixture, including policy denial and cancel/rebind (evidence under `_local_m4/<version>/`, not committed) |
| `pnpm --filter @vua/desktop smoke:f4-deliverables` | Aggregates the remote-permissions, remote-content and download-port smokes and records their exit codes and evidence locations |
| `pnpm --filter @vua/desktop smoke:production-review` | Production-page Chromium DOM regression with a synthetic Gateway; no production or remote services |
| `pnpm --filter @vua/desktop smoke:library-maintenance` | Local-file selection, retained references, cancellation and same-request receipt recovery in Chromium; synthetic Gateway and isolated temporary profile only |
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

The host profile contains its task database and module selection. AMF owns its separate task
database, BDL, material associations, managed warehouse/production directories and download staging.
AMF is installed with VUA and enabled for new profiles. Existing profiles without a saved choice
retain the old disabled default; Avatar editing and Settings → Modules control the payload.
Explicit choices survive restart, and
disabling retains its data. Existing BDL profiles retain their original data locations.
See [module ownership and migration](../../docs/architecture/modules.md) for paths and recovery.
Shared settings, guide reading state and browser storage/cache remain in the selected profile.
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

Packaged apps ignore development profile overrides and retain `%APPDATA%\VUA` across updates
and ZIP moves. Only the explicit packaged-smoke switch selects the smoke harness's isolated
profile, including browser storage.

## Windows ZIP preview

```powershell
pnpm --filter @vua/desktop package:win
pnpm --filter @vua/desktop smoke:packaged
```

The first command compiles the application and both real Rust providers, then creates
`apps/desktop/out/VUA-<package version>-windows-x64-preview.zip`. Version comes from the desktop
package manifest; creating a preview does not select a new public release number. The ZIP is
unsigned. It contains the host and optional AMF payload, including creator code retained for later work;
it is not a declaration that the first desktop/PICO play guide is complete.
The packaging-only Main/preload bundles are emitted to `dist/packaged-electron/`; normal
`dist/electron/` modules remain available to the existing development and security-smoke scripts.
The package excludes workspace sources, tests and development mocks.

After building, `pnpm --filter @vua/desktop test:module-isolation` checks both native processes in an
isolated profile, including damaged test BDL and data-preserving disable. It starts no vendor software
or Unity operation. Ordinary unit tests skip this native test to avoid using stale build outputs.
`pnpm --filter @vua/desktop smoke:amf-module` checks activation, library navigation, disable and
Settings return through the real Main/preload and production renderer. First build those bundles
with `node scripts/build-electron.mjs` and `pnpm exec vite build` from this directory. Its hidden
window and data profile are isolated; screenshots/reports remain in the named temporary directory.

Extract the entire archive and launch `VUA.exe`. The end-user machine needs neither Node nor
Rust nor this checkout. Keep all runtime files together. Packaged app data lives in
`%APPDATA%\VUA`, so replacing/moving the extracted folder does not remove settings or tasks.
Close VUA before updating or deleting its program folder; remove data separately only when wanted.
The ZIP's `resources/README.txt` includes these instructions and the unsigned-preview status.

The smoke harness extracts the actual ZIP to a new temporary directory containing spaces and
non-ASCII characters, uses an isolated profile and a hidden window, and queries the real bundled
Provider through preload/Gateway. It repeats after moving the program folder and checks a missing
backend produces a failed result. It removes developer tools from the launched process's PATH
and supplies stale development overrides deliberately. No platform account or software installer
is used. `out/packaged-smoke.json` records the archive SHA-256 and result; raw diagnostics and
profiles stay in the named temporary directory for investigation. They are not committed.

This bootstrap check complements the [first-play acceptance](../../docs/development-outline.md#first-play-release-acceptance).
Physical PICO USB/Wi-Fi tests and human UI review are separate. Before publication, finish the
exact-build license inventory, signing decision, illustrated guide and remaining play rows.
The [Windows ZIP workflow](../../.github/workflows/windows-zip.yml) runs on relevant packaging
PR changes or manual dispatch and keeps unsigned preview artifacts for seven days. It does
not create a GitHub release; documentation-only edits do not trigger that workflow.

## Migration and verification records

- Presentation asset migration record: [MIGRATION_ASSETS.md](MIGRATION_ASSETS.md);
- Legacy repository asset ledger: `docs/migration/asset-ledger.md`;
- Release notes: `docs/release/`.
