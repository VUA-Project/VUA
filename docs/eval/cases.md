# North Star Eval cases

> Updated: 2026-10-16

Format and run rules: [Eval README](README.md). All cases below are `candidate`.

Sources: **CN interviews** — the author's interviews with Chinese-speaking players (October 2026);
**community research** — English, Japanese and Korean forums, community sites and newcomer
guides reviewed on 2026-10-16.

## A — Settings

### A-01 Meta streaming quality

- **Player's words:** "Link looks blurry. Where do I change the streaming quality?"
- **Source:** CN interviews
- **Starting state:** Meta Quest connected to a Windows PC through Link or Air Link
- **Pass condition:** VUA names the setting and its location, opens it, and the player changes it;
  where VUA can read the value, it shows the value before and after
- **Verification:** guided
- **N stage:** N1

### A-02 OVR Advanced Settings space drag

- **Player's words:** "How do I drag my play space to move around?"
- **Source:** CN interviews
- **Starting state:** SteamVR with OVR Advanced Settings installed through Steam
- **Pass condition:** the player has space drag bound to a controller button and uses it in VRChat
- **Verification:** guided
- **N stage:** N1 / N2

### A-03 Frame rate drops in crowded worlds

- **Player's words:** "Everything lags when lots of people are around."
- **Source:** community research (EN)
- **Starting state:** VRChat on PC with default safety and performance settings
- **Pass condition:** VUA explains avatar performance ranks and mirrors, and the player applies the
  suggested Safety and graphics settings and reports the improvement
- **Verification:** guided
- **N stage:** N1

## B — Symptom to solution

### B-01 VRCFaceTracking rejects an older Avatar's parameters

- **Player's words:** "VRCFT says my Avatar's face-tracking parameters can't be used. What now?"
- **Source:** CN interviews; community research (EN)
- **Starting state:** VRCFaceTracking installed with a tracking module; an Avatar using older
  face-tracking parameters
- **Pass condition:** VUA identifies the VRCFT and module versions and the Avatar's parameter
  set, names the cause, and after the fix VRCFT reports the Avatar's parameters as usable
- **Verification:** closed loop
- **N stage:** N2 / N3

### B-02 A Quest friend sees a gray robot

- **Player's words:** "My friend on Quest only sees me as a gray robot."
- **Source:** community research (EN, JP)
- **Starting state:** a PC player wearing an Avatar without an Android build
- **Pass condition:** VUA names the cause (no Android version of the Avatar) and offers the
  fallback-avatar SOP; the friend sees the fallback Avatar
- **Verification:** guided
- **N stage:** N1

### B-03 Upload is not allowed

- **Player's words:** "The SDK won't let me upload my Avatar."
- **Source:** community research (EN, KR)
- **Starting state:** a new account signed in to the SDK
- **Pass condition:** VUA tells apart the two causes — signing in with a Steam or Meta account
  instead of a VRChat account, or a Visitor trust rank — and offers the matching SOP
- **Verification:** guided
- **N stage:** N1 / N3

### B-04 Everyone appears as robots

- **Player's words:** "Suddenly everyone is a robot."
- **Source:** community research (EN)
- **Starting state:** Safe Mode active, or Shield set to Maximum
- **Pass condition:** VUA explains Safe Mode, its shortcut and the Shield levels; the player
  restores Avatar display
- **Verification:** guided
- **N stage:** N1

### B-05 Others cannot hear the microphone

- **Player's words:** "People in VRChat can't hear me."
- **Source:** community research (EN, JP)
- **Starting state:** a microphone that works in other apps; VRChat or Windows using another input
- **Pass condition:** VUA reports the Windows default input device and other devices that can take
  over input, guides the fix, and a re-check shows the intended microphone as active input
- **Verification:** closed loop for the Windows part; guided for VRChat's own setting
- **N stage:** N1

### B-06 VRChat does not start because of Easy Anti-Cheat

- **Player's words:** "VRChat closes right after launching."
- **Source:** community research (JP)
- **Starting state:** antivirus software blocking the Easy Anti-Cheat service
- **Pass condition:** VUA identifies the EAC failure from available evidence, offers the SOP, and
  VRChat starts
- **Verification:** closed loop
- **N stage:** N1 / N6

## C — Tools

### C-01 Install a GitHub-only tool from mainland China

- **Player's words:** "I want to use VRCS, but GitHub won't download."
- **Source:** CN interviews
- **Starting state:** a Windows PC on a mainland China network without the tool installed
- **Pass condition:** VUA installs the selected release through a channel its license allows,
  verifies it, and the tool launches
- **Verification:** closed loop
- **N stage:** N2

### C-02 Discover tools for a goal

- **Player's words:** "Is there a tool that translates speech while I play?"
- **Source:** CN interviews
- **Starting state:** no translation tool installed
- **Pass condition:** VUA lists the catalog tools for the goal with their purpose, price, license
  and delivery channel; the player installs one and it launches
- **Verification:** closed loop
- **N stage:** N2

## P — Avatar production

### P-01 Outfit appears pink

- **Player's words:** "I imported an outfit and it's all pink."
- **Source:** community research (JP)
- **Starting state:** a VUA-managed Avatar project; an outfit whose shader package is absent
- **Pass condition:** VUA identifies the missing shader package, installs it, and the Bridge
  re-check reports no material with a missing shader
- **Verification:** closed loop
- **N stage:** N3

### P-02 Put a matching outfit on its Avatar

- **Player's words:** "I bought an outfit made for my Avatar. Put it on, with a menu toggle."
- **Source:** community research (JP, KR)
- **Starting state:** the Avatar and an outfit sold as compatible with it, both owned by the player
- **Pass condition:** the Bridge verifies the outfit bound to the Avatar's armature, the menu
  toggle exists, and the VRChat SDK build check passes
- **Verification:** closed loop
- **N stage:** N3

### P-03 Complex production

- **Player's words:** "Build my Avatar with these outfits, accessories and tools."
- **Source:** N3 acceptance
- **Starting state:** one real Avatar, at least two actively used dependencies or plugins and at
  least six other real materials
- **Pass condition:** the [N3 acceptance](../development-outline.md#n3-complex-real-material-avatar-production)
  rows pass in one production run
- **Verification:** closed loop
- **N stage:** N3

### P-04 Reproduce a Recipe

- **Player's words:** "Make the same Avatar again in a new project."
- **Source:** N4 acceptance
- **Starting state:** a saved Recipe from P-03 and the same owned materials
- **Pass condition:** the [N4 acceptance](../development-outline.md#n4-recipe-and-multi-flow-reproduction)
  reproduction rows pass in a second project
- **Verification:** closed loop
- **N stage:** N4
