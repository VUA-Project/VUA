# Unity editor compatibility

> Scope: Unity detection, deployment, project intake, AMF and Unity Bridge
> Updated: 2026-10-13

## Current development decision

The author accepts global `2022.3.22f1` and China `2022.3.22f1c1` as equivalent for ongoing
development (2026-10-02), based on community reports of successful VRChat SDK build/upload
and the author's own inquiries. Implement and exercise working paths with this pair. Resolve
concrete differences when encountered; proving universal equivalence is not an installation gate.

Always retain the complete observed version. An installation, project or Build Record produced
with `2022.3.22f1c1` records that exact string; never rewrite it to look like global f1. This
decision covers the named pair, not arbitrary c-suffix releases or Tuanjie Engine.

## Support matrix

| Class | Editor versions | Current development behavior |
| --- | --- | --- |
| Preferred target | Global `2022.3.22f1` | Reuse when available; first acquisition and installation attempt |
| Accepted fallback | China `2022.3.22f1c1` | Reuse if no usable global target exists; install when the official entry supplies c1 or global installation fails |
| Migration source | `2019.4.31f1`, `2022.3.6f1` | Inspect metadata and guide migration on a backup or explicit project copy |
| Other Unity version | Any other complete version string | Report the difference and guide installation of the accepted pair |
| Unsupported editor family | Tuanjie Engine | Report the family and guide installation of the accepted pair |

The Unity CLI, optional Unity Hub and Unity Editor retain credentials, account sessions and
license activation; VUA receives capability and readiness results only.

## Deployment and source selection

The [deployment adapter](../architecture/unity-deployment.md) uses CLI-led official acquisition
first in every region. Inspect the payload: the global entry may supply either accepted edition.
Use the observed edition's directory, checksum and publisher; try China after global failure,
then offer Unity Hub. NoUnityCN is an optional backup. Disabling mirrors excludes it and retains
official global/China routes. Preserve a valid existing installation.

Inspect the installed executable, register its real path with Unity CLI, and retain its actual
version in the task result. Users complete Unity account authorization and license selection
through Unity's tooling. Follow with a disposable project and the real SDK/MA workflow.

## Installation and license activation are separate

File/PE metadata checks, package download and installation can run without starting the Editor.
AMF material import, inspection, assembly and SDK work run the Editor and require an active
license, including batch mode. An installed C1/global executable is an installation fact, not
proof of activation. This explains a successful earlier deployment followed by an unlicensed
N3 run; it does not introduce a new installation prerequisite.

The target-version [Unity activation policy](https://docs.unity3d.com/2022.3/Documentation/Manual/LicenseActivationMethods.html)
uses Hub for Personal activation/return. Serial-based paid licensing supports its documented
CLI/manual paths; manual offline activation is not supported for Personal. Current
[Hub guidance](https://docs.unity.com/en-us/hub/manage-license) also describes automatic Personal
activation after sign-in. VUA does not use undocumented free-mode flags, fabricate license files,
rewrite identity, or collect account passwords/serials. Reuse an already active legitimate
license; otherwise follow official registration and activation. Eligible Personal is free under
the [official eligibility policy](https://unity.com/pages/license-compliance).

The novice journey is **Settings → Accounts → Unity**: create/verify an account if needed, sign
in to Hub, activate/confirm a suitable license, locate the already installed exact Editor if
necessary, then return to AMF and reinspect retained work. Existing accounts skip registration;
the existing Editor and original materials are retained. The same explanation is reachable from
the scenario SOP and a license failure. Installing software remains independently usable and
does not gate on an account form. License activation and actual licensed Editor/SDK acceptance
remain real-machine observations; software-only checks explicitly report `not_checked`.

## Contract implementation and subsequent project work

N1 Candidate deployment applies this admission rule independently of the frozen Editor identity
classifier. The frozen `editor-verify/v0.1` result still identifies c1 and reports its historical
classification; N1 uses the full observed version to admit the current development pair.

The accepted pair also defines the direction for AMF/Bridge work. Existing frozen project/Bridge
version gates must receive an explicit versioned update when implementing that path; deployment
acceptance alone does not modify those gates. Track that work with N3 real-project acceptance,
including SDK recognition and upload preparation, rather than blocking N1 installation on it.

## Project preservation and verification

- Migration operates on a backup or explicit copy and records source and target versions.
- Inspect `ProjectVersion.txt` and executable metadata without rewriting either to spoof identity.
- Bridge execution records the running `Application.unityVersion`; each supported operation
  validates the version under its owning protocol.
- Build Records retain the complete Editor version actually used.
- Real project results identify which edition was tested. Installation and SDK workflow results
  are separate observations.
