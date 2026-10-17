# Experimental VRChat sign-in v0.1

> Document version: 0.1.1
> Status: Candidate
> Updated: 2026-10-18
> Owner: Integration

An Experimental setting, off by default, keeps a VRChat session inside VUA (author ruling
2026-10-18; see [the design](../development/vrchat-account.md) and the
[product boundary](../product-boundary.md#account-onboarding-user-ruling-2026-09-30)). The
player first reads the risk in plain words — VRChat's terms ask players to keep their
credentials to themselves, third-party sign-in may lead to account action up to a ban, and VUA
is not affiliated with VRChat — and accepts it or leaves the switch off. The session then signs
the SDK panel in for managed uploads and reads the player's own Avatar list to check an upload.

## Methods

The face is served by Electron Main; the methods are routed there before the Provider and are
absent from the AI tool catalog. All values carry `schemaVersion: "0.1"`. Unknown keys are
rejected.

| Method | Kind | Additional params | Result |
| --- | --- | --- | --- |
| `vrchat.status` | Query | none | `enabled`, `state` (`signed_in` / `needs_code` / `signed_out`), `account` (`displayName`, `thumbnail` as a `data:` URL), `rememberPassword`, `pendingMethods`, `canCheckUploads` |
| `vrchat.setExperimental` | Command | `enabled`, `commandId` | The new status. Turning it off signs the player out and removes every stored value |
| `vrchat.signIn` | Command | `username`, `password`, `rememberPassword`, `commandId` | `signed_in`, or `two_factor_required` with `methods`; `invalid_credentials` / `network` / `rate_limited` / `server` / `not_enabled` |
| `vrchat.relogin` | Command | `commandId` | Signs in again with the remembered password, when there is one; otherwise `no_sign_in_in_progress` |
| `vrchat.verifyCode` | Command | `method` (`emailotp` / `totp` / `otp`), `code`, `commandId` | `signed_in`, or `invalid_code` / `no_sign_in_in_progress` |
| `vrchat.resendEmailCode` | Command | `commandId` | `sent`; at most once every 30 seconds (`resend_too_soon`) |
| `vrchat.signOut` | Command | `commandId` | The new status; the session ends on VRChat's side too. A remembered password stays until forgotten |
| `vrchat.forget` | Command | `commandId` | The new status; session, remembered password, display name and saved upload checks are removed |
| `vrchat.avatarCheck` | Query | `blueprintId`, optional `refresh` | `found` with the Avatar's `name`, `releaseStatus`, `platforms` and `updatedAt`, `not_found`, `signed_out`, or `error`; `checkedAt` names the read |

`app.snapshot` carries `vrchat: { experimentalEnabled, signedIn }` — two booleans; this is the
whole face the AI tool `vua_status` can read.

## Sign-in flow

Sign-in uses the endpoints documented by the community API reference
(<https://vrchatapi.github.io>): `GET /api/1/auth/user` with URL-encoded Basic credentials,
`POST /api/1/auth/twofactorauth/{emailotp|totp|otp}/verify` with `{ "code" }`,
`POST /api/1/auth/twofactorauth/emailotp/resend`, `GET /api/1/auth/user` with cookies for the
session check, `PUT /api/1/logout`, and `GET /api/1/avatars?user=me&releaseStatus=all&n=100&offset=…`
for the player's own Avatar list (at most ten pages per check).

Requests identify themselves as `VUA/<version> (+https://github.com/VUA-Project/VUA)`, keep at
least a second apart, and back off on 429 and 5xx answers (three retries, `Retry-After`
respected). A session check runs at startup and before a check that needs the list; a kept
session is reused, and when VRChat ended it a remembered password signs in again — stopping at
a new verification code when VRChat asks for one.

## Where the values live

`userData` holds three files. `vrchat-account.json` keeps the switch, the password choice, the
display name and the last check time. `vrchat-secrets.json` holds only a blob sealed with
Electron `safeStorage` (Windows per-user protection) — the canonical username, the `auth` and
`twoFactorAuth` cookies, and the password when the player asked to remember it. Without OS
encryption the session lasts only for the launch. `vrchat-avatar-checks.json` keeps the last 50
upload checks (name, release status, platforms, update time). Sign-out and forgetting remove
what their names say.

Secrets stay inside Electron Main: they appear in no Gateway value, task record, log,
diagnostic, crash report or MCP output, and the Chromium profile of the embedded browser is not
used for them.

## SDK session handoff

Before the Provider accepts `amf.production.upload`, Main writes the session once into the run's
work project as `.vua/bridge/vrchat-session.json` (`schemaVersion`, `createdAt`, `username`,
`auth`, optional `twoFactorAuth`); the file is narrowed to the current Windows user before the
session is written into it. The Editor's upload observer reads it before the SDK panel opens,
deletes it right away, and applies it exactly as the SDK's own account tab does —
`ApiCredentials.Set` with both cookies, then `APIUser.InitialFetchCurrentUser` — so the panel
starts signed in. A file older than fifteen minutes is ignored. VUA deletes the file when the
Provider rejects the upload, and deletes every file it wrote on sign-out, forgetting and quit;
`userData/vrchat-handoffs.json` lists the files still on disk, so a launch that ended without
its cleanup has them deleted at the next start. VUA and the SDK share the one session, so
signing out in VUA also signs the SDK out. When the player is not signed in, the upload keeps
its ordinary path (sign-in inside the panel). The
upload receipt records the outcome as `sdkSignIn: "vua_session" | "panel"`, and
[amf-production](amf-production-v0.1.md) carries it on the upload record; no secrets travel
through the request or the receipt.

## Evidence limits

The client, the sealed storage, the routing, the handoff file and the checks are covered by
synthetic tests against a mock server. Signing in with a real VRChat account, the SDK panel
starting signed in, and finding a real upload in the Avatar list are the author's real-machine
checks; VRChat's treatment of third-party sign-ins is the platform's own decision at any time.

## Document changelog

- 0.1.1 (2026-10-18): the handoff file is narrowed to the current user before the session is
  written; a rejected upload removes it, and files left by a launch that ended without its
  cleanup are removed at the next start. Signing out in VUA also signs the SDK out.
- 0.1.0 (2026-10-18): first Candidate. Experimental sign-in with risk consent, sealed session
  and optional password storage, three two-factor methods with email resend, sign-out and
  forgetting, the one-time SDK session handoff before managed uploads, and the Avatar-list
  upload check.
