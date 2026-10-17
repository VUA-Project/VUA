# VRChat sign-in, the SDK panel and upload checks

> Updated: 2026-10-18
> Status: approved by the author on 2026-10-18; steps 2–4 built on `slice/vrchat-signin`, awaiting the author's real-account checks

The first managed upload (2026-10-17, "AMF test1") worked, but the author had to sign in to the
VRChat SDK again and was handed the full SDK panel. This document records what the SDK does, what
VUA can take over, and an experimental VRChat sign-in inside VUA that the author decided to build
(2026-10-18), with the risk stated to the player.

## How the SDK keeps its sign-in

- The SDK panel signs in with username, password and a two-factor code (the author's account uses
  an emailed code). On success it calls `ApiCredentials.Set(user, user, "vrchat", auth, twoFactorAuth)`,
  which stores VRChat's session cookies.
- The session lives in Unity's per-product data folder, `LocalLow\<company>\<product>\Cookies`. On
  the next panel start the SDK calls `ApiCredentials.Load()` and fetches the current user.
- VUA work projects share the product `VUA Avatar Work` since 2026-10-17. Sign-ins made before that
  were stored under each project's old product name, so the first panel after the change asked
  again. The author's sign-in of 2026-10-17 15:40 UTC is stored in the shared folder (its file was
  written at that moment; VUA does not read it).
- The session still ends when VRChat ends it: signing out elsewhere, a password change, a security
  reset or the session's expiry. Then the panel asks again, with a new code.

To confirm: a reinspection of a second work project reports `sdkSignedIn: yes` from the shared
session (queued 2026-10-17).

## What the SDK panel needs during a managed upload

VUA's upload already uses the SDK's public builder API: VUA supplies the Avatar's name, private
release status and the thumbnail (the front preview), and the build and upload run without the
panel's fields. The panel must stay open because the builder exists only while it is open. Three
things remain:

| In the panel | Can VUA fill it? |
| --- | --- |
| Sign-in: username, password, two-factor code | Yes, from a VRChat session VUA holds: the Bridge passes it to `ApiCredentials.Set` in the open Editor, and the panel starts signed in |
| VRChat's content-permissions dialog, once per account and Editor session | No: it is an agreement the player accepts; VUA explains it before it appears |
| The panel's own builder tab, checks and warnings | VUA keeps the player in VUA with a step card ("Unity is building; nothing to do in Unity") and explains any SDK check in plain words (slice 6) |

## VRChat sign-in inside VUA (experimental)

How other tools keep the login:

- **VRCX** saves the username, password and session cookies per account in its configuration; the
  password is encrypted only when the player sets an optional primary password. At startup it
  reuses the cookies and signs in again with the password when they expire; it also re-sends the
  emailed code using the saved credentials.
- **VRCX-0** keeps the same kinds of secrets and seals them at rest, migrating older plaintext
  values to encrypted storage at startup.

Proposal:

1. An Experimental setting, off by default: "Sign in to VRChat in VUA". Turning it on shows the
   risk in plain words: VRChat's terms ask players to keep their credentials to themselves, third-party
   sign-in may lead to account action up to a ban, and VUA is not affiliated with VRChat. The player
   accepts or leaves it off.
2. Sign-in happens in VUA: username and password, then the two-factor code VRChat asks for
   (email, authenticator or recovery code). VUA keeps the session cookies; "Remember my password"
   is a separate choice so VUA can sign in again when VRChat ends the session.
3. Secrets are encrypted with Windows' per-user protection (Electron `safeStorage`) in their own
   file, never in VUA's general settings, the Gateway, task records, logs, diagnostics or the MCP
   adapter. Sign out and "Forget this account" clear them.
4. Requests identify VUA in their User-Agent, stay few and back off on errors.
5. Uses:
   - **SDK sign-in:** before an upload, the Bridge gives the session to the SDK in the open Editor
     (through a one-time, owner-only handoff that the Editor deletes on read), so the panel starts
     signed in in every work project.
   - **Upload check:** after an upload VUA reads the account's Avatar list and shows the Avatar on
     VRChat with its name, release status, platforms and update time beside the upload record.
   - Later: the Avatar list in the release room, and the social features planned on VRCX-0.

The author approved this on 2026-10-18 with the session kept by default and the password kept only
with "Remember my password"; the [product boundary](../product-boundary.md) records it.

## Order

1. Confirm the shared SDK session (the queued reinspection) and add the upload step card that keeps
   the player in VUA and explains the sign-in and the content-permissions dialog.
2. Experimental VRChat sign-in with consent, encrypted storage, sign-out and forgetting.
3. SDK session handoff before uploads.
4. Upload check against the Avatar list.

Steps 2–4 are implemented on `slice/vrchat-signin` as the Candidate
[vrchat-session v0.1](../protocols/vrchat-session-v0.1.md): the Settings → Experimental card with
the risk consent, the sign-in with all three verification methods and the email resend, the
sealed storage, sign-out and forgetting, the one-time `.vua/bridge/vrchat-session.json` handoff
the Editor consumes before the SDK panel opens, and the Avatar-list check beside the release
page's upload record with the SDK sign-in source on each upload. Synthetic tests cover the mock
API, the sealed storage, the boundary and the handoff file; the real-account checks that remain
for the author:

1. Sign in with an emailed code in VUA.
2. Start a managed upload and see Unity's SDK panel already signed in (the upload record then
   reads "signed in with the VUA session").
3. See the upload check find the Avatar ("AMF test1", `avtr_7ce0e209-6069-40c2-8b23-4e6c2dad389a`).
4. Sign out and forget the account, and confirm the local files hold neither session nor password.
