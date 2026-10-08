# Steam/PICO acquisition: installation and return checklist

> Document version: 1.0.0
> Status: Accepted
> Updated: 2026-10-08
> Scope: `slice/steam-pico-acquisition`; Windows Steam and PICO Connect installation/reuse

For people: this slice acquires the official clients and checks their installed entry files.
The [first-play checkpoint](first-play-delivery-plan.md) retains game installation/launch,
account handoffs, USB/Wi-Fi, eye tracking and final release acceptance.

For Agents: [deployment v0.1](../protocols/environment-deployment-v0.1.md) owns the actions,
region choice, trust gates, native execution and recovery semantics. The
[N sequence](../development-outline.md#first-play-release-acceptance) owns product acceptance.
Do not treat the checks below as completed until the exact build has been exercised. Ask the
author before using an installation baseline that changes shared software. Never uninstall
an existing client merely to manufacture a missing-software case.

## Prepared implementation and evidence limits

The slice connects Rust planning/adapters to the typed desktop consumer and four-language UI.
Synthetic cases cover unsigned/incorrect artifacts, rejected cache retention, download
cancellation, fixed process arguments, UAC/error mapping, late/missing payload observations,
durable failure replay, cancellation before later steps and receipt-only task restoration.
Static inspection on 2026-10-08 checked the official Steam bootstrapper and both PICO 10.6.6
packages: distinct PICO sizes/hashes, expected publishers and administrator manifests. That
inspection executes no installer and does not verify vendor-specific `/S` behavior.

Raw evidence belongs under the ignored `_local_real_machine/` directory. Record the build's
commit plus dirty-tree identity when applicable, artifact hash, Windows version, selected
PICO region, initial presence, task/result/progress and the resulting presence. Keep accounts,
machine paths and raw logs local. Public summaries state which baseline was actually exercised.

The 2026-10-08 local reuse run found all four play prerequisites. Desktop and PICO plans
retained existing clients, execution returned `prerequisites_verified`, and replay after
restarting the real Provider returned the original accepted tasks. No installer ran.
The unsigned preview ZIP passed fresh Unicode/space-directory, moved-directory/profile and
missing-Provider checks. Chromium checks in all four locales covered region consent,
reported progress, page return and localized failure with synthetic adapter facts; they
do not complete human language review or missing-software acceptance.

### Prepared isolated installation run

[Prepare the Sandbox bundle](../../scripts/prepare-acquisition-sandbox.ps1) builds a separate
acceptance executable with the same static C runtime setting as the packaged Provider,
records source/artifact identities, and generates one `.wsb` configuration for each region.
It enables no Windows feature and runs no installer on the host. Each configuration maps
only its inputs read-only and its dedicated result folder writable; installers are acquired
inside the guest. Firmware virtualization and the [Windows Sandbox feature](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-install)
must be enabled separately with the author's approval. The
[feature-enablement script](../../scripts/enable-acquisition-sandbox.ps1) never restarts the host.

Run the two configurations in separate fresh Sandbox sessions. The
[guest runner](../../scripts/acquisition-sandbox-guest.ps1) refuses a non-Sandbox profile or
previous result folder. The Rust tool also requires an absent Steam/PICO/VRChat/SteamVR
baseline before executing anything. It exercises the real desktop deployment service
through Steam installation and the VRChat manual handoff, then the real PICO adapter's
acquisition, native execution and entry-file reinspection. The PICO adapter is tested
separately because the clean guest has no Steam library games; this does not complete the
full PICO path in item 2 below. No account login is used. Inspect `finished.json`,
`events.jsonl` and copied guest metadata before closing the guest. A failed run remains
failed evidence, including unsupported virtualized installer/driver behavior. Sandbox
does not establish host UAC behavior or headset functionality. These installation runs
are prepared and **not yet executed**.
The author deferred Sandbox execution; the missing-software baseline awaits a separate
author-provided method. This leaves its acceptance status pending.

## Missing-software baseline

Use a disposable Windows PC/VM or another author-approved baseline. Start from an absent
client without removing unrelated software; a VM proves installation behavior, not PICO play.

1. Choose desktop play, prepare a plan and confirm that only Steam/VRChat are required.
   Execute the Steam action, approve Windows' permission request and inspect the result.
   The task must stop at the VRChat Steam handoff, with readiness false and no Unity/SteamVR
   acquisition. Steam's own initial update/login is still an upstream action.
2. On the PICO baseline choose `pico_pcvr` and the actual usage region explicitly. Check
   that the official page and cached artifact belong to that distribution. In a baseline
   with Steam/VRChat/SteamVR already observed, run the missing PICO Connect action. Check
   native completion, installed entry files and a fresh plan. A reboot/driver prerequisite
   reported by the official installer needs a separate user handoff and must be recorded.
3. Exercise the other PICO distribution on a separate suitable baseline. Do not replace a
   working mainland/global client just to exercise selection. Before execution, changing
   the region must clear consent; a new plan must carry the changed region and official page.
4. During acquisition inspect reported bytes and unknown-length handling. During native
   installation show stage and elapsed time. No inferred installation percentage appears.

## Failure, cancellation and return

1. Decline UAC: show localized recovery, retain readiness false and keep the official page
   available. A new attempt needs explicit fresh consent.
2. Block the official source in the disposable baseline: acquisition must fail with an
   actionable message, no executable launch and no region/publisher fallback. Restore the
   connection and inspect before retrying. Corrupt-cache handling is covered synthetically;
   if exercised physically, use only the test profile's managed cache.
3. Cancel during download/verification: stop at the next reporting boundary and remove only
   the owned partial file. Cancel after native launch: wait for that boundary, preserve
   installed output, skip later actions and retain those files on the next plan.
4. Leave the environment page during a task, return, then restart VUA. Query the accepted
   task; do not execute from the receipt bookmark. A recovered interrupted task must request
   inspection. Previously completed/failed tasks retain their authoritative outcome.
5. Test timeout only in an isolated synthetic process fixture unless the author has a
   suitable stalled installer case. A timeout leaves the OS-owned process for inspection;
   the UI must not auto-retry. Provider interruption and partial output require fresh checks.

## Reuse baseline and UI review

With an existing valid Steam/PICO installation, inspect and prepare fresh consent. Each
verified client is retained and no installer is launched. Empty/partial directories cannot
establish readiness. This is separate evidence from a missing-software run.

Review English, Simplified Chinese, Japanese and Korean with the author: purpose and region
selection, official source wording, Windows handoff, failure details, cancellation and return.
Check keyboard focus, a narrow/resized window and supported DPI. The PICO choice follows the
user's selected region, independently of interface language. The Unity location appears only
when a creator purpose is selected. Automated key/table checks do not complete human review.

## Document changelog

- 1.0.0 (2026-10-08): prepare concrete missing-software/reuse, regional artifact, failure,
  cancellation, page-return and UI checks; record the local reuse/ZIP checks and prepare
  isolated Sandbox installation inputs without claiming missing-software acceptance.
