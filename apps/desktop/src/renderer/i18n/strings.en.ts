/**
 * VUA UI string table (en) — SOURCE language.
 * - This table is the structural source of truth: the widened Strings type
 *   is derived from it (bottom of file); every other locale table is checked
 *   against it (compile-time via Strings; placeholder parity via
 *   scripts/check-i18n-tables.mjs).
 * - Business code must not hold UI literals; views reference keys from the
 *   current table (models return keys + params) — CJK literals in business
 *   code are rejected by scripts/check-i18n.mjs.
 * - Interpolation uses named placeholders ("{count} remaining"), expanded by
 *   format(); never assemble sentences by concatenation.
 * - Domain IDs stay stable; terms.* supplies localized display names. Brands stay unchanged.
 * - Demo-data payload copy does not live here; see ./strings.fixtures.zh-CN.ts
 *   (DEV-only, reachable only from gateway fixtures, tree-shaken in release).
 */
export const strings = {
  websiteTests: {
    title: "Website tests", test: "Test", testAll: "Test all", testing: "Testing…",
    add: "Add website", edit: "Edit website", editSite: "Edit {name}", testSite: "Test {name}",
    name: "Name", url: "Website URL", save: "Save", cancel: "Cancel", remove: "Remove",
    milliseconds: "{ms} ms", httpStatus: "HTTP {code}", resultDetail: "{status} · {ms} ms",
    invalid: "Enter a name and a unique HTTPS URL without login information or a fragment.",
    empty: "Add a website with the + button.", unavailable: "Website testing is currently unavailable. Software setup can continue.",
    storageFailed: "Changes apply for this session but could not be saved.",
    help: "Connection help", detectRegion: "Detect region",
    scope: "Time to website response headers, not game ping or download speed. Tests run only when clicked, without account cookies.",
    statuses: { timeout: "Timed out", connection_failed: "Failed", probe_error: "Unavailable", http_error: "HTTP error", redirected: "Redirect", reachable: "Connected" },
  },
  network: {
    lagTitle: "Connected, but a distant instance feels slow?",
    lagRegion: "Check the instance's server region in VRChat. Compare with an instance closer to you and your friends, and check the game's ping. A successful website check does not measure this cross-region delay.",
    lagPerformance: "If the picture stutters, also compare the game's FPS. For PICO streaming, check PICO Connect's USB or local Wi-Fi connection separately. These are different from the instance's Internet latency.",
    regionUse: "Where this network is used",
    uuQualifier: "Use this recommendation when connecting from mainland China.",
    "title": "Check the play network",
    "description": "Check Steam and VRChat service entrances before setup, then follow the suggestions for any connection problems.",
    "options": "Check options",
    "route": "Play mode",
    "routes": {
      "desktop_play": "Desktop play",
      "pico_pcvr": "PICO streaming"
    },
    "region": "Network region",
    "autoRegion": "Detect automatically",
    "regions": {
      "china_mainland": "Mainland China",
      "other": "Outside mainland China",
      "unknown": "Not determined"
    },
    "privacy": "Checks contact the listed services without logging in. Automatic region detection also contacts Cloudflare; only the country category is used, and IP addresses are not saved.",
    "check": "Check network",
    "recheck": "Check again",
    "continue": "Continue setup",
    "continued": "Continue with software setup below. Network checks can be reopened at any time.",
    "reopen": "Reopen network checks",
    "running": "Checking service entrances… {seconds} s elapsed. Each check has a time limit.",
    "failed": "The check could not finish. Try again, or continue setup and test the connection in the game.",
    "summary": "{count} of {total} service entrances responded successfully.",
    "checkedAt": "Checked at {time}",
    "regionHint": "This describes the connection exit. Select the region manually if it differs from the network being set up.",
    "targets": {
      "steam_store": "Steam registration and store",
      "steam_community": "Steam Community",
      "steam_download": "Steam installer download",
      "vrchat_web": "VRChat website",
      "pico_connect": "PICO Connect download page"
    },
    "statuses": {
      "reachable": "Responded successfully",
      "http_error": "Server returned a response to review",
      "redirected": "Redirect needs a browser check",
      "timeout": "Timed out",
      "connection_failed": "Connection not established",
      "probe_error": "Check unavailable"
    },
    "responseTime": "Response headers in {milliseconds} ms",
    "remedies": {
      "http_error": "Open the service to check it in the browser. An access restriction, browser challenge or service error can affect this check; this response does not mean the whole network is offline.",
      "redirected": "Open the official page to follow the redirect in the browser, then check again if the network changes.",
      "timeout": "Check the Internet connection, then retry. Open the official page to compare the browser connection.",
      "connection_failed": "Check whether the official page opens. If needed, check the system clock and current proxy or accelerator, then retry.",
      "probe_error": "Retry the check. Software setup can continue while this check is unavailable."
    },
    "openService": "Open official page",
    "uuTitle": "Mainland China: NetEase UU",
    "uuSteps": "Open NetEase UU and select VRChat for acceleration. This also covers the surrounding Steam and Oculus stores; there is no need to select them separately. Then return here and check again.",
    "uuAffiliation": "VUA has no financial relationship with NetEase UU. NetEase operates the service and sets its terms and any charges.",
    "openUu": "Open NetEase UU",
    "uuRecheck": "An existing accelerator can stay in use. These VUA requests and the game may use different routes; after enabling acceleration, also verify login and loading in VRChat.",
    "scope": "These checks measure access to service entrances, not game latency or download speed. Setup can continue with any result; the game connection is verified when playing.",
    "picoLocal": "PICO USB and Wi-Fi streaming are checked separately in PICO Connect. If Internet access works but the headset cannot connect, check the cable or local Wi-Fi connection there.",
    guideCta: "View the PICO streaming guide",
    "linkFailed": "The page could not be opened. Try again."
  },
  terms: {
    warehouse: "Asset library",
    recipe: "Recipe",
    assembly: "Avatar setup",
    production: "Build",
    inspection: "Checks",
    release: "Build results",
    amf: "",
  },
  diagnostics: {
    "statusWithCode": "{status} ({code})",
    "unknown": "Additional information is available in the original message.",
    "original": "Original message",
    "inspectRequired": "Review the interrupted task before choosing how to recover. It will not resume automatically.",
    "taskFailed": "The task reported an error. Open its details to review what happened.",
    "projectReady": "The Unity project and current scene can be read.",
    "validationPassed": "Outfit hierarchy, Merge Armature and selected references passed validation.",
    "performanceEstimated": "A local structural estimate is available. This is not an official VRChat performance rank.",
    "missingMesh": "A mesh reference is missing. See the original message for the affected object.",
    "missingMaterial": "A material reference is missing. See the original message for the object and slot.",
    "missingScript": "The avatar hierarchy contains a missing script.",
    "referencesClean": "Mesh, material and script references are present.",
    "realtimeLights": "The scene contains realtime or mixed lights. This is an observation, not an official rating.",
    "bakedLights": "All observed scene lights are baked. This is not an official rating.",
    "noLights": "No scene lights were found. This is not an official rating.",
    "sdkAbsent": "VRChat Avatar SDK components were not found in this project.",
    "descriptorMissing": "The avatar has no Avatar Descriptor component.",
    "pipelineMissing": "The avatar has no Pipeline Manager component.",
    "uploadComponentsPresent": "Avatar Descriptor and Pipeline Manager are present. This does not mean the official SDK has approved upload.",
    "buildTarget": "The active build target is recorded in the original message."
  },
  common: {
    fixtureBadge: "Demo data",
    mascotAria: "VUA mascot robot",
    /** Content dialog chrome (material import / composing draft dialogs) */
    dialogClose: "Close",
  },
  boot: {
    loadFailedTitle: "Startup data failed to load",
    loadFailedDescription:
      "Something went wrong while reading local capability snapshots; the interface is not ready yet. Retrying does not modify any local data.",
    retry: "Retry",
  },
  statusLight: {
    ok: "OK",
    warning: "Needs confirmation",
    error: "Needs fixing",
    unknown: "Unknown",
    info: "Optional",
  },
  taskStatus: {
    queued: "Queued",
    preparing: "Preparing",
    running: "Running",
    waitingInput: "Waiting for input",
    paused: "Paused",
    completed: "Completed",
    completedWithWarnings: "Completed with warnings",
    failed: "Failed",
    cancelled: "Cancelled",
  },
  workflowStage: {
    inspect: "Inspecting project state",
    plan: "Generating execution plan",
    await_confirmation: "Waiting for plan confirmation",
    snapshot: "Creating snapshot",
    execute: "Applying changes",
    validate: "Validating results",
    completed: "Completed",
    recover: "Rolling back",
    failed: "Failed",
    failed_recoverable: "Failed (recoverable)",
    expired: "Confirmation expired",
  },
  capability: {
    states: {
      unavailable: "Unavailable",
      unconfigured: "Not configured",
      loading: "Loading",
      ready: "Ready",
      blocked: "Blocked",
      waitingInput: "Waiting for action",
      error: "Error",
    },
    details: {
      detectorsMissing: "Real detectors are not connected yet",
      taskEngineMissing: "Task engine is not connected yet",
      catalogMissing: "Tool catalog is not connected yet",
      packagesEngineMissing: "Package engine is not connected yet",
      warehouseMissing: "The asset library is not available yet.",
    },
  },
  /** Task-title templates (walkthrough #4 i18n): verbs and status wording go
   *  through i18n; entity names stay verbatim. Demo tasks compose at gateway
   *  assembly time in the active language. */
  taskTitles: {
    assembly: "Set up {name}: rigging and menus",
    download: "Download {name}",
    downloadInterruptedNote: "Download interrupted: connection lost; the received part is resumable.",
    downloadPolicyRefusedNote: "Download refused by policy: source or file type is not allow-listed; nothing was saved.",
    envCheck: "Creative environment check",
    envCheckWarning: "VPM environment validation failed",
    warehouseScan: "Scan asset library",
    generateVpm: "Generate VPM: {name}",
    deleteOriginals: "Delete originals: {name}",
    importBatch: "Import asset folders",
    adoptDownload: "Add downloaded assets",
  },
  taskCenter: {
    title: "Notification Center",
    expandAria: "Expand task list ({count})",
    collapseAria: "Collapse task list",
    runningSummary: "{title} and {count} more",
    idleSummary: "No running tasks",
    backToOrigin: "Back to origin page",
    cancel: "Cancel",
    clear: "Clear",
    showCompleted: "Show completed",
    cancelRejected: "This task cannot be cancelled right now",
    retry: "Retry",
    retryRejected: "This task cannot be retried right now",
demoTaskTitle: "Demo task",
    replay: "Replay event stream",
    progress: "{done}/{total}",
    openAria: "Open notification center, {count} active",
    closeAria: "Close notification center",
    empty: "No notifications",
    unlabeledTask: "Background task",
  },
  bootSplash: {
    starting: "Starting VUA",
    waitingServices: "Waiting for local services…",
    updateAvailable: "New version {version} available",
  },
  /** Top-bar resource monitor (2026-09-25 ruling): reading = max(RAM, VRAM) */
  resourceMonitor: {
    indicatorAria: "System resource usage {percent}% — open details",
    title: "System resources",
    ram: "Memory (RAM)",
    vram: "Video memory (VRAM)",
    vramUnavailable: "Unavailable (collection not connected)",
    sampledAt: "Sampled at {time}",
    closeAria: "Close resource details",
  },
  nav: {
    tabs: {
      env: "Environment",
      production: "Avatar creation",
      settings: "Settings",
    },
    /** 2026-09-26 ruling: the tool collection merged into the environment
     *  module as its second sidebar group, enabling the group-label
     *  mechanism for the first time — environment group and tools group. */
    groups: {
      env: "Environment",
      tools: "Tools",
    },
    pages: {
      envPlay: "Play Environment",
      envCreate: "Creator environment",
      guideStart: "Getting Started",
      guideBasics: "Basic Controls",
      guideSafety: "Safety Settings",
      guideDevices: "Device Tips",
      guideTutorials: "Desktop/VR Tutorials",
      toolsDiscover: "Discover Tools",
      toolsDevices: "Devices & Tracking",
      toolsCalibration: "Calibration",
      toolsInstalled: "Installed Tools",
      settingsGoals: "Reset Goals",
      settingsEnvironment: "Environment & Paths",
      settingsAccounts: "Accounts",
      settingsLanguage: "Language",
      settingsTheme: "Theme",
      settingsExperimental: "Experimental features",
      settingsVersion: "Version",
      settingsAbout: "About VUA",
      settingsDonate: "Donate",
      packages: "Package Manager",
      /** 车间侧栏标签(2026-09-25 用户裁决):复合术语序列退役为直给词面 */
      workshop: "Workshop",
      /** Composing draft lives in a dialog inside the recipe page since the
       * 2026-09-20 navigation rework; the key stays as its word face. */
      composePage: "Avatar draft",
      inspectionPage: "Inspection",
    },
  },

  /** Material import page (M6 IMP-2 batch A, proposal 015 reconciliation):
   *  two honest sections - cloud (embedded browse, capability-gated) and
   *  local (W18 submission flow migrated verbatim, zero new vocabulary). */
  importPage: {
  vpmImportOption: "Convert to VPM packages on import (experimental)",
    title: "Import assets",
    subtitle: "Download assets or import files already on this PC.",
    chooseAria: "Import source selection",
    chooseLead: "Choose an import source; you can switch at any time.",
    chooseLocalCta: "Import from this PC",
    chooseCloudCta: "Import from BOOTH",
    rechooseCta: "Choose a different source",
    cloudTitle: "Download from the web",
    cloudBadge: "In-app browser · separate website session",
    cloudUnavailable: "The in-app browser is unavailable. Use your browser to download files, then import them below.",
    blockedTitle: "Navigation blocked",
    noView: 'No embedded view open.',
    openBrowseCta: "Open the BOOTH in-app browser",
    reopenBrowseCta: "Reopen the in-app browser",
    localTitle: 'Local import',
    downloadsTitle: 'Completed downloads',
    downloadsEmpty: "No completed downloads yet. Downloads from the in-app browser appear here so you can add them to your asset library.",
    downloadsReload: 'Refresh list',
    downloadsLoading: 'Loading completed downloads…',
    downloadAdopted: "Added to library",
    downloadAdoptCta: "Add to asset library",
    downloadAccepted: "The request to add this download was accepted. Follow its progress in the notification center.",
    acceptedAutoClose: "This dialog will close automatically; follow the task in the task center.",
    downloadSize: 'Size: {size}',
    downloadCompletedAt: 'Completed: {at}',
    navBarAria: 'Embedded browse controls',
    navBack: 'Back',
    navForward: 'Forward',
    navReload: 'Reload',
    navHome: 'Back to booth.pm home',
    navClose: 'Close embedded view and return to VUA',
    openInvalidAddress: 'That address could not be parsed. Enter a full URL (like https://booth.pm) or a bare domain (like booth.pm).',
    openOriginNotAllowed: 'That origin is not on the embedded-browse allowlist; nothing was opened.',
    openFailed: 'The embedded view failed to open.',
  },
  /** In-app folder picker (2026-09-25 user ruling): local import picks asset
   * folders inside the dialog (ALCOM-style); remembers the last browsed
   * folder; the Windows native picker stays as a secondary path. */
  folderPicker: {
    title: "Choose asset folder",
    pathLabel: "Current folder",
    editPath: "Edit path",
    pathInputAria: "Folder path",
    up: "Up one level",
    refresh: "Refresh",
    loading: "Loading folders…",
    emptyFolder: "This folder has no subfolders.",
    errorNotFound: "That folder does not exist.",
    errorNotDirectory: "That path is not a folder.",
    errorAccessDenied: "Access was denied. Choose another folder.",
    errorFailed: "The folder could not be opened.",
    newFolder: "New folder",
    newFolderNameAria: "New folder name",
    newFolderSubmit: "Create",
    newFolderInvalid: "That name is not valid for a folder.",
    newFolderExists: "A folder with that name already exists.",
    windowsPicker: "Use Windows folder picker",
    showHidden: "Show hidden files",
    cancel: "Cancel",
    openCta: "Open",
    retry: "Retry",
  },
  app: {
    moduleNavAria: "Modules",
    sidebarAria: "Features",
    windowMinimize: "Minimize",
    windowMaximize: "Maximize/Restore",
    windowClose: "Close",
    /** Topbar overlay entry (2026-09-26 ruling): open/focus the pinned window
     *  on the guide view. Three-context ruling (2026-10-05): this entry opens
     *  the preparation reader (ordinary reading window) */
    overlayGuide: "Guide",
    /** Preparation reader window title (taskbar / system frame) */
    readerWindowTitle: "VUA Guide",
    /** Topbar game-guide entry (three-context ruling): open the small
     *  transparent game-guide window */
    gameGuide: "Game guide",
  },
  /** Game guide (three-context ruling 2026-10-05, guidance §4, manual
   *  edition): one short step at a time over the game window. Copy restates
   *  verified guidance facts; confirm/skip records the player's own reading
   *  progress and never claims a game setting was inspected or changed. */
  gameGuide: {
    title: "Game guide",
    hide: "Hide",
    opacityLabel: "Transparency",
    /** Follow VRChat window toggle (guidance §4, default ON): the renderer
     *  persists the choice, Main enforces it */
    followLabel: "Follow VRChat window",
    /** Honest follow-status hints, shown only while the observation is not
     *  ready: the game is absent, its window is not up yet, or the
     *  observation channel itself is unavailable */
    followStatusAbsent: "VRChat window not found — the guide appears on its own once the game is running.",
    followStatusWaiting: "VRChat is starting — waiting for the game window.",
    followStatusUnknown: "Game window status is unavailable — automatic following is paused; manual controls still work.",
    confirm: "Got it",
    skip: "Skip",
    restart: "Start over",
    allDoneTitle: "All steps done",
    allDone: "This progress only records which steps you have read through; you can look again anytime. VUA has not inspected or changed any game setting.",
    steps: {
      controls: {
        title: "Basic controls",
        body: [
          "Desktop: W/A/S/D moves, the mouse turns your view, Esc opens the Quick Menu, and holding V talks (push-to-talk by default).",
          "VR: the trigger interacts, the side grip grabs, the thumbsticks move and turn, and the menu button opens the in-game menu. The full key list lives in VRChat's official controls documentation.",
        ],
      },
      audio: {
        title: "Sound and microphone",
        body: [
          "The microphone is push-to-talk by default: hold V to speak. A crossed-out mic icon on your HUD means muted.",
          "Pick your microphone and volumes in the audio section of the settings. If others cannot hear you, check Windows' recording device, the device inside VRChat, and the mute state — in that order.",
        ],
      },
      personalSpace: {
        title: "Personal Space",
        body: [
          "Personal Space in the safety settings hides or fades avatars that come inside your radius — recommended in crowded worlds and around strangers.",
          "It only changes what you see locally; other players are not notified or affected.",
        ],
      },
      untrustedUrls: {
        title: "Allow untrusted URLs",
        body: [
          "Allow Untrusted URLs is off by default: with it off, external images or videos written into a world do not load.",
          "Turning it on means you trust the addresses a world's author embedded. When unsure, keep it off — ordinary play is unaffected.",
        ],
      },
      worlds: {
        title: "Finding tutorial worlds",
        body: [
          "Open the Main Menu → Worlds and search in the language you want to learn (try \"tutorial\" or the language's name), then join a populated room and follow along.",
          "A language-checked tutorial-world list is being verified by the author; until it ships, this search route is the honest path — no invented world identifiers here.",
        ],
      },
    },
  },
  /** In-app tour (three-context ruling 2026-10-05, guidance §2): ordered
   *  highlights over real controls. Step copy states where a thing is and
   *  what to expect; absent entries explain the prerequisite honestly. */
  tour: {
    title: "VUA tour",
    stepsAria: "Guided tour",
    back: "Back",
    next: "Next",
    finish: "Finish tour",
    skip: "Skip tour",
    /** Command palette restart entry (tour state separate from reader/install) */
    paletteEntry: "Replay the VUA tour",
    /** Fallback absent note when a step has no specific hint */
    absentDefault: "This entry is not shown right now. You can continue the tour and come back later.",
    steps: {
      route: {
        title: "This is where you choose",
        body: "Environment setup prepares the software for playing VRChat; avatar production covers creating and dressing up your avatar. Choose a goal to start — you can change it anytime under Settings → Goal selection.",
      },
      network: {
        title: "Network checks live here",
        body: "Test VRChat, Steam or GitHub individually, or test all websites together. The + button adds a website. Connection help contains regional advice. Tests run only when clicked and never sign in.",
        absent: "The network checks appear here once an environment deployment goal is selected.",
      },
      checks: {
        title: "Software findings live here",
        body: "This hero summarizes the real inspection of this machine: ready, missing or needing attention. VUA only reports — it never changes your system without your confirmation.",
        absent: "The software inspection appears here once an environment deployment goal is selected.",
      },
      plan: {
        title: "Review the plan before installing",
        body: "After you pick purposes and generate a plan, every installation step is listed here for review before anything runs. A game launch entry will appear here as later install/launch steps land.",
        absent: "The installation plan appears here once an environment deployment goal is selected.",
      },
      tasks: {
        title: "Task progress lives here",
        body: "Running installs and downloads gather in the bottom taskbar; the Status entry in the topbar opens a pinned status card. Closing or exiting either never cancels a task.",
        absent: "The taskbar appears here once the task engine is ready.",
      },
      guide: {
        title: "Guidance is always reachable",
        body: "The Guide entry in the topbar opens the preparation reader; each check on the deployment page carries a \"View guide\" button that jumps to the matching section. Replay this tour anytime from the command palette (Ctrl+P).",
      },
    },
  },
  onboarding: {
    steps: {
      goals: "Choose goals",
      environments: "Refine environments",
      confirm: "Confirm & enter",
      counter: "Step {current} of {total}",
      aria: "Onboarding progress",
    },
    step1Title: "What would you like to do first?",
    step1Description:
      "We will prepare the environments your goals require. You can pick several goals and adjust them later in Settings.",
    recommended: "Recommended",
    skip: "Skip for now",
    back: "Back",
    continue: "Continue",
    goalRequired: "Select at least one goal to continue",
    goals: {
      env: {
        title: "Environment Setup",
        description:
          "Check and prepare the software, space and settings needed to play VRChat or create avatars.",
        impact: "Enables environment checks and the play/production environment status pages.",
      },
      production: {
        title: "Avatar creation",
        description:
          "Organize assets, create a {recipe}, then set up, check and prepare your avatar for upload.",
        impact: "Enables the asset library, recipes and avatar workbench.",
      },
    },
    step2Title: "Which environments should be prepared?",
    step2Description: "You can select both; their status is computed independently.",
    envRequired: "Select at least one environment to continue",
    environments: {
      play: {
        title: "Play Environment",
        description: "VRChat, a suitable VR runtime or streaming method, network and required settings.",
      },
      create: {
        title: "Production Environment",
        description: "A supported Unity, VPM, disk space and avatar creation dependencies.",
      },
    },
    step3Title: "Confirm your choices",
    selectedGoals: "Selected goals",
    willCheck: "What will be checked",
    willCheckItems:
      "Local environment checks for the environments you selected; other features stay disconnected for now.",
    wontDo: "What will not happen",
    wontDoItems:
      "No system settings are modified, no software is installed, no data is uploaded; you will be asked again before any change.",
    confirm: "Enter VUA",
  },
  deployment: {
    editorEditionOrder: "Try global 2022.3.22f1, then China 2022.3.22f1c1; use Unity Hub if both fail.",
    phases: { started: "Starting", resolving_source: "Finding the download", downloading: "Downloading", verifying: "Checking the file", installing: "Installing", inspecting: "Checking the installation", registering: "Registering the Editor", source_failed: "Download source failed", installation_failed: "Installation attempt failed", cache_rejected: "Replacing an invalid cached download", verified: "Prerequisite verified" },
    transferred: "Data processed",
    elapsed: "Elapsed time",
    installingHint: "The installer is running in the background. VUA is waiting for it to finish; Windows may ask for permission. Cancellation takes effect after this installation step.",
    sourceFailures: "Download and installation attempt details",
    mirrorHeading: "Unity download sources",
    mirrorLabel: "Allow mirror downloads",
    mirrorHint: "Unity downloads are tried first in every region. The downloaded Editor is identified as global f1 or China c1. When enabled, NoUnityCN is a backup if the official download fails.",
    downloadRegion: "Download network",
    downloadOrder: "Download order",
    downloadRegions: { china_mainland: "Mainland China", other: "Outside mainland China", unknown: "Not determined" },
    downloadSources: { official: "Unity", nounitycn: "NoUnityCN" },
    hubFallback: "Automatic deployment of both global and China Editor failed. Continue installation through Unity Hub.",
    openHub: "Install this version in Unity Hub",
    getHub: "Download Unity Hub",
    "title": "Deploy by purpose",
    "description": "Choose the environment to prepare. The plan reports observed prerequisites; real game/device and SDK project checks remain separate.",
    "installer": "Installation tool",
    "installerHint": "Unity CLI is experimental. After acquiring it, inspect again before installing Editor. Login and license selection remain separate user steps.",
    "installerKinds": {"unity_cli":"Unity CLI","hub_cli":"Existing Unity Hub CLI","unity_cli_bootstrap":"Official Unity CLI download"},
    "purpose": "Purposes",
    "purposes": {
      "desktop_play": "Desktop play",
      "pico_pcvr": "PICO PCVR",
      "pc_avatar": "PC Avatar editing",
      "quest_avatar": "Quest Avatar editing"
    },
    "location": "Unity Editor installation root",
    "locationHint": "Automatic installation must match Unity CLI’s configured Editor location. Hub is optional; VUA does not change this shared setting.",
    "plan": "Inspect and prepare a plan",
    "working": "Working…",
    "execute": "Confirm this plan and execute",
    "official": "Open instructions / download source",
    guideCta: "View guide",
    "consent": "Automatic steps install the listed version/components at the listed location. Existing software is retained. Account sign-in, licenses and elevation stay with the user. Cancellation takes effect at safe step boundaries; completed installation is not rolled back.",
    "actions": {
      "retain": "Keep existing installation",
      "manual_install": "Install through the official application",
      "inspect": "Inspect before changing anything",
      "install_editor": "Install the specified Editor through the verified installer",
      "install_unity_cli": "Download and verify the official Unity CLI",
      "add_android_modules": "Add the required Android modules"
    },
    "reasons": {
      "verified": "Prerequisite observed",
      "missing": "Required component missing",
      "unsuitable": "Installation incomplete or version unsuitable",
      "detection_failed": "Could not verify this component"
    },
    "states": {
      "queued": "Queued",
      "preparing": "Rechecking the confirmed plan",
      "running": "Executing deployment steps",
      "waiting_for_input": "Waiting for user action",
      "paused": "Paused",
      "succeeded": "Deployment task completed",
      "succeeded_with_warnings": "Task completed with outstanding steps",
      "failed": "Deployment failed",
      "cancelled": "Deployment cancelled"
    },
    "planFailed": "Could not prepare a plan. Check the selected purposes and absolute installation root, then retry.",
    "executeFailed": "Acceptance could not be confirmed. Retry this plan to retrieve the same task, or reinspect before changing consent.",
    "statusFailed": "Task status is temporarily unavailable. Installation may still be running.",
    "reinspectFailed": "The task finished, but environment refresh failed. Run detection again.",
    "inspectRequired": "Recovered task: inspect the actual environment before starting new work.",
    "failedHint": "Inspect the environment and prepare a fresh plan before retrying. Error: ",
    "vendorInstallFailed": "Unity refused the installation. Check Unity CLI’s own installation log for the cause. A regional download can substitute a China edition for the required global Editor. Correct the download source or network route before retrying; keep integrity checks enabled.",
    "vendorResultUnreadable": "Unity’s installation result could not be verified. Inspect the installed files and Unity’s own log before preparing another plan; the installer will not be retried automatically.",
    "manualRequired": "User action is required. Follow the official route shown in the plan, then inspect and prepare a new plan; this task does not prove successful installation.",
    "verified": "Prerequisites were observed. Game/device behavior, Unity launch and SDK/MA project acceptance have not been verified by this task.",
    "cancel": "Request cancellation",
    "cancelPending": "Cancellation requested; the current installer step must reach a safe boundary.",
    "cancelFailed": "Cancellation could not be confirmed. Refresh status before retrying.",
    "components": {
      "steam": "Steam",
      "vrchat": "VRChat",
      "steamvr": "SteamVR",
      "pico_runtime": "PICO Connect / Runtime",
      "unity_hub": "Unity Hub",
      "unity_cli": "Unity CLI",
      "unity_editor": "Unity Editor",
      "android_modules": "Android Build Support / SDK / NDK / OpenJDK"
    }
  },
  deployer: {
    guideCta: "View guide",
    zones: {
      play: {
        title: "Play Environment",
        readyHeadline: "You're ready to play VRChat",
        readyDescription: "All {zone} checks passed. You can move on to the next step.",
        pendingDescription: "Complete the missing items to start; fixes do not affect existing data.",
        emptyDescription:
          "Once environment detectors are connected, VRChat, VR runtime/streaming and network status will be listed here.",
      },
      create: {
        title: "Production Environment",
        readyHeadline: "You're ready to create avatars",
        readyDescription: "The {zone} hard prerequisite (Unity editor) is ready. You can start creating.",
        pendingDescription: "Complete the missing items to start creating; fixes do not affect existing data.",
        emptyDescription:
          "Once environment detectors are connected, Unity, VPM and disk space status will be listed here.",
      },
    },
    summary: {
      pending: "{count} left to prepare",
      empty: "No check items yet",
      emptyDescription: "The data source returned no check items for this zone.",
      ctaEnterNext: "Go to next step",
      ctaFixAll: "Fix all",
      ctaRecheck: "Re-run checks",
    },
    page: {
      notRunTitle: "Environment check not started",
      notRunDescription: "Once checks complete, {zone} readiness will be shown here.",
      notRunCta: "Start checks",
      notRunCtaHint: "Environment detectors arrive in a later milestone",
      checkFailed: "Failed to start checks. Please try again.",
      emptyTitle: "No check results yet",
      runningTitle: "Checking {zone}",
      runningDescription: "Checking this machine item by item; no settings or files are modified.",
      failedTitle: "Checks did not complete",
      failedDescription:
        "This run was interrupted and produced no new conclusion. Retrying does not modify any local data.",
      failedRetry: "Retry checks",
      evidenceNote: "Conclusion based on checks at {time}.",
      staleNote: "Results below are from {time}, for reference only.",
    },
    /** 检查项稳定 id → 卡片标题(消费侧文案注册表;引擎新增 id 而本表
     *  未收录时标题如实透传 checkId,不猜测) */
    checks: {
      steam: "Steam",
      vrchat: "VRChat",
      steamvr: "SteamVR",
      openxrRuntime: "OpenXR runtime",
      oculusRuntime: "Oculus runtime",
      picoRuntime: "PICO runtime",
      viveRuntime: "VIVE runtime",
      virtualDesktop: "Virtual Desktop",
      alvr: "ALVR",
      psvr2: "PlayStation VR2",
      pimaxRuntime: "Pimax Runtime",
      varjoRuntime: "Varjo Runtime",
      bigscreenBeyond: "Bigscreen Beyond",
      hpOmnicept: "HP Omnicept",
      gpu: "GPU",
      network: "Network",
      windows: "Windows version",
      diskSpace: "Disk space",
      unityHub: "Unity Hub",
      unityEditors: "Unity editors",
      vpm: "VPM capability (embedded vrc-get-vpm)",
      vcc: "VCC (VRChat Creator Companion)",
    },
    /** presence three-word closed set → check item status words (#31 fix) */
    presence: {
      detected: "Detected",
      notDetected: "Not detected",
      detectionFailed: "Detection failed",
      /** Neutral word for not-detected members of a satisfied alternative group */
      optional: "Not detected (optional)",
    },
    /** Alternative-group copy (CHECK_GROUPS): one card per group; keys match group ids */
    groups: {
      "vr_runtime": {
        title: "VR Runtimes & Streaming",
        badge: "Any one",
        satisfied: "Usable runtimes: {count}. You only need one.",
        unsatisfied: "No usable VR runtime detected. Install any one of the following to play.",
      },
    },
    fix: {
      loading: "Generating fix plan…",
      unavailable: "Fix plans are not connected yet.",
      unknownCheck: "No fix plan is available for this check item.",
      loadFailed: "Failed to generate the fix plan. Please try again.",
      impactTitle: "Impact scope",
      stepsTitle: "Fix steps",
      confirmStart: "Start",
      cancel: "Cancel",
      openPage: "Open page",
      openPageFailed: "Could not invoke the system browser; please copy the link manually.",
      stepDone: "Done, continue",
      confirmCandidate: "Confirm & continue",
      recheckNow: "Re-run checks",
    },
    versions: {
      title: "Versions",
      installed: "Installed",
      latest: "Latest",
      lastChecked: "Last checked",
      notInstalled: "Not installed",
      stateUpToDate: "Up to date",
      stateUpdate: "Update available",
      stateUnknown: "Version unknown",
      justNow: "Just now",
      minutesAgo: "{count} min ago",
      hoursAgo: "{count} hr ago",
      daysAgo: "{count} d ago",
    },
    goalOff: {
      title: "Environment setup goal not selected",
      description:
        "Environment setup was not selected during onboarding. Select the goal to enable environment checks and status conclusions.",
      cta: "Choose environment goals",
    },
    envOff: {
      title: "This environment is not a check target",
      description: "Only {other} is currently selected. To check {zone}, you can re-select your goals.",
      cta: "Re-select goals",
    },
  },
  workshop: {
    title: "Avatar workbench",
    /** 029 A6 (0.7.16 §8.5): the workshop only displays execution state; starting and approving happen on the recipe page */
    subtitle: "The workshop presents the execution status of your assembly chain; starting and approving happen on the recipe page.",
    runningSubtitle: "The workshop presents the chain's live status; task progress follows the task center's authoritative snapshots.",
    idleTitle: "Production pipeline not connected yet",
    idleDescription:
      "Once {recipe} and the setup service are available, you can view progress and recovery options here.",
    blocked: {
      title: "Production environment not ready",
      description:
        "A supported Unity editor is required for production builds. Once ready, this page presents the assembly chain's execution status.",
      cta: "Prepare creator environment",
    },
    trackAria: "{amf} production stages",
    trackHint:
      "Progress from {infeed} to {outfeed}.",
    logTitle: "Execution log",
    logHint:
      "Progress indicators follow the recorded task events.",
    conclusion: {
      running: "Pipeline running",
      needsConfirmation: "A checkpoint awaits confirmation",
      blocked: "Pipeline blocked; recover from snapshot after handling",
      completed: "All stages completed",
      notStarted: "Not started yet",
    },
    stageState: {
      completed: "Completed",
      current: "Running",
      pending: "Not started",
      needsConfirmation: "Awaiting confirmation",
      blocked: "Blocked",
    },
    station: {
      title: "Station details",
      currentState: "Current state",
      eventsTitle: "State events",
      noEventsYet: "This station has no state events up to the current moment.",
      livePendingNote: "Once the live event stream is connected, per-station event details will appear here.",
      role: {
        warehouse: "Asset library: imported assets are checked here before use.",
        recipe: "Recipe: defines the assets and settings used to create your avatar.",
        assembly: "Avatar setup: applies the assets in your recipe to the base avatar.",
        production: "Build: prepares the configured avatar for the next checks.",
        inspection: "Checks: review the results before preparing an upload.",
        release: "Build results: view completed builds and their available actions.",
      },
    },
    pipeline: {
      aria: "Production pipeline",
      recipe: "Current recipe",
      workshop: "Workshop",
      release: "Latest release",
    },
    replay: {
      play: "Play",
      pause: "Pause",
      restart: "Restart",
      controlsAria: "Replay controls",
      progressAria: "Replay progress {position} / {duration}",
      operationsLine: "{count} automatic operations completed (verifiable in the log)",
    },
    /** Execution status face (029 A6, 0.7.16 §8.5): the workshop only displays status, zero initiation actions; plan/assembly/record cards and task lines reuse strings.compose.chain wordings */
    chain: {
      title: "Execution status",
      noChainTitle: "No execution chain in this session",
      noChainDesc: "Select or save a recipe on the recipe page to start assembling; once started, this page presents the chain's resolve, plan, assembly and record status.",
      noChainCta: "Go to the recipe page",
      resolveIdleNote: "Resolve has not been requested yet.",
      planApprovalNote: "Plan approval and assembly start happen in the recipe page's selected state; this page only presents status.",
      executeIdleNote: "No assembly execution accepted yet.",
      taskDecisionNote: "This task needs handling: make the recover or cancel decision in the task center.",
    },
  },
  /**
   * Production flow (F3, hosted in the workshop page; interaction semantics:
   * docs/protocols/production-use-case-v0.1 draft). Enum-keyed groups mirror the
   * port unions in gateway/model-production-port.ts and the phase/disabled-reason
   * unions in features/workshop/production-flow-model.ts 1:1 (parity-tested).
   */
  productionFlow: {
    sectionTitle: "{production} flow",
    sectionAria: "{production} flow",
    material: {
      title: "Source asset",
      intakeAria: "Asset source",
      intake: {
        direct_unity_package: ".unitypackage direct import",
        local_reusable_vpm: "Local VPM package",
      },
      intakeNote: {
        direct_unity_package: "Imports the source .unitypackage into the target project as-is.",
        local_reusable_vpm:
          "Built as a local-reusable VPM package in an isolated staging project, then installed by the package manager.",
      },
      pick: "Choose material folder…",
      pickFirst: "Choose a material folder first",
      pickedLine: "Selected: {name}",
      start: "Start inspection",
      startHint:
        "Choose a material folder containing the .unitypackage; inspection only reads the material and the project state; nothing is modified.",
    },
    inspection: {
      title: "Asset checks",
      loadingBody: "Checking the asset against the target project…",
      findingsTitle: "Check results",
      emptyFindings: "No blocking issues found.",
      findingKind: {
        compat: "Compatible",
        missing: "Missing",
        conflict: "Conflict",
      },
      recoverable: "Recoverable",
      retryable: "Retryable",
      plannabilityTitle: "Conclusion",
      plannability: {
        plannable: "Ready to create a plan",
        needs_attention: "You can create a plan, but some items need review",
        not_plannable: "Not ready to create a plan",
      },
      requestPlan: "Generate execution plan",
    },
    plan: {
      title: "Plan review",
      loadingBody: "Generating the execution plan…",
      revisionLine: "Revision {revision}",
      stagesTitle: "Stages",
      risksTitle: "Risks",
      noRisks: "No known risks.",
      estimate: "Estimated duration: about {minutes} min",
      estimateUnknown: "No reliable estimate yet",
      diffsTitle: "Differences from the inspection",
      diffKind: {
        added: "Added",
        changed: "Changed",
        resolved: "Resolved",
      },
      riskDecisionTitle: "How to proceed",
      riskDecisionAria: "Choose how to proceed",
      riskChoice: {
        snapshot_and_continue: "Snapshot, then continue",
        continue: "Continue without snapshot",
        cancel: "Cancel the run",
        not_required: "No decision required",
      },
      riskChoiceNote: {
        snapshot_and_continue: "Creates and verifies a project snapshot first; rollback is possible on failure.",
        continue: "Runs without a snapshot; failure cannot be rolled back.",
        cancel: "Does not execute this plan.",
        not_required: "This plan needs no risk decision; confirm directly.",
      },
      rememberForSession: "Remember this choice for this session",
      rememberForSessionAria: "Remember this choice for this session",
      noRiskDecisionNotice: "This plan does not require an extra risk decision.",
      confirm: "Confirm plan and execute",
      confirmHint: "Confirms revision {revision}. If the plan changes, review and confirm it again.",
      expiredTitle: "Confirmation expired",
      expiredBody:
        "The plan changed after it was confirmed, so nothing was executed. Recover below to continue or roll back.",
    },
    recover: {
      title: "Recover",
      body: "Choose how to recover. Recovery takes time, and your choice is saved in the task record.",
      decisionAria: "Recovery decision",
      decision: {
        continue: "Continue",
        rollback: "Roll back",
      },
      continueNote: "Resume from the last safe point and finish the remaining stages.",
      rollbackNote: "Restore the pre-run snapshot and undo what was applied.",
      runningNote: "Recovery task is running…",
      confirm: "Start recovery",
    },
    record: {
      title: "Build record",
      status: {
        completed: "Completed",
        aborted: "Aborted",
        rolled_back: "Rolled back",
        rollback_failed: "Rollback failed",
      },
      stagesTitle: "Executed stages",
      factsTitle: "Evidence",
      evidence: {
        snapshot: "Snapshot",
        bridge: "Bridge job",
        localVpm: "Local VPM",
        validation: "Validation",
        attempted: "Attempted",
        notAttempted: "Not attempted",
        success: "Succeeded",
        failed: "Failed",
        outcomeUnknown: "Outcome unknown",
        jobsLine: "Operations: {count}",
        allSucceeded: "All succeeded",
        notAllSucceeded: "Some failed",
        published: "Published",
        notPublished: "Not published",
        packageId: "Package id: {packageId}",
        validationStatus: {
          passed: "Passed",
          failed: "Failed",
          skipped: "Skipped",
        },
      },
      finishedAt: "Finished at {time}",
      recovered_badge: "Recovered run",
      recovered_note:
        "This run completed after recovery.",
      /** Release-page link on completed record cards (batch-150 gap (a));
       *  plain navigation only: no record identity crosses the page boundary. */
      goRelease: "Go to release",
    },
    phase: {
      inspecting: "Inspecting",
      inspectionReady: "Inspection complete — ready to plan",
      planning: "Generating the plan",
      awaiting: "Plan awaiting confirmation",
      executing: "Executing",
      recovering: "Recovering",
      completed: "Completed",
      cancelled: "Cancelled",
      failed: "Failed",
      failedRecoverable: "Failed (recoverable)",
      expired: "Confirmation expired",
    },
    disabledReasons: {
      runActive: "A production command is still running",
      flowPending: "Finish or recover the current run first",
      noInspection: "Run a asset inspection first",
      notPlannable: "The inspection conclusion does not allow planning yet",
      noPlan: "Generate an execution plan first",
      notAwaiting: "The plan is not waiting for confirmation",
      notRecoverable: "Only recoverable failures or expired runs can be recovered",
    },
    rejected: {
      stale_revision: "The plan changed after your confirmation; review the new revision and confirm again.",
      not_recoverable: "This run is not in a recoverable state.",
      invalid_state: "The run is not in a state that accepts this action.",
      unknown_ref: "The referenced inspection, plan or task no longer exists.",
      unknown_material_source: "The material selection is no longer registered. Please pick the file again.",
      source_invalid:
        "The material source is invalid: choose a material folder containing the .unitypackage.",
    },
    states: {
      emptyTitle: "No production run yet",
      emptyDescription:
        "Choose an asset and start an inspection; planning, execution and recovery all happen here.",
      loadFailedTitle: "Failed to load production state",
      loadFailedDescription:
        "Could not read the current run. Retrying will not change your local files.",
      retry: "Retry",
      actionUnavailable: "The creation service is unavailable, so this action was not started.",
    },
  },
  guide: {
    topicsAria: "Guide topics",
    mediaAlt: {
      pcKeys: "PC keyboard diagram highlighting the talk, chat, emoji wheel keys and spacebar",
      vrController: "VR controller diagram highlighting the trigger and grip areas",
      picoUsb: "Diagram of a PICO 4 Pro headset linked to a PC by a highlighted USB cable",
      picoWifi: "Diagram of a PC and a PICO 4 Pro headset both connected wirelessly to the same router",
      steamvrDesktop:
        "Diagram of the SteamVR desktop view inside the headset, with a desktop window floating in view and a controller ray pointing at it",
      vrcftFlow:
        "Diagram of eye-tracking data flowing from a PICO headset through tracking software on the PC to an avatar's eyes",
    },
    pages: {
      room: {
        title: "Room & Play Area",
        intro:
          "Prepare the physical space before the software — a safe, comfortable play area makes every later step easier.",
        sections: [
          {
            id: "space",
            title: "Clear your play space",
            paragraphs: [
              "Standing play wants roughly 2×2 m of clear floor; seated or in-place play works with less. Move loose cables, chairs with hard corners and anything fragile out of arm's reach.",
              "Set the play boundary when the headset or SteamVR asks for it — take the boundary seriously in a shared room; children and pets are the usual surprise guests.",
            ],
          },
          {
            id: "lighting",
            title: "Lighting the room",
            paragraphs: [
              "The headset tracks your room with cameras: even, ordinary indoor lighting works best. Avoid direct sunlight on the play area and strong backlight right behind you.",
              "Keep the headset's camera areas clean and unobstructed — smudges or covers over them degrade tracking noticeably.",
            ],
          },
          {
            id: "network",
            title: "Network for streaming",
            paragraphs: [
              "PICO streaming over Wi-Fi wants the headset and the PC on the same router, ideally on the 5 GHz band, with the router in or near the play room. Walls and appliances between the router and the headset cost image quality.",
              "If the stream stays unstable, a USB cable is the steady fallback — the devices chapter covers the connection steps.",
            ],
          },
          {
            id: "comfort",
            title: "Comfort and breaks",
            paragraphs: [
              "Adjust the head strap so the weight rests on the top of your head, not on your face; a loose fit blurs the view and tires the neck.",
              "Keep water nearby and take short breaks regularly — VR fatigue builds quietly, and the first sessions should end before it does.",
            ],
          },
        ],
      },
      start: {
        title: "Getting Started",
        intro: "From a Steam account to your first world — the full first-play path.",
        sections: [
          {
            id: "prepare",
            title: "Before you start",
            paragraphs: [
              "Where: VUA's environment pages. Run the environment and network checks there first; if Steam or VRChat is missing, they show the official install route.",
              "Desktop play needs only Steam and VRChat, and VRChat is free. PICO streaming adds SteamVR and PICO Connect on top.",
              "If a check fails: the network check reports each service separately — apply its suggested remedy and re-check before continuing.",
            ],
          },
          {
            id: "steam-account",
            title: "A Steam account (register or sign in)",
            paragraphs: [
              "Where: the \"Join Steam\" page on the Steam website, or the Steam client's sign-in window. New players register with an email address and complete the email and human verification themselves; existing players simply sign in.",
              "You should see: your Steam display name inside the client once signed in.",
              "If it fails: verification mail can land in spam, and the sign-up page may not load over a bad route — check spam first, then return to VUA's network check and follow its remedy.",
            ],
          },
          {
            id: "install-vrchat",
            title: "Install VRChat through Steam",
            paragraphs: [
              "Where: the VRChat page in the Steam store. Press \"Play Game\" — VRChat is free — and Steam adds it to your library and downloads it.",
              "You should see: VRChat in your Steam library with a green \"Play\" button once the download finishes.",
              "If it fails: slow or stuck downloads usually clear by changing the download region in Steam's settings or freeing disk space; a library-folder error means picking another install location.",
            ],
          },
          {
            id: "first-launch",
            title: "First launch and login",
            paragraphs: [
              "Where: press \"Play\" on VRChat in your Steam library. On the login screen, choose to sign in with your Steam account — no separate registration is needed to start playing.",
              "You should see: the game finish loading and drop you into a world where you can move (W/A/S/D) and open the Quick Menu (Esc). Home may be a private instance with nobody else around — that is normal; to meet other players, open the menu and join a public world.",
              "If it fails: a stuck loading or login screen usually means an unhealthy route to VRChat's servers — re-run VUA's network check; a crash at launch calls for a GPU driver update and a retry.",
              "Optional: for a full VRChat account, sign in to the game through Steam, then open Main Menu → Settings → Link Account. Choose \"Upgrade to a VRChat Account\" to upgrade the current platform account and keep its friends, favorites and other data, or \"Link to an Existing Account\" to merge into an account you already have. If the platform account has Creator Economy or Shop purchases, use the upgrade option; merging into an existing account is unavailable. Follow the instructions shown for the selected option.",
            ],
          },
          {
            id: "first-steps",
            title: "Your first minutes in a world",
            paragraphs: [
              "Learn three things first: pick a public avatar at a mirror to change how you look; open the Quick Menu with Esc and find the way back to your Home world; then follow a friend through a portal or pick another world from the menu.",
            ],
          },
        ],
      },
      basics: {
        title: "Basic Controls",
        intro: "Desktop-mode movement, menus, sound and microphone, plus a VR controller reference for streaming.",
        sections: [
          {
            id: "movement",
            title: "Move and look (desktop)",
            paragraphs: [
              "W/A/S/D moves, the mouse turns your view, Shift sprints, Space jumps where the world allows it, C crouches and Z goes prone. Left click interacts or picks things up; hold right click to show the interaction cursor.",
            ],
          },
          {
            id: "menu",
            title: "Where the menus are",
            paragraphs: [
              "Esc opens the Quick Menu — respawn, settings and the player list live here, and it expands into the Main Menu for worlds, avatars and social features. R opens the Action Menu, home of expressions and the OSC toggle that eye tracking uses.",
            ],
          },
          {
            id: "keys-pc",
            title: "PC key reference",
            media: "pc-keys",
            caption:
              "Illustration, not a game screenshot: the everyday PC keys — talk, chat, menus and jump.",
            paragraphs: [
              "Learn these first: hold V to talk (push-to-talk by default), Y for the chatbox, Esc for the Quick Menu and Space to jump. The full list lives in VRChat's official controls documentation.",
            ],
          },
          {
            id: "sound-mic",
            title: "Sound and microphone",
            paragraphs: [
              "The microphone is push-to-talk by default: hold V to speak. Watch the mic icon on your HUD — crossed out means muted.",
              "Where: the audio section of the Settings picks the microphone device and adjusts volumes.",
              "If others cannot hear you: check Windows' default recording device, the device selected inside VRChat, and that you are not muted — in that order.",
            ],
          },
          {
            id: "keys-vr",
            title: "VR controller reference",
            media: "vr-controller",
            caption:
              "Illustration, not a game screenshot: a VR controller's trigger and grip areas.",
            paragraphs: [
              "In VR, the trigger interacts and the side grip grabs; thumbsticks move and turn, and the menu button opens the in-game menu. VRChat publishes no PICO button chart — PICO bindings come from SteamVR's controller settings.",
            ],
          },
        ],
      },
      safety: {
        title: "Safety Settings",
        intro: "Spend two minutes on these settings before entering crowded worlds.",
        sections: [
          {
            id: "open-urls",
            title: "Allow untrusted URLs",
            paragraphs: [
              "Where: the Settings, under Comfort & Safety. \"Allow Untrusted URLs\" is off by default; without it, many worlds' videos, images and music will not load.",
              "Turn it on when you want world media to play, and stick to links from worlds and people you trust.",
            ],
          },
          {
            id: "personal-space",
            title: "Personal space and portal confirmation",
            paragraphs: [
              "Personal Space lives on the same settings page and is on by default: avatars that press too close are hidden automatically, and entering someone else's portal always asks for your confirmation first.",
            ],
          },
          {
            id: "trust",
            title: "Trust ranks and the safety shield",
            paragraphs: [
              "Nameplates show trust ranks, from Visitor up to Trusted User, while the Quick Menu is open. The Safety page's shield levels decide whose avatars and effects you see per rank — the default Normal level is a good starting point.",
            ],
          },
          {
            id: "mute-block",
            title: "If someone bothers you: mute, hide, block",
            paragraphs: [
              "Where: open the Quick Menu and select the player. You can mute their voice, hide just their avatar, or block the user entirely.",
              "If a situation feels wrong, leaving is always fine — respawn or return to your Home world from the Quick Menu.",
            ],
          },
        ],
      },
      devices: {
        title: "Device Tips",
        intro: "PICO 4 Pro streaming over USB or Wi-Fi, reading this guide inside the headset, and optional eye tracking.",
        sections: [
          {
            id: "platforms",
            title: "What each platform can play",
            paragraphs: [
              "All platforms play together; avatars and worlds mark platform compatibility — watch for the green available badge.",
            ],
          },
          {
            id: "pico-prepare",
            title: "Before streaming: what to install",
            paragraphs: [
              "Where: your PC and the headset. On the PC, install SteamVR and PICO Connect from the official PICO site. PICO's current requirements are Windows 10 22H2 or later, 8 GB of RAM, and a GTX 1060 6GB / RX 480 class GPU or better.",
              "On the headset, update PICO OS to the latest version — current PICO Connect needs PICO OS 5.11.2 or later, and eye tracking needs 5.9.0 or later — and install the PICO Connect app from the PICO Store. Headset activation itself follows PICO's official flow.",
              "If the installer refuses: check the Windows version and free disk space first, then reinstall from the official page.",
            ],
          },
          {
            id: "pico-usb",
            title: "USB streaming: connect and play",
            media: "pico-usb",
            caption:
              "Illustration, not a software screenshot: the PICO 4 Pro linked to the PC over a USB cable.",
            paragraphs: [
              "Where: between the PC and the headset. Use a USB-C cable that carries data — USB 3 recommended; a charge-only cable will not work.",
              "Do: open PICO Connect in the headset, choose the USB connection, and follow the pairing prompt. Once connected, SteamVR starts; launch VRChat from your library as usual.",
              "You should see: the SteamVR status window report the headset and controllers ready, and the SteamVR environment appear inside the headset.",
              "If it fails: an undetected headset usually means the cable or the port — try another cable and a USB port directly on the PC, then restart PICO Connect and SteamVR.",
            ],
          },
          {
            id: "pico-wifi",
            title: "Wi-Fi streaming: connect and play",
            media: "pico-wifi",
            caption:
              "Illustration, not a software screenshot: the PC and the headset on the same router over Wi-Fi.",
            paragraphs: [
              "Before connecting: plug the PC into the router with Ethernet if you can, put the headset on the router's 5 GHz Wi-Fi, and stay near the router — both devices must be on the same local network.",
              "Do: open PICO Connect in the headset and pick your PC — current versions discover PCs on the network automatically — then connect and start VRChat as with USB.",
              "You should see: the same ready states as USB streaming.",
              "If it fails: a PC that never appears usually means two different networks or a firewall blocking PICO Connect — confirm both, then let the app through the firewall. Blurry or stuttering video means a weak wireless path: move closer to the router, switch to the 5 GHz band, or wire the PC.",
            ],
          },
          {
            id: "headset-guide",
            title: "Read this guide inside the headset",
            media: "steamvr-desktop",
            caption:
              "Illustration, not a software screenshot: reading this guide through SteamVR's desktop view.",
            paragraphs: [
              "Where: the SteamVR dashboard while streaming. Press the controller's menu button to raise the dashboard — PICO bindings come from SteamVR's controller settings — and choose the Desktop view.",
              "Do: find the VUA guide overlay on the desktop, point at it with the controller ray, and click with the trigger to scroll and switch topics. Press the menu button again to close the dashboard and return to the game.",
              "You should see: your PC desktop floating in front of you, with this guide readable and scrollable.",
              "Note: this is SteamVR's desktop view, not a native VUA VR overlay.",
              "If it fails: no dashboard means SteamVR is not running or the binding differs — check the SteamVR status window and controller bindings; if you cannot find the guide window, confirm the overlay is open on the PC.",
            ],
          },
          {
            id: "eye-tracking",
            title: "Optional: PICO 4 Pro eye tracking",
            media: "vrcft-flow",
            caption:
              "Illustration, not a software screenshot: eye data flowing from the headset through the tracking software to your avatar.",
            paragraphs: [
              "This is optional — skipping it changes nothing about normal play. The PICO 4 Pro carries eye and face tracking cameras, and the free VRCFaceTracking (VRCFT) app relays them to VRChat.",
              "Headset: update PICO OS to 5.9.0 or later, enable Eye Tracking and Lip Tracking under the LAB tab in Settings, and run the headset's eye-tracking calibration.",
              "PC: install VRCFT from Steam, open its Module Registry tab, and install the \"Pico4SAFTExtTrackingModule\".",
              "Upstream's current PICO note: VRCFT's PICO 4 Pro guide (docs.vrcft.io, under Hardware → PICO → PICO 4 Pro) currently asks for a temporary fix — quit PICO Connect completely, open %AppData%\\PICO Connect\\setting.json in a text editor, set faceTrackingTransferProtocol to 2 and faceTrackingMode to 1, save the file, then start PICO Connect again. The fix also keeps tracking alive while the microphone is in use; if the document says otherwise, follow the document.",
              "Order matters: connect PCVR over PICO Connect and reach SteamVR first, then start VRCFT and confirm the module initializes.",
              "In VRChat: open the Action Menu with R, go to Options, OSC, and turn OSC on.",
              "You should see: a suitable avatar's eyes follow your gaze and mirror your blinks. Most Av3.0 avatars already support basic eye movement; full face expressions need a VRCFT-compatible avatar. After 10 seconds without data, VRChat falls back to automatic blinking.",
              "If it fails: eyes not moving means checking, in order, the OSC toggle, the module's initialization and the startup order; tracking that dies when the microphone runs points back to the setting.json fix above; and if VRCFT will not close, that is a known upstream issue — end its process.",
            ],
          },
          {
            id: "play-comfort",
            title: "Tracking, IK and performance",
            paragraphs: [
              "Without extra trackers the game estimates poses with IK, so occasional clipping while sitting is normal.",
              "For stutter, first lower the avatar display count and shadows; VRAM-heavy avatars can be hidden for you alone.",
            ],
          },
        ],
      },
      tutorials: {
        title: "Reading This Guide",
        intro: "Where this guide lives, and how to read it while playing — on the desktop and inside the headset.",
        sections: [
          {
            id: "surfaces",
            title: "The desktop guide overlay",
            paragraphs: [
              "This guide lives in VUA's lightweight overlay window. Open or hide it at any time from the main window; it never steals focus from the game, and closing it never cancels an installation or stops VRChat.",
            ],
          },
          {
            id: "headset",
            title: "Reading in the headset",
            paragraphs: [
              "On the PICO path there is no separate VUA VR overlay — raise SteamVR's desktop view and read this same window there. The steps are in Device Tips, \"Read this guide inside the headset\".",
            ],
          },
          {
            id: "accounts",
            title: "About accounts",
            paragraphs: [
              "Both account routes start in the game: sign in through Steam, then open Main Menu → Settings → Link Account. \"Upgrade to a VRChat Account\" upgrades the current account and keeps its data; \"Link to an Existing Account\" merges into an existing VRChat account. With Creator Economy or Shop purchases, choose the upgrade option instead of merging. Follow the on-screen instructions.",
            ],
          },
        ],
      },
      /** VUA walkthrough topic (2026-09-26 guide-host ruling): read-only, written
       *  for what the app actually does today — no promises about unshipped
       *  capabilities. */
      vua: {
        title: "Using VUA",
        intro: "A quick tour of the VUA window and its main flows, written for what the app actually does today.",
        sections: [
          {
            id: "window-tour",
            title: "Meet the VUA window",
            paragraphs: [
              "The top bar holds, left to right, the module tabs (Environment / Avatar creation), Settings, feature search (Ctrl+P), the guide and notifications; the sidebar lists the active module's feature groups.",
              "The task center sits at the bottom of the screen — background tasks and downloads collect there; the bell in the top-right opens the notification list.",
            ],
          },
          {
            id: "environment-page",
            title: "The environment pages",
            paragraphs: [
              "The play/production pages run an environment check first; when the result falls short, a fix plan walks you through the steps.",
              "The tool collection lives in the Tools group of the environment sidebar. It is not connected yet, and the page shows its honest empty state.",
            ],
          },
          {
            id: "import-paths",
            title: "Two ways to import assets",
            paragraphs: [
              "Local assets: pick a folder containing .unitypackage files with the in-app folder picker on the warehouse page, and it lands in the warehouse.",
              "BOOTH items: open the product page in the embedded browser window, buy and download with your own account, then adopt the download into the warehouse in one click.",
            ],
          },
          {
            id: "production-line",
            title: "The production line",
            paragraphs: [
              "The line runs Warehouse → Recipe → Workshop → Release: assets enter the warehouse, get combined in a recipe, then move to the workshop for a confirmed run.",
              "Inspection is folded into the build record: its results appear with the record instead of as a separate step.",
            ],
          },
          {
            id: "settings-basics",
            title: "Handy settings",
            paragraphs: [
              "Appearance offers dark, light, or follow system; follow system tracks Windows' light/dark mode live.",
              "Resource saver mode turns off decorative motion to reduce usage — handy for VR or low-end machines.",
            ],
          },
        ],
      },
    },
  },
  tools: {
    notConnectedTitle: "Tool catalog not connected yet",
    cardFieldsNote:
      "Every connected tool declares: what problem it solves, whether it is installed, where data is sent, and who maintains it.",
    groups: {
      devices: "Devices & Tracking",
      calibration: "Space Calibration",
      capture: "Capture & Input",
    },
    fields: {
      purpose: "What it solves",
      installed: "Installed?",
      dataDestination: "Data destination",
      maintainer: "Maintainer",
    },
    installedYes: "Installed",
    installedNo: "Not installed",
    openHomepage: "Open website",
    openHomepageImpact:
      "Opens the official website in your browser. In-app launch and settings import are not available yet.",
    openHomepageFailed: "Failed to open. Check your system browser settings and retry.",
    groupEmpty: "No tools in this group yet.",
    installedEmpty: "No installed tools yet.",
    pages: {
      discover: {
        title: "Discover Tools",
        description: "A catalog of reviewed community tools arrives in a later milestone.",
      },
      devices: {
        title: "Devices & Tracking",
        description: "Adapter entries for headsets, controllers and trackers arrive in a later milestone.",
      },
      calibration: {
        title: "Calibration",
        description: "Space and tracking calibration entries arrive in a later milestone.",
      },
      installed: {
        title: "Installed Tools",
        description: "Management and updates for installed tools arrive in a later milestone.",
      },
    },
  },
  warehouse: {
    importedBadge: "Imported",
    libraryState: {
      cloud_only: "In account", present: "Local files", partial: "Some files missing", missing: "Files missing",
      changed: "Files changed", unreadable: "Cannot read files", downloading: "Downloading", downloadFailed: "Last download failed",
      downloadPartial: "Some downloads incomplete", inspectRequired: "Inspection needed", attention: "Needs attention",
      productionUnchecked: "Local storage is checked separately from suitability for production.",
      manageFiles: "Manage download files", chooseReplacement: "Choose the copy to replace", copyOption: "Copy {index}: {name} · {state}",
      replaceCta: "Download and replace ({count})", previousPage: "Previous", nextPage: "Next", page: "Page {page} of {total}",
    },
    viewCards: "Cards",
    loginBrowser: {
      successTitle: "Signed in",
      autoCloseHint: "Closing in {countdown}s",
      cancel: "Cancel",
    },
    downloadChecklist: {
      title: "Choose files to download: {name}",
      empty: "No captured file list for this product yet; sync the BOOTH library first.",
      absent: "The file-list query is unavailable right now.",
      notFound: "This product is not in the local catalog yet.",
      unnamedFile: "(unnamed #{id})",
      cancel: "Cancel",
      startCta: "Download {count} file(s)",
    },
    cardMenu: {
      reDownload: "Re-download",
      downloadBusyHint: "Another download of these files is still running.",
      downloadAmbiguousHint: "Choose which existing local copy to replace before downloading.",
      downloadReadFailedHint: "Progress could not be read. Retrying; completion is not confirmed.",
      downloadInspectHint: "These file results need inspection. Stored files are kept; check the task record.",
      downloadProgressHint: "Stored {stored}/{total} files; failed {failed}, cancelled {cancelled}.",
      downloadTerminalHint: "Finished: stored {stored}/{total}, failed {failed}, cancelled {cancelled}.",
      download: "Download to local",
      downloadQueuedHint: "{count} file(s) queued; progress in the notification center.",
      downloadNoCapture: "No captured files for this product yet; sync the BOOTH library first.",
      downloadFailedHint: "The download could not be queued; try again later.",
      downloadSessionExpired: "The BOOTH session expired; sign in again under Settings - Accounts, then retry the download.",
      downloadAdoptedHint: "Download finished and imported automatically; any failed files show in the notification center.",
          deleteLocal: "Delete local files",
          showCompatible: "Show compatible items",
      deleteConfirm: "Delete local files for this product? Records are kept.",
      deleteSubmittedHint: "Submitted {count} delete task(s); progress in the notification center.",
      deleteFailedHint: "Local file deletion was rejected; the task record keeps the reason.",
    },
    selectBar: {
      addToRecipe: "Add to draft ({count})",
      clearSelection: "Clear selection",
    },
    removeFiles: {
      actions: "Item actions",
      unresolvedReferences: "{count} {recipe} assets use references that cannot be matched to local files yet. They may also be affected.",
      fileChanged: "The file content changed. Inspect it and refresh.", fileUnreadable: "The file cannot be read. Check access and refresh.",
      fileRemoveFailed: "The file could not be deleted. Close applications using it and try again.", copyChanged: "The file association changed. Refresh the preview.",
      outsideRoot: "This file is outside the managed library. VUA will not delete it.",
      title: "Delete local files", note: "The library record and {recipe} references will stay. Missing files can be downloaded again.",
      loading: "Reading files and references…", loadFailed: "Could not read files or references. Refresh and try again.",
      resultUnknown: "Could not confirm deletion. It may still be running. Retry this same request or inspect Tasks.", retryRequest: "Check or retry this deletion",
      empty: "This item has no managed files.", selected: "{count} files selected", selectAll: "Select all", clear: "Clear selection",
      original: "Original file", generated_vpm: "Generated VPM", oldVersion: "Old generated version",
      present: "Stored locally", missing: "File missing", changed: "File changed", unreadable: "Cannot read file",
      references: "Affected {recipe} documents and drafts", noReferences: "No saved references found.", draftsOnly: "Only selection drafts were checked. Production {recipe} documents are unavailable in this session.",
      reference: "{title} · revision {revision}", referenceMissing: "No matching local file would remain", referenceRetained: "Other matching local files would remain",
      confirm: "Delete the selected files", cancel: "Cancel deletion", retry: "Refresh preview",
      busy: "These files are in use. Wait for the current task, then refresh.", drift: "Files or references changed. Refresh the preview before deleting.",
      failed: "Deletion could not be confirmed. Check the task and refresh before starting another deletion.",
      running: "Deleted {removed} · already missing {missing} · failed {failed} · pending {pending}",
      succeeded: "Selected files were removed or already missing.", succeeded_with_warnings: "Some files could not be deleted.",
      cancelled: "Deletion was cancelled. Completed deletions are shown below.", unconfirmed: "Deletion was interrupted. Inspect the task; it will not continue automatically.",
      removed: "Deleted", already_missing: "Already missing", fileFailed: "Not deleted", pending: "Pending",
      draftPresent: "Local file present", draftMissing: "Local file missing", draftNotStored: "No matching local file", draftStatusFailed: "File status could not be read", regenerate: "Current original requires VPM generation",
    },
    recipeDialog: {
      title: "Add to Recipe draft",
      selectionLabel: "Selected",
      noRecipes: "No drafts yet. Select materials in the library to create one.",
      newRecipePlaceholder: "New draft name",
      newRecipeCta: "Create & Add",
      alreadyInRecipe: "Already in this draft ({count} references total)",
      conflict: "This draft changed. Reload it before saving again.",
      loadFailed: "The draft could not be read or saved. Try again.",
      addedToDraft: "Added {count} references to the draft.",
      createdDraft: "Created {title} with {count} references.",
      draftNote: "Drafts collect material references. Production settings still need to be designed and confirmed before use.",
      selectionMore: "{names} and more ({count} total)",
      selectionCount: "{count} references",
      libraryTitle: "Recipe drafts",
      openDraft: "View draft",
      nameLabel: "Draft name",
      emptyDraft: "This draft has no material references.",
      removeSelection: "Remove reference",
      saveDraft: "Save draft",
      savedDraft: "Draft saved.",
      refreshDraft: "Reload saved draft",
    },
    compatibleDialog: {
      title: "Dependencies of {name}",
      empty: "No dependencies declared on this product page.",
      absent: "Dependency observations are not connected yet.",
      notFound: "This product is not in the local catalog yet.",
      resolvedCta: "Open",
      kind: {
        shader: "Shader",
        tool_package: "Tool package",
        avatar_base: "Avatar base",
        other: "Other",
      },
    },
    viewList: "List",
    viewToggleAria: "Toggle card/list view",
    catalogSync: {
      warningHint: "Library sync finished with skipped items. See the task record.",
      cancelledHint: "Library sync cancelled. Saved catalog entries were kept.",
      inspectHint: "The previous sync was interrupted. Inspect the task before syncing again.",
      unconfirmedHint: "Reading stopped, but its final result could not be recorded. Check the task before retrying.",
      progressHint: "Pages: {pages} · Records saved: {count} · Skipped: {rejected}",
      readFailedHint: "Sync status is temporarily unavailable. Retrying…",
      signInRequired: "Sign in to BOOTH first, then sync.",
      completedHint: "Library sync finished.",
      failedHint: "Library sync failed. Retry from the button; the task record keeps the failure.",
      taskTitle: "BOOTH library sync",
      action: "Sync BOOTH library",
      startedHint: "Library sync started. Progress appears in the notification center.",
      alreadyRunning: "A library sync is already running.",
      signInTitle: "Sign in to BOOTH to sync your library",
      signInDescription:
        "Your catalog is empty. Sign in with your own BOOTH account in the embedded browser, then sync; VUA never handles your credentials.",
      signInAction: "Open sign-in page",
      syncTitle: "Sync your BOOTH library",
      syncDescription:
        "Your catalog is empty. Sync to list the material available to your own BOOTH account; nothing is downloaded until you choose it.",
    },
    subtitle:
      "Manage product information and assets saved on this PC. Open BOOTH product pages in the app or your browser, and use your own account for purchases.",
    searchPlaceholder: "Search title or product ID",
    searchAria: "Search catalog products",
    /** 029 slice 3 (A3 local segment): asset picker = warehouse read-face
     *  projection. No third import entry lives here (imports stay on the
     *  import page); cloud access is honestly absent pending BOARD #46. */
    selector: {
      listAria: "Warehouse entries to add to the recipe",
      localOnlyNote: "This picker shows local warehouse entries only. Importing new assets stays on the import page; cloud asset access is honestly absent until a ruling lands.",
      pickCta: "Add",
      addedBadge: "Already in recipe",
    },
    filters: {
      source: "Library source",
      sourceAll: "All sources",
      sourceBought: "Bought items",
      sourceGifts: "Received gifts",
      sourceFree: "Free downloads",
      sourceLocal: "Local assets",
      downloadState: "Download state",
      downloadAll: "Any state",
      downloaded: "Downloaded",
      notDownloaded: "Not downloaded",
      availability: "Availability",
      entityType: "Asset type",
      relationKind: "Relation",
      allAvailability: "All availability",
      allEntityTypes: "All asset types",
      allRelationKinds: "All relations",
    },
    resultCount: "Showing {shown} of {total} library entries",
    resultCountAll: "Library entries: {total}",
    availability: {
      available: "Available",
      unavailable: "Discontinued",
      unknown: "Unknown",
      deleted: "Listing deleted",
    },
    relationKind: {
      compatible_with: "Compatible",
      addon_for: "Add-on for",
      requires: "Requires",
    },
    entityType: {
      avatar: "Avatar",
      outfit: "Outfit",
      texture: "Texture",
      hair: "Hair",
      accessory: "Accessory",
      prop: "Prop",
      shader: "Shader",
      animation: "Animation",
      tool: "Tool",
      other: "Other",
    },
    album: {
      prevImage: "Previous",
      nextImage: "Next",
      zoomImage: "Zoom in",
      closeZoom: "Close zoom view",
    },
    card: {
      unknownShop: "Unknown shop",
      detailsCta: "View details",
      free: "Free",
      priceRange: "{currency} {amount}~{high}",
      price: "{currency} {amount}",
      noPrice: "No price info",
      noImage: "No image yet",
      entityCount: "Assets: {count}",
    },
    detail: {
      panelAria: "Product details",
      close: "Close",
      closeAria: "Close product details",
      notFound: "Product not found. It may have been removed from the catalog, or local data needs an update.",
      loadFailed: "Failed to load details.",
      tombstoneNote:
        "The product page was deleted. Its last title and main image are retained so existing references can still be identified.",
      adultBadge: "R-18",
      availabilityEvidence: "Raw label: {raw}",
      ageRestrictionNote: "Age restriction: {value}",
      entitiesTitle: "Assets and compatibility",
      entitiesEmpty: "No asset details have been identified for this product yet.",
      attributionTitle: "Shop & creator",
      subproductsTitle: "Purchase options and prices",
      subproductUnnamed: "Unnamed option",
      variantPurchasedBadge: "Purchased",
      videosTitle: "Videos",
      openVideoFailed: "Could not invoke the system browser; please copy the video link manually.",
      termsTitle: "Tags",
      descriptionTitle: "Description",
      sourceTitle: "Source",
      openSource: "Open source page in browser",
      openSourceFailed: "Could not invoke the system browser; please copy the link above manually.",
      openInApp: "Open in app window",
      openInAppFailed: "Could not open the in-app window; use the system browser instead.",
      sourceUrlNote:
        "Sign in, purchase and download on the original product page. Once files are saved locally, add them to {warehouse}.",
      retry: "Retry",
      preview3dTitle: "3D preview",
      preview3dNote: "Real-time VRM preview is planned: models that arrive locally will be rotatable here.",
      debugTitle: "Debug info",
    },
    acquire: {
      viewCatalog: "Catalog",
      viewLocal: "Local assets",
      viewSwitchAria: "Switch catalog / local assets view",
      trackCatalogDesc: "Product information saved on this PC. Purchase and download from the original source.",
      trackLocalDesc: "Imported asset packages and their check results",
      entriesTitle: "Assets in your library",
      entriesEmpty:
        "No assets in your library yet. Add a completed download or import local folders.",
      entryCount: "Assets: {count}",
      artifactsTitle: "Package files",
      previewEmpty: "Preview images not extracted yet",
      /** D-6 entry-detail preview honest empty states (AC-12): association fact / face-status statement */
      previewNoAssociation: "No catalog source linked",
      previewNoImages: "No preview images from the linked catalog sources yet",
      sizeB: "{amount} B",
      sizeKb: "{amount} KB",
      sizeMb: "{amount} MB",
      sizeGb: "{amount} GB",
      verdict: {
        pending: "Pending inspection",
        clean: "No executables found",
        quarantined: "Quarantined",
      },
      role: {
        original: "Original package",
        generated_vpm: "Generated VPM package",
      },
      kind: {
        imported_material: "Batch import",
        downloaded_material: "Authorized download",
      },
      mode: {
        use_original_unitypackage: "Use original UnityPackage",
        generate_vpm: "Generate VPM package",
      },
      modeOverride: "Custom setting",
      modeFollowGlobal: "Uses the default setting",
      /** F4-9 mode editing and entry actions (bdl-commands v0.1); the global
       *  default is provider runtime configuration off the wire - the renderer
       *  only presents the read-only follow-global semantics. */
      modeEditTitle: "Package format",
      modeFollowGlobalOption: "Use the default setting",
      modeApply: "Apply setting",
      modeApplying: "Applying…",
      actionsTitle: "Entry actions",
      actionGenerateVpm: "Generate VPM",
      actionDeleteOriginals: "Delete originals",
      deleteConfirmNote: "Deletion cannot be undone: original files are removed from the warehouse; the generated VPM copy is kept.",
      acceptedNote: "Accepted - see the notification center for progress.",
      commandFailed: "The operation could not be completed.",
      commandErrors: {
        vua_warehouse_invalid_state: "The effective mode is not “Generate VPM”; this action is unavailable.",
        vua_warehouse_generated_artifact_missing: "The generated VPM copy is missing or failed verification; originals cannot be deleted.",
        vua_warehouse_no_original_material: "No original asset package is available for conversion.",
        vua_warehouse_already_generated: "A VPM package copy already exists; delete it before regenerating.",
        vua_warehouse_entry_not_found: "Entry not found; local data may have changed.",
        vua_warehouse_unavailable: "The warehouse service is not connected.",
        vua_warehouse_invalid_params: "Request parameters failed validation.",
        vua_warehouse_storeFailed: "Warehouse storage failure.",
        vua_warehouse_generation_failed: "Generation failed and can be retried.",
        vua_warehouse_maintenanceIoFailed: "The maintenance operation hit a filesystem failure and can be retried.",
        fallback: "The operation could not be completed.",
      },
      importTitle: "Import asset folders",
      importPick: "Choose folders",
      importConfirmTitle: "Confirm the folders to import",
      importConfirmDesc: "Each folder is added as one asset package. It appears in the library when importing finishes.",
      importAccepted: "Accepted: the import task is in the notification center; entries appear on this page when it completes.",
      importConfirmCta: "Confirm import",
      importCancel: "Cancel",
      importRemove: "Remove",
      importEmptySelection: "No folders selected.",
      detailLoadFailed: "Failed to load the entry detail.",
      detailNotFound: "Entry not found. It may have been removed, or local data needs an update.",
      neverRunNote:
        "Executable content inside archives is never run automatically; quarantined assets cannot be referenced by {recipe}.",
      pendingNote: "Until inspection completes, pending assets cannot be referenced by {recipe}.",
      states: {
        notConnectedTitle: "Local asset gallery not connected yet",
        notConnectedDescription:
          "Once the capability is connected, warehouse asset entries and inspection results will appear here as a gallery.",
      },
    },
    states: {
      notConnectedTitle: "Catalog not connected yet",
      notConnectedDescription:
        "Once the catalog capability is connected, a browsable, searchable product catalog will appear here.",
      loadFailedTitle: "Failed to load catalog",
      loadFailedDescription: "Something went wrong reading catalog data. Retrying does not modify any local data.",
      retry: "Retry",
      emptyResultTitle: "No matching products",
      emptyResultDescription: "Try a different search term or loosen the filters.",
    },
  },
  tutorial: {
    surfaceTitle: "Tutorial",
    progress: "Step {index} / {total}",
    next: "Next",
    back: "Back",
    dismiss: "Close tutorial",
    openOnDesktop: "View on desktop",
    vrDevEntry: "VR tutorial (dev verification)",
    vrDevReset: "Reset VR helper (dev diagnostics)",
    topmostOn: "Unpin window from top",
    topmostOff: "Pin window on top",
    completedTitle: "Tutorial completed",
    completedBody: "The demo session has finished. Closing the window ends this tutorial.",
    inactiveTitle: "No tutorial in progress",
    inactiveBody:
      "Start the desktop tutorial window from the guide page in the main window, and tutorial steps will appear here.",
    loadErrorTitle: "Cannot reach the app layer right now",
    loadErrorBody:
      "The tutorial snapshot request failed or timed out. Retrying does not affect the main window; closing this window does not end the tutorial session there either.",
    retry: "Retry",
    closeWindow: "Close window",
    steps: {
      "demo-welcome": {
        title: "Welcome to the VUA tutorial",
        body: "This is a demo session running on desktop and VR together, verifying the dual-surface sync pipeline.",
      },
      "demo-controls": {
        title: "Four semantic actions",
        body: "Back, next, close, view on desktop — the VR tutorial surface only ever sends these four actions.",
      },
      "demo-recap": {
        title: "Session state sync",
        body: "The desktop window and VR tutorial see the same session; act on either side and the other follows instantly.",
      },
      "start-prepare": {
        title: "Before you start",
        body: "Sign in to Steam and check your internet connection. If you cannot connect, follow the network troubleshooting guide. VRChat is free to play.",
      },
      "start-first-world": {
        title: "Enter your first world",
        body: "Your first entry lands in the default world. At a mirror you can pick an avatar you like from the free ones.",
      },
      "start-find-content": {
        title: "Find more content",
        body: "The Worlds page of the main menu lets you search and favorite worlds; set a frequently visited world as home to arrive there directly.",
      },
      "basics-menu": {
        title: "Where the menus are",
        body: "On PC press Esc for the quick menu and double-click the gear for the main menu; in VR press Y or B to open the menu.",
      },
      "basics-keys-pc": {
        title: "Common PC keys",
        body: "Hold V to talk, Y opens chat input, R opens the emoji wheel, Space jumps, C crouches, Z lies down.",
      },
      "basics-keys-vr": {
        title: "Common VR buttons",
        body: "Hold X to toggle the mic, A jumps, the front trigger confirms and grabs, the side grip grabs objects.",
      },
      "basics-status": {
        title: "What status colors mean",
        body: "Green = Online; blue = Join Me; orange = Ask Me; red = Do Not Disturb. These statuses affect joining and notifications; blue does not mean group membership.",
      },
      "safety-open-urls": {
        title: "Turn this switch on first",
        body: "Enable “Allow untrusted URLs” in Settings → Comfort & Safety, otherwise many worlds' videos and images will not load.",
      },
      "safety-personal-space": {
        title: "Personal space & portals",
        body: "With personal space on, strangers who get too close are hidden automatically; entering a portal someone dropped asks for confirmation first.",
      },
      "safety-trust": {
        title: "Trust ranks & shields",
        body: "Shield levels decide whose avatars and effects you see. If uncomfortable, hide someone's avatar with one click in the quick menu.",
      },
      "safety-audio": {
        title: "When you can't hear clearly",
        body: "Check input/output devices in Settings → Audio; video volume in worlds can be adjusted on each player.",
      },
      "devices-platforms": {
        title: "What each platform can play",
        body: "PC, VR and mobile play together; avatars and worlds mark platform compatibility — a green badge means available on your current platform.",
      },
      "devices-tracking": {
        title: "Tracking & IK",
        body: "Hip and leg trackers greatly improve expressiveness; without them the game estimates poses with IK and clipping is normal.",
      },
      "devices-performance": {
        title: "Graphics & performance",
        body: "For stutter, first lower “avatar display count” and shadows; VRAM-heavy avatars can be limited in safety settings.",
      },
      "tutorials-surfaces": {
        title: "Desktop & VR dual surfaces",
        body: "The same tutorial runs in sync in the desktop window and the VR overlay; turn a page on either side and the other follows instantly.",
      },
      "tutorials-faq": {
        title: "Quick FAQ",
        body: "If an avatar is hidden, check Safety settings and platform compatibility. If disconnected, check your network connection and VRChat service status.",
      },
      "tutorials-accounts": {
        title: "About accounts",
        body: "You can upgrade a Steam platform account to a VRChat account or link it to an existing one. Follow the official account-upgrade instructions to keep friends and favorites.",
      },
    },
  },
  /** Overlay dual surfaces(§8.8): copy for the desktop/VR overlay surfaces;
   *  v2(017 surface batch 1 wire consumption): status titles + production
   *  card copy added; environment/progress/disabled-reason keys removed —
   *  wire batch 1 carries no such facts (batch 2 may reintroduce them with
   *  their wire projection). planStatus/recordStatus word tables mirror the
   *  frozen PlanStatusV02/BuildRecordStatusV02 enums. */
  overlay: {
    surfaceTitle: "VUA Overlay",
    /** View switch (2026-09-26 guide-host ruling): labels for the title and
     *  the segmented control */
    views: {
      guide: "Guide",
      status: "Status",
    },
    viewSwitchAria: "Switch overlay view",
    taskSectionLabel: "Tasks",
    productionSectionLabel: "Production",
    downloadSectionLabel: "Downloads",
    productionPlan: "Plan {planId}",
    productionRecord: "Record {buildId}",
    productionPlanStatuses: {
      draft: "Awaiting approval",
      approved: "Approved",
      superseded: "Superseded",
    },
    productionRecordStatuses: {
      succeeded: "Succeeded",
      succeeded_with_warnings: "Succeeded with warnings",
      failed: "Failed",
      cancelled: "Cancelled",
      recovered: "Recovered",
    },
    statusTitles: {
      active: "{count} in progress",
      recent: "Recent activity",
      idle: "Nothing in progress",
    },
    actions: {
      openOnDesktop: "Open on desktop",
      dismiss: "Dismiss overlay",
      requestCancel: "Request cancel",
      cancelConfirm: "Confirm cancel",
      cancelKeep: "Keep running",
    },
    cancelHint: "Cancellation is a request — the task stops at a safe boundary.",
    cancelArmedHint: "Tap again to confirm cancellation.",
    closeWindow: "Close window",
    collapse: "Collapse",
    returnToMain: "Return to main window",
    retry: "Retry",
    loadErrorTitle: "Cannot reach the app layer right now",
    loadErrorBody:
      "The overlay snapshot request failed or timed out. Retrying does not affect the main window; closing this window only closes the overlay.",
    inactiveTitle: "Nothing to show right now",
    inactiveBody:
      "The overlay service is not connected yet. Once a session starts, its status appears here.",
    statusTones: {
      inactive: "Idle",
      active: "In progress",
      waiting: "Waiting",
      blocked: "Blocked",
    },
  },
  media: {
    loadFailed: "Image failed to load",
    retry: "Retry",
    loading: "Image loading",
  },
  recipe: {
    libraryTitle: "Saved recipes",
    libraryReload: 'Refresh library',
    libraryEmpty: 'No recipe documents yet. Recipes saved through production will appear here.',
    libraryUnavailable: 'The recipe library service is not connected.',
    librarySelected: 'Selected',
    libraryMappingNote: "This recipe is shown as saved. Editing it in the workbench is not available yet.",
    documentModeNote: "These are the settings saved in the recipe. They have not been verified on this PC.",
    documentModeExit: "Back to the workbench",
    /** 029 slice 3 (A1 creation entry upgrade / A2 add-assets in selected
     *  state / A3 local segment of the warehouse read-face projection
     *  picker). Word-face discipline (U16): the creation entry says
     *  "create"; "add assets" is its own action and never mixed with
     *  "assemble". The picker presents local warehouse entries only -
     *  cloud asset access stays honestly absent pending BOARD #46. */
    createCta: "Create recipe",
    addMaterialCta: "Add assets",
    materialPickerTitle: "Add from the asset warehouse",
    editSectionTitle: "Pending asset additions",
    saveEditCta: "Save changes",
    savingEditCta: "Saving…",
    editFailedNote: "Saving failed - your changes are kept and you can retry.",
    editDirtyNote: "There are unsaved asset additions - they are written to the recipe library only after saving succeeds.",
    editRemoveAria: "Remove pending addition {title}",
    /* 029 B-face loop 4 (desktop consumption): recipe-export v0.1 draft
     * confirmation flow. Word-face discipline: the entry says "export a
     * draft from a project"; the export never claims to recover design
     * intent and the missing-dimension list is rendered as-is. Promotion
     * rides the standing recipe.save chain only after explicit user
     * completion (title / Unity version when unreadable / at least one
     * asset). Registered projects only - no arbitrary path input. */
    exportCta: "Export draft from project",
    exportDialogTitle: "Export a recipe draft from a project",
    exportDraftBadge: "Project-exported draft",
    exportPickTitle: "Choose a VUA-managed project",
    exportPickAria: "Registered projects to export from",
    exportPickLoading: "Loading registered projects…",
    exportPickEmpty: "No VUA-managed projects are registered yet.",
    exportPickUnavailable: "The project registry service is not connected.",
    exportStaleBadge: "Path missing",
    exportExporting: "Exporting draft…",
    exportFailedUnavailable: "The export service is not available right now.",
    exportFailedRejected: "That project is not registered with VUA anymore.",
    exportOriginSection: "Source project",
    exportPathLabel: "Path",
    exportNameLabel: "Name",
    exportNameAbsent: "not readable",
    exportIdentityLabel: "VUA-native identity",
    exportIdentityPresent: "Present",
    exportIdentityAbsent: "Absent",
    exportIdentityUnreadable: "Unreadable",
    exportUnityLabel: "Unity version (observed on disk)",
    exportUnityUnreadable: "Not readable - enter the version constraint to save.",
    exportUnityInputAria: "Unity version constraint",
    exportUnityPlaceholder: "e.g. 2022.3.22f1",
    exportDepsTitle: "Declared dependencies",
    exportDepsEmpty: "The project manifest declares no dependencies.",
    exportDepsLocked: "locked {version}",
    exportMissingTitle: "Missing dimensions (not covered by this export)",
    exportHonestyNote: "The export reads project files only and never recovers design intent. The draft becomes a recipe only after you complete it and save it explicitly.",
    missingDims: {
      assets: "Assets",
      instances: "Instances and mounts",
      relations: "Relations",
      wardrobeGroups: "Wardrobe groups",
      targetAvatar: "Target avatar",
      assetRoles: "Asset roles",
      assetLabels: "Asset labels",
      sourceRefs: "Asset sources",
      titleSemantics: "Title semantics",
      environmentUnityVersion: "Unity version (unreadable on disk)",
    },
    exportTitleLabel: "Recipe title (required)",
    exportTitleAria: "Recipe title",
    exportTitlePrefillNote: "Prefilled from the project name - edit freely.",
    exportSaveCta: "Save as recipe",
    exportBlockedNote: "A title, the Unity version (when unreadable), and at least one asset are required to save.",
    factsLine: 'Revision {revision} - assets: {assets}, instances: {instances}, relations: {relations}.',
    factsLocked: "Dependency choices are pinned. This does not verify the local project.",
    factsUnlocked: "Dependency choices are not pinned. This recipe has not been verified locally.",
    structureHasSource: 'has source reference',
    loadFailed: "Failed to load the recipe graph.",
    loadFailedDescription: "Something went wrong reading recipe data. Retrying does not modify any local data.",
    retry: "Retry",
    notConnectedTitle: "Recipe graph not connected yet",
    notConnectedDescription: "Once recipe data is connected, a multi-layer relation graph will appear here.",
    viewGraph: "Graph",
    viewList: "List",
    viewExploded: "Layered view",
    viewSwitchAria: "Switch graph / list / exploded view",
    /** S-IX-5 exploded view: semantic layers lifted in 3D, read-only; drag stays in graph view */
    explodedHint: "Shows the recipe in separate layers. Switch to Graph to drag items and adjust the layout.",
    layers: {
      body: "Body & base avatars",
      outfit: "Outfits & accessories",
      animation: "Animations & menus",
      tech: "Shaders and dependencies",
    },
    nodeStates: {
      ready: "Ready",
      conflict: "Conflict",
      missing: "Missing locally",
      unresolved: "Not resolved yet",
      expected: "Expected (documented, not locally verified)",
    },
    edgeKinds: {
      composition: "Composed of",
      wardrobe: "Wardrobe option",
      dependency: "Dependency",
    },
    conflictsTitle: "Conflicts",
    missingTitle: "Locally missing assets",
    detailTitle: "Selected node",
    detailEmpty: "Click a node to see details.",
    legendAria: "Legend",
    moveHint:
      "Drag nodes to pin them in place; drag empty space to pan and scroll to zoom. When a node is selected you can also nudge it with arrow keys or the buttons below. The layout is saved automatically on this machine.",
    moveGroupAria: "Move selected node",
    moveUp: "Move up",
    moveDown: "Move down",
    moveLeft: "Move left",
    moveRight: "Move right",
    resetLayout: "Restore auto layout",
    /** S-X-3 radial canvas: reset pan/zoom (does not touch node layout) */
    resetView: "Reset view",
    /** S-IX-4 recipe version manager: local snapshots of layout + structure summary */
    versions: {
      toggle: "Versions",
      title: "Version manager",
      saveCta: "Save current as new version",
      notePlaceholder: "Note (optional)",
      noteAria: "Version note",
      currentBadge: "Current",
      restore: "Restore",
      remove: "Delete",
      empty: "No version snapshots yet.",
      metaLine: "{nodes} nodes · {missing} missing",
      scopeNote: "Versions currently record layout and a structure summary; recipe content editing and share codes join the version history once connected.",
      seedNoteBase: "Demo: auto layout baseline",
      seedNoteCustom: "Demo: custom layout snapshot",
    },
    /** Graph node context menu (S-XII): real actions only, no placeholders */
    contextMenu: {
      viewDetails: "View details",
      deselect: "Deselect",
      resetPosition: "Reset to auto layout",
    },
  },
  release: {
    loadFailed: "Could not load completed projects.",
    loadFailedDescription: "Could not read project data. Retrying will not change your local files.",
    retry: "Retry",
    notConnectedTitle: "Completed projects unavailable",
    notConnectedDescription:
      "After a production pipeline completes, project cards you can keep editing, roll back and hand over for upload will appear here.",
    emptyTitle: "No completed projects yet",
    emptyDescription: "After a production pipeline completes, the project will appear here.",
    previewPlaceholder: "Preview not generated yet",
    bakePreviewTitle: "Unity bake preview",
    bakePreviewFailed: "Bake output not found — run build_preview in Unity first.",
    detailTitle: "Project details",
    detailEmpty: "Click a project card to see details.",
    health: {
      healthy: "Matches recipe",
      drifted: "Drifted from recipe",
      "missing-deps": "Missing dependencies",
    },
    inspection: {
      passed: "Inspection passed",
      failed: "Inspection failed",
      none: "Not inspected yet",
    },
    snapshotsLine: "Snapshots: {count}",
    metaUnity: "Unity",
    metaPlatforms: "Platforms",
    metaRecipe: "Source recipe",
    metaUpdatedAt: "Last updated",
    conveyor: {
      aria: "Release project conveyor",
      prev: "Previous project",
      next: "Next project",
    },
    /** Project card context menu (S-XII): restore/re-derive/upload handoff not wired, no dead buttons */
    contextMenu: {
      viewDetails: "View details",
      collapse: "Collapse details",
    },
    pedestalNote: "Preview extraction is not wired up yet: the artifact on the pedestal is a symbolic render, not the real model.",
    futureNote:
      "Sign in and complete the upload in the official VRChat SDK. Available actions are shown on each build record.",
    /** Build records section (night task P2): record.list/record.get reads; failure ≠ empty; evidence refs counted only */
    records: {
      title: "Build records",
      subtitle:
        "Your avatar creation history. If records cannot be loaded, you can retry.",
      reload: "Reload",
      failedTitle: "Failed to load build records",
      failedDescription:
        "Could not load build records. Check the connection and try again.",
      emptyTitle: "No build records yet",
      emptyDescription: "Records appear here after a production execution completes.",
      status: {
        succeeded: "Succeeded",
        succeeded_with_warnings: "Succeeded (with warnings)",
        failed: "Failed",
        cancelled: "Cancelled",
        rolled_back: "Rolled back",
        recovered: "Recovered",
      },
      detailTitle: "Record details",
      detailBuildLine: "Build {buildId}",
      detailRecipeLine: "Recipe {recipeId} · revision {revision}",
      detailPlanLine: "Plan {planId}",
      startedAt: "Started",
      jobsTitle: "Operation results",
      jobsLine: "{total} total: {succeeded} succeeded / {failed} failed / {rejected} rejected",
      deviationsTitle: "Changes from the plan",
      deviationsLine: "Changes from the plan: {count}",
      evidenceTitle: "Evidence references",
      evidenceLine:
        "Supporting records: {count}. This count is not an official SDK result.",
      evidenceAbsent: "No supporting-record summary is available.",
      recoveredBadge: "Recovered",
      recoveredNote:
        "This run completed after recovery.",
      detailFailed: "Failed to load record details.",
      detailUnexplainable:
        "This record is missing required information or uses an unsupported format. It cannot be displayed.",
      /* 023 consumer slice: release.openForHandoff (v0.1 frozen) — "hand off"
       * primary action on the build-record row. Absence semantics: the route
       * answers vua.release_handoff.unavailable until the implementation
       * slice lands; no upload progress/result is ever rendered (the fact
       * document has no upload-status field by shape). upload_readiness
       * evidence summary is NOT rendered here: no authoritative
       * buildId→inspectionId association exists (registered on proposal 023). */
      handoff: {
        action: "Prepare upload in Unity",
        actionNote:
          "Opens or focuses the Unity editor for this build's project so the official SDK upload panel is ready.",
        runningNote: "Preparing the Unity project for upload. Follow progress in the notification center.",
        readFailedNote: "Task status read failed; retrying.",
        succeededTitle: "Upload preparation complete",
        succeededLine: "Editor {editorVersion} at {occurredAt}",
        projectLine: "Project {projectId}",
        sdkNote:
          "The final upload is completed in the official SDK; VUA renders no upload progress or result.",
        inspectNote:
          "View the detailed check results on {page}.",
        gotoInspection: "Open {page}",
        cancelledNote: "Upload preparation was cancelled.",
        factUnexplainableTitle: "Cannot confirm upload preparation",
        factUnexplainable:
          "The task reported success, but its result is missing or cannot be read. Upload preparation cannot be confirmed.",
        absentTitle: "Upload preparation unavailable",
        absentNote:
          "The service needed to prepare this project for upload is unavailable.",
        failedTitle: "Upload preparation request rejected",
        failedUnknown: "The upload preparation request was rejected without an error code.",
        failedWithCode: "Upload preparation was rejected: {code}",
        codeInvalidParams: "Request parameters were rejected (invalid buildId).",
        codeBuildUnknown: "No build record matches this buildId.",
        codeEditorUnresolved:
          "The Unity editor could not be identified. Verify it on the environment page first.",
        retry: "Retry",
        taskErrorLine: "Task error: {code}",
        taskFailedNote: "Upload preparation failed.",
        /* U19 handoff admission presentation buckets (user ruling 2026-09-21):
         * succeeded/succeeded_with_warnings -> action offered (warning badge
         * stays); failed/cancelled/rolled_back -> action withheld, reason +
         * inspect/workshop entry chain; recovered -> withheld until the
         * inspection and follow-up production steps are done; missing or
         * out-of-vocabulary state -> rejected as unconfirmable. The backend
         * gate stays the authority; this is the discoverable-reason face
         * (design standard §5). */
        blockedTitle: "Handoff unavailable",
        blockedFailed:
          "This build failed, so it cannot be handed off. Check the results, recover, or produce again.",
        blockedCancelled:
          "This build was cancelled, so it cannot be handed off. Produce again to create a new record.",
        blockedRolledBack:
          "This build was rolled back, so it cannot be handed off. Produce again to create a new record.",
        recoveredBlockNote:
          "This record was recovered. Complete the inspection and the follow-up production steps before handing off.",
        unconfirmedNote:
          "The handoff action is unavailable: this record cannot be confirmed.",
        entryWorkshop: "Open Workshop",
      },
      /* U19 second deliverable (explicit user ruling): the standalone
       * "Open in Unity to inspect or fix" action — deliberately separate from
       * the handoff button (own component, own port, own copy). Never gated by
       * the record state; opening the editor is neither a recovery execution
       * nor an upload permission. The route has landed (release-handoff v0.2,
       * desktop TS face aligned in batch 156): the completion arm presents the
       * six-key inspection fact's identity keys plus the fact's own operation
       * wording, and states plainly that an inspection open is not a handoff
       * completion (the negative constraint holds on this face too); the
       * absent/failed arms present honestly — no fabricated capability. */
      openInUnity: {
        action: "Open in Unity to inspect or fix",
        actionNote:
          "Opens this build's project in the Unity editor for manual inspection and fixes. Opening the editor neither resumes a production task nor permits an upload.",
        absentTitle: "Open in Unity unavailable",
        absentNote: "Opening this project in Unity is not wired up yet.",
        failedTitle: "Open in Unity request rejected",
        failedUnknown: "The request was rejected without an error code.",
        failedWithCode: "The request was rejected: {code}",
        retry: "Retry",
        runningNote:
          "Opening the Unity editor; the result appears here once it completes. Opening the editor neither resumes a production task nor permits an upload.",
        readFailedNote: "Reading the task state failed this round; retrying. The current state is never guessed.",
        succeededTitle: "Editor opened (inspection)",
        succeededLine: "The Unity editor {editorVersion} was opened for inspection at {occurredAt}.",
        projectLine: "Project identity: {projectId}",
        operationLine:
          "Completion fact wording: {operation}. An inspection open is not a handoff completion and grants no upload permission.",
        cancelledNote: "The open task was cancelled; no completion fact to present.",
        taskErrorLine: "The open task failed: {code}",
        taskFailedNote: "The open task failed; no completion fact to present.",
        factUnexplainableTitle: "Completion fact unexplainable",
        factUnexplainable:
          "The task ended, but the completion fact is missing or unexplainable; presented honestly, never guessed.",
      },
    },
  },
  /**
   * 包管理(S-XVI):Recipe 之外的手动 VPM 操作面。
   * 玩家语言,不暴露 semver 范围语法/仓库协议细节;版本状态词表
   * (states/sources)与端口类型一一对应,词表外取值由模型层回落,不猜测。
   */
  /** Project compatibility section (proposal 026 B, user ruling 2026-09-18):
   *  the former standalone tab lives as a section at the end of the package
   *  manager page; ALCOM/VCC read-only presentation and the "Import as a
   *  VUA-managed copy" chain; authority = product-boundary 1.2.0 (U3 ruling).
   *  Detection read face is live (021 wiring batch); copy-import runs the
   *  task-based channel (020 result reflux). */
  projectCompat: {
    title: "Project compatibility",
    subtitle: "ALCOM/VCC-managed projects are read-only; hand write operations to the owning manager.",
    readOnlyTitle: "Original projects are read-only",
    readOnlyDesc: "Original ALCOM/VCC project files are read-only in VUA. Import a VUA-managed copy before changing a project. Repository subscriptions and local package registrations share settings.json with VCC/ALCOM, so changes to those settings are visible in both tools. Other manager registries, databases and caches remain read-only.",
    detectionTitle: "Project detection (compatibility matrix)",
    detectionWired: "Detected projects:",
    detectionManagersLine: 'VCC: {vccN} registered - ALCOM: {alcomN} registered',
    detectionPickCta: 'Choose project folder',
    detectionPickNote: 'Only the first selected folder is inspected.',
    detectionInspectCta: 'Identify',
    detectionUnavailable: 'The project inspection service is not connected.',
    detectionNotFound: 'This path is not registered with a managed project (VCC/ALCOM), so there is nothing to inspect here.',
    associationsTitle: 'Registered by',
    associationVcc: 'VCC',
    associationAlcom: 'ALCOM',
    migrateCta: 'Import as VUA-managed copy',
    viewOnlyCta: 'View only',
    lockNone: "No leftover project lock was found.",
    lockLeftover: "A project lock is still present.",
    lockUnreadable: "Could not check the project lock.",
    detectionReload: 'Re-run detection',
    envStatusTitle: "Environment status (VUA-side detection)",
    envStatusSource: "Source: VUA environment detection, not ALCOM/VCC records; versions are authoritative in the owning manager.",
    handoverTitle: "Hand over write operations",
    handoverDesc: "Perform write operations on such a project (install/remove packages, change settings, etc.) with the owning ALCOM/VCC manager; VUA does not write to the original project.",
    importTitle: "Import as a VUA-managed copy",
    importSpecIntro: "The import will follow these specifications:",
    importSpecs: [
      "Import into a new project path with a new project identity;",
      "Show the estimated disk usage before importing;",
      "Do not copy regenerable directories (e.g. Library) or old task state;",
      "Re-run inspection after import; confirmations and snapshots are not inherited;",
      "Keep the link to the original project for easy return.",
    ],
    importCta: "Choose a project folder and import",
    importCancel: "Cancel",

    importSourceLabel: "Source project path",
    importSourcePlaceholder: "ALCOM/VCC-managed project folder",
    importSourceRegisteredLabel: "Pick a registered project",
    importSourceNote: "Select a registered project above, or enter the folder path of another ALCOM/VCC project. VUA checks the source before importing.",
    importParentLabel: "Target parent directory",
    importParentPick: "Choose parent directory",
    importNameLabel: "New project name",
    importPlanCta: "Generate import plan",
    importPlanPanelTitle: "Import plan (please review)",
    importPlanTarget: "Target path",
    importPlanBytes: "Estimated disk usage",
    importPlanExcluded: "Excluded entries",
    importPlanTopLevels: "Copy scope",
    importPlanDigest: "Plan digest",
    importApplyCta: "Confirm and start import",
    importReceiptTitle: "Import complete",
    importReceiptTarget: "New project path",
    importReceiptBytes: "Data copied",
    importReceiptCopied: "Copied contents",
    importReceiptSource: "The source link has been recorded in the new project's .vua; you can return to the original project anytime.",
    importReceiptInspect: "The new project has been re-inspected (Unity version)",
    importUnavailable: "The project operations service is not connected or temporarily unavailable.",
    guardTargetExists: "The target path already exists; choose another project name or parent directory.",
    guardTargetInsideSource: "The target path is inside the source project, which is not allowed.",
    guardSourceNotRegistered: "The source path is not an ALCOM/VCC registered project.",
    guardSourceInvalid: "The source project is invalid or cannot be read.",
    guardInsufficientDiskSpace: "Insufficient disk space.",
    guardPlanDrift: "The import plan has changed; regenerate the plan.",
    guardExecutionFailed: "The import execution failed.",
    guardFallback: "The import was rejected.",
    /** D-6 note section (project-ops v0.2 setNote; ruling A inline view + light edit):
     *  no entry on absent; read-only on unreadable; success confirmed via read-face refresh */
    note: {
      title: "Project note",
      markedAt: "VUA-native since {markedAt}",
      empty: "No note yet.",
      placeholder: "Single-line note, up to 2000 characters",
      edit: "Edit note",
      clear: "Clear note",
      save: "Save",
      cancel: "Cancel",
      saving: "Saving… (task {taskId}). The saved note will be checked when the task finishes.",
      savedConfirmed: "Note saved and verified.",
      listOnly:
        "The note appears only in the project list; it is single-line plain text stored in this project's VUA identity file.",
      rejectedNotFound:
        "Not saved: the project is not registered with any manager (the detection registry is the writable world for notes).",
      rejectedAbsent:
        "Not saved: the project has no VUA identity file (notes belong to VUA-native projects only).",
      rejectedUnreadable:
        "Not saved: the VUA identity file is unreadable; the stored content was left untouched.",
      unconfirmed: "Could not confirm the saved note yet. Refresh the project to check.",
      unavailable: "The project operation service is not connected or temporarily unavailable.",
      waitTimeout: "The note task is still running; waiting stopped. Re-inspect to check the result.",
      unreadableNote:
        "The VUA project identity file cannot be read. Fix that file before editing notes.",
    },
  },
  packages: {
    subtitle:
      "Manage packages for each Unity project manually. Creating an avatar from a {recipe} is the main workflow.",
    sections: {
      packages: "Packages",
      repos: "Repositories",
      switchAria: "Switch between packages and repositories",
    },
    toolbar: {
      searchPlaceholder: "Search name or package ID",
      searchAria: "Search packages",
      sourceFilterAria: "Filter by source",
      allSources: "All sources",
      importLocal: "Import local package",
      showPrereleases: "Show pre-releases",
      prereleaseTitle: "Show pre-release versions?",
      prereleaseBody:
        "Pre-releases are early builds shared by their authors and may be unstable. Install one only when you are comfortable troubleshooting it.",
      prereleaseConfirm: "Show pre-releases",
      prereleaseCancel: "Keep hidden",
    },
    columns: {
      selectAll: "Select all listed packages",
      selectRow: "Select {name}",
      name: "Package",
      installed: "Installed",
      latest: "Latest",
      source: "Source",
      rowMenuAria: "More actions for {name}",
      versionSelectAria: "Choose a version for {name}",
      versionPlaceholder: "Choose version…",
      compatibleGroup: "Compatible versions",
      incompatibleGroup: "Incompatible with this project",
    },
    sources: {
      official: "Official",
      curated: "Curated",
      community: "Community",
      local: "Local import",
    },
    states: {
      notInstalled: "Not installed",
      upToDate: "Up to date",
      updateAvailable: "Update available",
      yanked: "withdrawn",
      prerelease: "pre-release",
      versionSuffix: "{version} ({suffix})",
    },
    projects: {
      selectorAria: "Choose project",
      addProject: "Add project folder",
      invalidLine: "{name}: {reason}",
      invalidReasons: {
        folderMissing: "Folder not found; it may have been moved or deleted.",
        unknown: "This project cannot be used right now.",
      },
    },
    migration: {
      summaries: {
        vpmProject:
          "This project appears to be managed by other software. Adopting it may have unknown consequences.",
      },
      note: "Migration runs once the package engine is connected; nothing changes automatically.",
    },
    changes: {
      title: "Confirm changes",
      cancel: "Cancel",
      confirm: "Apply changes",
      delayedHint: "Review the list above; confirmation unlocks in a moment.",
      kinds: {
        install: "Install",
        upgrade: "Update",
        majorUpgrade: "Major update",
        downgrade: "Downgrade",
        remove: "Remove",
        reinstall: "Reinstall",
      },
      versionLine: "{from} → {to}",
      majorUpgradeWarning:
        "Major updates can change behavior; check the changelog before applying.",
      downgradeWarning: "Downgrading may break content that relies on newer versions.",
      conflictsTitle: "Conflicts",
      conflicts: {
        requiredBy: "{package} is required by {dependent}; removing it may break that package.",
        unknown: "These packages conflict; review them before applying.",
      },
      legacyTitle: "Legacy folders that will be removed",
    },
    remove: {
      title: "Remove packages",
      column: "Actions",
      removedTitle: "Will remove",
      installedTitle: "Will install",
      legacyTitle: "Legacy files/folders to clean up",
      destructiveHint: "This change may remove conflicting dependencies or legacy files. Review the list before confirming; the button becomes available shortly.",
      confirm: "Remove ({count})",
      applying: "Removing… task progress is visible in the notification center.",
      close: "Close",
      receiptTitle: "Removal complete",
      receiptSummary: "Package entries removed: {count}.",
      receiptRemovedTitle: "Actually removed",
      receiptDigest: "Confirmed digest: {digest}",
      rejectedTitle: "Removal refused",
      rejectedDetail: "Error details (original): {detail}",
      driftHint: "The package list changed after confirmation. Close this dialog, then review and confirm the updated list.",
      guards: {
        preview_drift: "The project changed after you reviewed it. Nothing was removed. Review the latest changes and confirm again.",
        package_not_found: "The requested package is not in this project's installed set.",
        execution_failed: "The removal failed during execution.",
        unknown: "The removal was refused.",
      },
      envelopeErrors: {
        projectNotFound: "This project is no longer registered; removal is unavailable.",
        packageNotFound: "The requested package is not installed in this project.",
        capabilityMissing: "The current engine backend does not support removal.",
        invalidParams: "The removal request has an invalid shape.",
        unknown: "The operation failed.",
      },
      toasts: {
        previewUnavailable: "Cannot generate the removal preview: the package engine is not connected.",
        previewFailedUnknown: "Cannot generate the removal preview ({code}).",
        nothingToRemove: "The current selection has nothing to remove.",
        applyFailedUnknown: "The removal did not complete ({code}).",
        applyUnavailable: "The removal did not complete: the result could not be confirmed; check the notification center.",
      },
    },

    install: {
      title: "Install packages",
      latest: "Install / upgrade to latest",
      latestHint: "The package resolver picks the latest stable version; prereleases are never auto-selected.",
      versionAction: "Install this version",
      installedTitle: "Will install",
      removedTitle: "Will remove alongside (conflict-triggered)",
      legacyTitle: "Legacy files/folders to clean up",
      destructiveHint: "This change may remove conflicting dependencies or legacy files. Review the list before confirming; the button becomes available shortly.",
      confirm: "Install ({count})",
      applying: "Installing… task progress is visible in the notification center.",
      close: "Close",
      receiptTitle: "Installation complete",
      receiptSummary: "Package entries applied: {count}.",
      receiptAppliedTitle: "Actually applied",
      receiptDigest: "Confirmed digest: {digest}",
      rejectedTitle: "Installation refused",
      rejectedDetail: "Error details (original): {detail}",
      driftHint: "The package list changed after confirmation. Close this dialog, then review and confirm the updated list.",
      guards: {
        preview_drift: "The project changed after you reviewed it. Nothing was installed. Review the latest changes and confirm again.",
        package_not_found: "Could not find the requested package or version.",
        execution_failed: "The installation failed during execution.",
        unknown: "The installation was refused.",
      },
      envelopeErrors: {
        projectNotFound: "This project is no longer registered; installation is unavailable.",
        packageNotFound: "Could not find the requested package or version.",
        capabilityMissing: "The current engine backend does not support installation.",
        invalidParams: "The installation request has an invalid shape.",
        previewFailed: "Cannot generate the install preview: the preview stage failed.",
        unknown: "The operation failed.",
      },
      toasts: {
        previewUnavailable: "Cannot generate the install preview: the package engine is not connected.",
        previewFailedUnknown: "Cannot generate the install preview ({code}).",
        nothingToInstall: "The current request has nothing to apply.",
        applyFailedUnknown: "The installation did not complete ({code}).",
        applyUnavailable: "The installation did not complete: the result could not be confirmed; check the notification center.",
      },
    },

    register: {
      title: "Register local package",
      description:
        "Register a local package root folder (containing package.json) in the package-manager settings (settings.json) shared with VCC/ALCOM; registration only adds an entry and never modifies project files. Registering the same package again is safe.",
      placeholder: "Enter a local package root path, e.g. C:\\LocalPackages\\com.example.pkg-1.0.0",
      inputAria: "Local package root path",
      action: "Register",
      submitting: "Registering…",
      successLine: "Registered: {packageRoot}",
      rejectedDetail: "Error details (original): {detail}",
      guards: {
        preview_drift: "The registration was refused.",
        package_not_found: "The registration was refused.",
        execution_failed: "The registration failed during execution.",
        unknown: "The registration was refused.",
      },
      envelopeErrors: {
        capabilityMissing: "The current engine backend does not support local package registration.",
        invalidParams: "The registration request shape is invalid.",
        unknown: "The operation failed.",
      },
      toasts: {
        failedUnknown: "The registration did not complete ({code}).",
        unavailable: "The registration did not complete: the result could not be confirmed; check the notification center.",
      },
    },

    repoWrite: {
      title: "Repository subscriptions",
      description:
        "Subscribe to remote or local package repositories, or remove a subscription. These operations share the same package-manager settings file (settings.json) with VCC/ALCOM — changes are visible to both sides immediately; VUA does not modify your project files, and external imports default to cloning a copy before modifying it. Removing a subscription deletes no package files. Adding a remote repository fetches its manifest and may take a moment; duplicate subscriptions can be refused and any refusal is shown as it is.",
      remoteHeadline: "Add remote repository",
      remoteUrlPlaceholder: "Repository manifest URL, e.g. https://vpm.example/index.json",
      remoteUrlAria: "Repository manifest URL",
      remoteNamePlaceholder: "Display name",
      remoteNameAria: "Repository display name",
      remoteAction: "Add remote",
      localHeadline: "Add local repository",
      localPathPlaceholder: "Local repository folder path, e.g. C:\\Repos\\local-curations",
      localPathAria: "Local repository folder path",
      localNamePlaceholder: "Display name",
      localNameAria: "Repository display name",
      localAction: "Add local",
      adding: "Adding…",
      remoteSuccessLine: "Subscribed to remote repository {name}: {url}",
      localSuccessLine: "Subscribed to local repository {name}: {path}",
      rejectedDetail: "Error details (original): {detail}",
      guards: {
        preview_drift: "The request was refused.",
        package_not_found: "The request was refused.",
        execution_failed: "The request failed during execution.",
        unknown: "The request was refused.",
      },
      envelopeErrors: {
        capabilityMissing: "The current engine backend does not support this repository operation.",
        invalidParams: "The repository request shape is invalid.",
        unknown: "The operation failed.",
      },
      toasts: {
        failedUnknown: "The repository operation did not complete ({code}).",
        unavailable: "The repository operation did not complete: the result could not be confirmed; check the notification center.",
      },
      removeAction: "Remove",
      removeAria: "Remove subscription {name}",
      removeConfirm: "Confirm removal",
      removing: "Removing…",
      removedLine: "Removed subscription: {repoId}",
      /** F4 repository lifecycle (027 v0.6 consumption): inline toggle/
       *  refresh controls. Honest-wording ruling: enable state is VUA-owned
       *  — a disabled repository stays listed (disabled-not-hidden), its
       *  packages leave enumeration and install resolution; the shared
       *  VCC/ALCOM settings are never written (W25 read-only evidence
       *  ruling (c): VCC carries no enable/disable state anywhere). */
      lifecycle: {
        enableAction: "Enable",
        disableAction: "Disable",
        enableAria: "Enable repository {name}",
        disableAria: "Disable repository {name}",
        refreshAction: "Refresh",
        refreshAria: "Refresh the cache of repository {name}",
        enabling: "Enabling…",
        disabling: "Disabling…",
        refreshing: "Refreshing…",
        disabledBadge: "Disabled",
        disabledNote: "Disabled: this repository's packages no longer take part in browsing or install resolution; the subscription row stays listed.",
        doneLine: "Done: {repoId}",
        upToDate: "The repository cache is already up to date.",
      },
    },

    create: {
      title: "Create new project",
      description:
        "Create a VRChat project in the folder you choose and add it to VUA. Choose a new project folder name; existing folders cannot be overwritten. This creates the project files without changing the package-manager settings shared with VCC/ALCOM.",
      parentPlaceholder: "Parent folder path, e.g. C:\\Users\\me\\VRChat Projects",
      parentAria: "Parent folder path",
      namePlaceholder: "Project name, e.g. My World",
      nameAria: "Project name",
      templatePlaceholder: "Template name (optional; blank uses the default)",
      templateAria: "Template name, optional",
      templateSelectAria: "Project template",
      templateDefaultOption: "Use the backend default template (leave empty)",
      templatesLoading: "Fetching the template list…",
      templatesEmptyNote:
        "No templates found (a missing template directory is a fact, not an error) — type a template name manually, or leave it empty to use the backend default",
      templatesFailedNote:
        "Failed to fetch the template list ({code}) — type a template name manually, or leave it empty to use the backend default",
      templatesUnavailableNote:
        "The template list is currently unavailable — type a template name manually, or leave it empty to use the backend default",
      action: "Create project",
      submitting: "Creating…",
      successLine: "Created and registered: {projectPath}",
      rejectedDetail: "Error details (original): {detail}",
      refusals: {
        projectExists: "The target directory already exists.",
        projectNameInvalid: "The project name contains a forbidden character.",
        templateMissing: "No template with that name exists in the library.",
        templateCopyFailed: "Copying the template contents failed.",
      },
      guards: {
        preview_drift: "The creation was refused.",
        package_not_found: "The creation was refused.",
        execution_failed: "The creation failed during execution.",
        unknown: "The creation was refused.",
      },
      envelopeErrors: {
        capabilityMissing: "The current engine backend does not support project creation.",
        invalidParams: "The creation request shape is invalid.",
        unknown: "The operation failed.",
      },
      toasts: {
        failedUnknown: "The project creation did not complete ({code}).",
        unavailable: "The project creation did not complete: the result could not be confirmed; check the notification center.",
      },
    },

    repos: {
      addCommunity: "Add community repository",
      riskTitle: "Before adding a community repository",
      riskBody:
        "Community repositories are maintained by third parties and are not reviewed by VRChat or VUA. Their packages can change after you subscribe. Only add repositories from creators you trust.",
      riskAcknowledge: "Got it",
      /** F4 consumption (2026-09-21): the toggleAria interactive wording
       *  retires together with the local checkbox flip, replaced by the
       *  read-only static badges */
      enabledBadge: "Enabled",
      disabledBadge: "Disabled",
      health: {
        unknown: "Not checked",
        ok: "Reachable",
        stale: "May be outdated",
        unreachable: "Unreachable",
      },
      neverChecked: "Never checked",
      checkedJustNow: "Checked just now",
      checkedMinutesAgo: "Checked {count} min ago",
      checkedHoursAgo: "Checked {count} hr ago",
      checkedDaysAgo: "Checked {count} d ago",
      packageCount: "Packages: {count}",
    },
    p1: {
      notice:
        "Repository and change management are not connected yet; installed packages are read-only for now.",
      noProjectsDescription:
        "Projects registered in VCC or ALCOM will appear here once detected.",
      projectsUnavailable:
        "The registered project list could not be read right now.",
      unreadableProjects: "{count} registered project entries could not be read.",
      dependenciesColumn: "Dependencies",
      dependenciesCount: "{count} direct",
      loadFailedTitle: "Could not read the installed packages",
      loadFailed: "The package engine answered with an error ({code}).",
      emptyInstalledDescription:
        "No packages are installed in this project yet. Use a {recipe} to set up the project and its packages.",
      noticeChangesOpen: "Repository and change management status: installed packages are readable and removal is available (subject to engine capabilities).",
      updatableColumn: "Updates",
      updateNotExecuted: "Updates have not been checked yet.",
      updateNoneUnderFilter: "No newer version matches the current filters.",

    },
    p2: {
      notice:
        "Repository subscriptions and package details are available to view. Editing is unavailable. Sections appear when the service provides data.",
      reposTitle: "Repository subscriptions",
      reposEmptyTitle: "No repository subscriptions",
      reposEmptyDescription: "No VPM repositories are configured in the local settings yet.",
      reposLoadFailedTitle: "Could not read the repository subscriptions",
      reposLoadFailed: "The package engine answered with an error ({code}).",
      repoCached: "Cached",
      repoNotCached: "Subscribed · cache not built",
      repoNoIdentifier: "(no identifier provided)",
      repoUrlLabel: "URL",
      repoLocalPathLabel: "Local path",
      catalogColumn: "Catalog",
      catalogTitle: "Catalog: {packageId}",
      catalogClose: "Close",
      catalogFailedTitle: "Could not load package details",
      catalogQueryFailed: "The package engine answered with an error ({code}).",
      catalogNotFoundTitle: "Not in any repository or local set",
      catalogNotFoundDescription: "No catalog information is available for this package ID.",
      catalogUnavailable: "Package details are currently unavailable.",
      sourceLabel: "Source",
      sourceRepoInstalled: "Repository package · installed",
      sourceRepoNotInstalled: "Repository package · not installed",
      sourceLocalInstalled: "Local package · installed",
      sourceLocalNotInstalled: "Local package · not installed",
      catalogCachedData:
        "Showing locally cached data because an online refresh was unavailable.",
      updateAvailableLabel: "Update",
      updateAvailableYes: "Update available",
      updateAvailableNo: "Up to date",
      versionsTitle: "Versions",
      versionsEmpty: "No repository versions (local packages carry no repository version list).",
      versionYanked: "yanked",
      compatibleYes: "compatible",
      compatibleNo: "incompatible",
      compatibleUnknown: "compatibility unknown",
      noticeChangesOpen: "View repository subscriptions and package details, and install or remove packages where supported. Sections appear when the service provides data.",
      partitionTitle: "Repositories",
      partitionAria: "Repositories section (subscriptions, installable packages, subscription management)",
      browseAction: "Browse packages",
      browseClose: "Collapse",
      browseAria: "Browse installable packages of {name}",
      browseTitle: "Installable packages of {name}",
      browseSearchPlaceholder: "Search by package ID or name",
      browseSearchAria: "Search installable packages",
      browseNotCachedDescription: "This repository is subscribed, but its package list has not been cached on this PC yet.",
      browseEmptyTitle: "No packages in this repository's cache",
      browseEmptyDescription: "No packages are listed in the local cache. The online repository may contain different information.",
      browseFailedTitle: "Unable to read the repository's installable packages",
      browseQueryFailed: "The packages engine returned an error ({code}).",
      browseUnavailable: "The installable-package inventory is temporarily unavailable.",
      browseLatestNone: "No version matches the current filters",
      browseVersionCount: "Cached versions: {count}",

    },
    empty: {
      engineTitle: "Package management is not connected yet",
      notConnectedTitle: "Package data is not connected yet",
      notConnectedDescription:
        "Once the package engine is connected, your projects, packages and repository subscriptions will appear here.",
      noProjectsTitle: "No projects yet",
      noProjectsDescription:
        "Add an existing Unity project folder to manage its packages here.",
      noSelectionTitle: "No project selected",
      noSelectionDescription: "Choose a project above to see its packages.",
      noPackagesTitle: "No packages in this project",
      noPackagesDescription:
        "Import a local package here, or use a {recipe} to set up the project.",
      noResultTitle: "No matching packages",
      noResultDescription: "Try a different search term or loosen the source filter.",
    },
    drawer: {
      aria: "Package details",
      close: "Close",
      closeAria: "Close package details",
      descriptionHeading: "Description",
      factsHeading: "Facts",
      installedLabel: "Installed version",
      latestLabel: "Latest version",
      sourceLabel: "Source",
      idLabel: "Package ID",
      changelogCta: "Open changelog",
      changelogFailed: "Could not invoke the system browser; please copy the link manually.",
    },
    bulk: {
      selectedCount: "{count} selected",
      updateAll: "Update all",
      installAll: "Install all",
      removeAll: "Remove selected",
      clear: "Clear selection",
    },
    menu: {
      viewDetails: "View details",
      updateToLatest: "Update to latest",
      installLatest: "Install latest",
      remove: "Remove",
      updateUnavailableReason: "Only packages with an update available can be updated",
      removeUnavailableReason: "Only installed packages can be removed",
    },
    toasts: {
      importAdded: "Local package imported.",
      projectAdded: "Project folder added.",
      nothingToChange: "Nothing to change for the current selection.",
      previewUnavailable: "Change preview is unavailable; the package engine is not connected.",
      applyFailed: "Changes could not be applied; the package engine is not connected.",
      appliedSummary: "Changes applied: {count}.",
    },
  },
  commandPalette: {
    cta: "Feature search",
    ctaHint: "Ctrl+P",
    aria: "Command palette",
    placeholder: "Jump to a page or run a command…",
    empty: "No matching commands.",
    groupPages: "Pages",
    groupActions: "Actions",
    toggleThemeToLight: "Switch to light theme",
    toggleThemeToDark: "Switch to dark theme",
  },
  placeholders: {
    notOpenTitle: "Not available yet",
    recipeDescription: "Recipe composition and the multi-layer relation graph arrive in a later milestone.",
    releaseDescription: "Preparing completed avatars for upload is not available on this page yet.",
    donateDescription: "Donation channels open before the official release. Thank you for your support.",
    packagesDescription: "Package install, update, migration and backup for Unity projects arrive in a later milestone. Interaction borrows from ALCOM and VCC, repackaged for beginners.",
  },
  navConfirm: {
    offAllowlistTitle: 'Open off-allowlist page?',
    offAllowlistBody: 'This page is outside the browsing allowlist and will open in the embedded view after you confirm.',
    externalTitle: 'Open external application?',
    externalBody: 'This page asked to open an external application. Only continue if you trust it.',
    openCta: 'Open',
    cancelCta: 'Cancel',
    pendingCount: "More confirmations waiting: {count}",
  },

  settings: {
    accounts: {
      boothTitle: "Booth / pixiv",
      boothDescription: "Sign in to sync your library and silently download owned files; credentials stay in this machine's partition session - VUA never touches them.",
      steamTitle: "Steam",
      steamDescription: "Steam account integration is not available yet.",
      vrchatTitle: "VRChat",
      vrchatDescription: "VRChat account integration is not available yet.",
      unityTitle: "Unity",
      unityDescription: "Unity account integration is not available yet.",
      statusSignedIn: "Signed in",
      statusSignedOut: "Signed out",
      statusUnknown: "Checking",
      signIn: "Sign in",
      signOut: "Sign out",
      notWired: "Not wired yet",
    },
    /** Experimental page (W15 rework, user walkthrough mockups A/B): one card
     *  = title + subtitle + warning strip + two toggle rows. Row 1 “Generate
     *  VPM replacement” writes the frozen warehouse.setGlobalDefaultMode
     *  (bdl-commands v0.2 global level); row 2 “Delete originals after
     *  generation” is a danger toggle backed by an unwired preference (the
     *  global auto-delete exceeds the frozen entry-level command; the wire
     *  face follows proposal 008), guarded by a danger confirm dialog and
     *  permanently labeled as unwired. */
    experimental: {
      title: "Experimental features",
      subtitle: "Off by default; read the notes carefully before use",
      badge: "Experimental",
      warning: "Experimental features may behave unexpectedly. Make sure you understand the impact before enabling.",
      generateTitle: "Generate VPM package replacement",
      generateDesc: "Automatically generates a VPM package when importing assets, replacing the original UnityPackage (experimental).",
      globalReadUnknown: "The current default has not been loaded yet. If you change it, the confirmed result will be shown.",
      downloadChecklistTitle: "Show file checklist before download",
      downloadChecklistDesc: "Off = silently download all files in one click; on = show a file checklist (all selected by default) first.",
      deleteTitle: "Delete originals after generation",
      deleteBadge: "Danger",
      deleteDesc: "Deletes the original .unitypackage files once VPM generation completes. This is irreversible; enable only after confirming the generated quality. Requires “Generate VPM package replacement” first. Turning that switch off resets this switch to off.",
      devPrototypeNote: "This prototype does not actually delete any files.",
      dialogTitle: "Dangerous operation confirm",
      dialogBodyA: "After enabling “Delete originals after generation”, VPM generation will ",
      dialogBodyEmphasis: "permanently delete",
      dialogBodyB: " the corresponding .unitypackage files.",
      dialogWarning: "This is irreversible. Make sure you have verified the VPM generation result before enabling.",
      dialogCancel: "Cancel",
      dialogConfirm: "I understand the risk, enable",
    },
    goals: {
      heading: "Reset Goals",
      description: "Re-run the first-launch goal selection. Current choices are kept until you confirm.",
      restartCta: "Re-select goals",
    },
    /** Environment & Paths page (U10 desktop half, 021 convergence 1-6):
     *  probed rows carry the constant "probed" source; manual pick passes all
     *  three layouts verbatim; refusal codes map to i18n, a refusal is a
     *  normal finding and is never hidden */
    environment: {
      probedHeading: "Detected Unity editors",
      probedNote:
        "Editors found in Unity Hub locations. Finding an editor does not select it for use.",
      probedEmpty: "No editors were detected in the Unity Hub default locations.",
      unavailable: "Environment detection is not available yet.",
      uninterpretable: "The detection result could not be interpreted.",
      loading: "Reading environment detection…",
      sourceProbed: "Detected",
      sourcePicked: "Picked",
      chinaMark: "Unity China",
      pickHeading: "Pick an editor manually",
      pickNote:
        "Choose the editor executable, its version folder (for example, …\\2022.3.22f1), or its Editor folder. VUA checks the selected path before use.",
      pickFileCta: "Browse for executable…",
      pickDirCta: "Browse for folder…",
      verifying: "Verifying",
      verifiedHeading: "Verified",
      guidanceLabel: "Compatibility guidance:",
      trustText:
        "After confirmation, VUA can use this program ({exePath}) for avatar creation on this PC. You only need to confirm once for this selection.",
      confirmCta: "Confirm and enable",
      refusedHeading: "Verification refused (a normal finding, not a malfunction)",
      refusalTargetMissing: "Target missing: no verifiable Unity editor exists at this path.",
      refusalExeMissing: "The editor executable was not found.",
      refusalIdentityUnreadable: "The editor identity could not be read (version resource unreadable).",
      refusalNotAnEditor: "This program is not a Unity editor (identity does not match the name).",
      refusalUnsupportedPlatform: "Verification is not supported on this platform.",
      verifyUnavailable: "The verification service is not available right now.",
      verifyFailed: "The verification request failed.",
      confirmedHeading: "Enabled picked editor",
      confirmedEmpty: "No picked editor is enabled yet.",
      confirmedAt: "Confirmed at {time}",
      effectiveNote: "Takes effect after restarting VUA.",
      clearCta: "Clear picked editor",
      saveFailed: "Saving failed.",
      classProductionTarget: "Production target",
      classMigrationSource: "Migration source",
      classOtherVersion: "Other Unity version",
      classTuanjie: "Tuanjie family",
    },
    theme: {
      appearanceHeading: "Appearance",
      appearanceAria: "Appearance theme",
      system: "Follow system",
      dark: "Dark",
      light: "Light",
      hcHeading: "High contrast",
      hcDescription:
        "Follow system: activates when Windows high contrast is on. Always on: uses a high-contrast palette in-app, independent of system settings.",
      hcAria: "High contrast mode",
      hcAuto: "Follow system",
      hcOn: "Always on",
      saverHeading: "Resource saver",
      saverDescription:
        "Turns off heavy display features — 3D previews (release turntable), interface motion, glow and glass blur — to free system resources while you play in VR. Functionality and status cues are unaffected.",
      saverTurnOn: "Turn on resource saver",
      saverTurnOff: "Turn off resource saver",
      saverStateOff: "Currently off",
      saverStateManual: "Currently on (manual)",
      saverStateAuto: "Currently on (auto: SteamVR running)",
      saverAutoLabel: "Turn on automatically while SteamVR is running",
      saverAutoAria: "Auto-enable resource saver while SteamVR is running",
      saverAutoNote:
        "Runtime detection is not connected yet; this preference takes effect automatically once it is connected.",
    },
    language: {
      heading: "Interface language",
      description: "Switching reloads the UI immediately. More translations are in progress.",
      aria: "Interface language",
      pending: "translating",
    },
    version: {
      heading: "VUA Desktop",
      versionLine: "v{version} · Early preview",
      description:
        "An early preview of VUA. Available features depend on the connected local services; see each page for their current status.",
      debugHeading: "Debug mode",
      debugDescription:
        "When enabled, warehouse product details show full structured data (including entity UUIDs) for troubleshooting data issues. Display only; nothing is modified.",
      debugToggle: "Show product debug info",
      diagnosticsHeading: "Diagnostics export",
      diagnosticsDescription:
        "Export a redacted diagnostics bundle for troubleshooting. Contains only: app version, data source, environment check states with timestamps, and your goal selection. Never contains: file paths, asset or recipe content, account or device identifiers.",
      diagnosticsExport: "Export diagnostics",
      diagnosticsFailed: "Export failed. Please try again.",
      updateHeading: "Update check",
      updateDescription:
        "VUA checks for a newer version at startup. It does not download or install updates. You can turn this check off here.",
      updateToggle: "Check for updates on launch",
      updateNow: "Check now",
      updateChecking: "Checking…",
      updateNewer: "New version available: {version}",
      updateUpToDate: "You are on the latest version.",
      updateFailed: "Update check failed. It will retry on the next launch.",
      updateCheckedAt: "Last checked: {at}",
      updateViewRelease: "View release notes",
    },
    about: {
      heading: "VRC Ultra Assistant",
      description:
        "Tools for setting up VRChat and creating avatars with {amf}.",
      bannerSlot: "Banner slot: the banner lands here once the mascot is finalized.",
      contributorsHeading: "Contributors & source",
      contributorsDescription:
        "VUA is open source — contributions of code, docs and community skins are welcome; see CONTRIBUTING and AGENTS in the repository.",
      repoCta: "Open project repository",
      repoImpact: "Opens the GitHub repository page in the system browser.",
      repoFailed: "Failed to open. Check your system browser settings and retry.",
    },
  },
  compose: {
    subtitle: 'Pick assets, shape the visual target, then save as a recipe.',
    draftTitle: 'Current draft',
    draftEmptyTitle: 'The draft is empty',
    draftEmptyDesc: "Add assets from the list below to start your avatar draft.",
    roleLine: 'role: {role}',
    removeItemAria: 'Remove {title} from the draft',
    removeCta: 'Remove',
    undoCta: 'Undo',
    saveCta: 'Save recipe',
    savingCta: 'Saving…',
    saveFailedNote: 'Saving failed - your draft is preserved. You can retry.',
    savedNote: 'Saved (recipe revision {revision}).',
    saveDisabledNote: "Saving is unavailable until the required asset information is available.",
    nameHintPlaceholder: "Name in recipe (required)",
    nameHintAria: "Name in recipe for {title}",
    advancedMountToggle: "Names in recipe (advanced)",
    autoNameNote: "Names are filled from asset titles. Change them only if needed.",
    dedupTitle: 'Identical recipe already exists',
    dedupBody:
      'An identical recipe already exists (id {recipeId}, revision {revision}). Save as a new revision anyway?',
    dedupConfirmCta: 'Save anyway',
    dedupCancelCta: 'Cancel',
    unsavedNote: 'Unsaved draft - content stays until saved or removed.',
    sourceTitle: "Assets in your library",
    sourceDesc: 'Pick an asset entry, then add it to the draft. No Unity project needed.',
    sourceEmptyTitle: 'No warehouse entries',
    sourceEmptyDesc: 'Import assets first; they will appear here for composing.',
    inDraftBadge: 'In draft',
    addCta: 'Add to draft',
    chain: {
      title: "Create your avatar",
      subtitle: "Select or save a recipe, check assets and dependencies, review the plan, then run avatar setup and view the results.",
      recipeLine: 'Recipe {recipeId} (revision {revision}).',
      staleWarning: "The draft changed. Save it and check assets and dependencies again before using a plan.",
      inspectionNote: "Check results cannot be displayed on this page yet.",
      resolveTitle: "Assets and dependencies",
      resolveCta: "Check required assets",
      resolveRequesting: "Requesting asset and dependency checks…",
      resolveFailedNote: "Could not request asset and dependency checks. Try again.",
      planTitle: 'Plans',
      planRefreshCta: 'Refresh plans',
      planLoading: 'Loading plans…',
      planFailedNote: 'Loading plans failed — retry available.',
      planApproveFailedNote: 'Plan approval failed — retry available.',
      planEmptyTitle: 'No plans yet',
      planEmptyDesc: "Plans for this recipe appear after its assets and dependencies have been resolved.",
      planLine: 'Plan {planId}',
      planApproveCta: 'Approve plan',
      planApproving: 'Approving…',
      planStatus: {
        draft: 'Awaiting approval',
        approved: 'Approved',
        superseded: 'Superseded',
      },
      executeCta: "Run avatar setup",
      executeRequesting: 'Requesting execution…',
      executeFailedNote: 'Execution request failed — retry available.',
      executeTitle: "Avatar setup",
      executePendingNote: "Approve a plan before running avatar setup.",
      recordTitle: 'Build records',
      recordCta: 'View build records',
      recordPendingNote: "Build records become available after the setup request is accepted.",
      recordLoading: 'Loading records…',
      recordFailedNote: 'Loading records failed — retry available.',
      recordEmptyTitle: 'No build records on this chain',
      recordEmptyDesc: "After setup completes, build records for this avatar configuration appear here.",
      recordLine: 'Record {buildId} · {status} · {at}',
      taskLine: 'Task {taskId}',
      taskMissingNote: "notification center does not show this task (possibly disconnected or restarted).",
      taskCancelHint: "Cancellable in the notification center",
    },
  },
  inspection: {
    subtitle: "Review the checks and next steps after avatar setup.",
    reportTitle: 'Report',
    emptyTitle: "Check reports unavailable",
    emptyDesc: "Checks run during avatar setup. The current connection cannot provide their reports.",
    evidenceTitle: 'Evidence',
    evidenceEmptyNote: "The current connection cannot provide check results.",
    nextTitle: 'Next steps',
    localVsOfficialNote: "Local checks are separate from the official VRChat SDK results. This page does not display official SDK verdicts.",
    listEmptyTitle: 'No inspection evidence yet',
    listEmptyDesc: 'Evidence appears here, newest first, once inspection runs complete.',
    detailMissingNote: 'This inspection evidence does not exist or has been cleared.',
    loadFailedNote: 'Reading failed — retry available.',
    refreshCta: 'Refresh',
    runUnavailableNote: "Checking requires selecting an avatar in the Unity scene. Starting a check from this page is not available yet.",
    overallLabel: 'Overall verdict',
    overall: { pass: 'Pass', warn: 'Attention', fail: 'Failed' },
    dimensionsLabel: "Check categories",
    dimensions: { functional: 'Functional', performance: 'Performance', dependencies: 'Dependencies', lighting: 'Lighting', upload_readiness: 'Upload readiness' },
    dimensionStatus: { pass: 'Pass', warn: 'Attention', fail: 'Failed', unavailable: "Not checked" },
    basis: { bridge_typed_checks: "Checks in Unity", bridge_local_estimate: 'Local estimate (not an official rating)', official_sdk_rating: "Official SDK result (not supported yet)", static_analysis: 'Static analysis', none: "No check results" },
    bridgeLine: "Editor {version} · checks: {count}",
    checksTitle: "Check results",
    checkSeverity: { error: 'Blocking', warning: 'Attention', info: 'Info' },
    emptyDimensionsNote: "This report has no category-level check results.",
  },
  dev: {
    uiSwitchTitle: 'UI root (multi-UI, batch A)',
    uiSwitchDesc: 'Switch the active UI root. The shared container (gateway, subscriptions, session state) is preserved across switches. Forest-green availability depends on whether this build contains its local (gitignored) sources; when absent it is shown as unavailable.',
    uiCurrentLabel: 'Current UI',
    uiForestLabel: 'Forest-green composing UI',
    uiForestUnavailable: 'Not wired yet',
    uiForestUnavailableDesc: 'The forest-green composing UI is not part of this build (its local sources are absent). Its capabilities arrive with batch D; the current UI remains fully functional.',
    uiBackToCurrentCta: 'Back to the current UI',
    uiSwitchSummaryTitle: 'Shared draft (read-only summary)',
    uiSwitchSummaryNote: 'The content below comes from the shared container draft and is kept read-only here; go back to the current UI to continue editing. Nothing is overwritten.',
    uiSwitchSummaryHintLine: 'Mount name: {hint}',
    uiSwitchSummaryDirty: 'The draft has unsaved changes, preserved as they are.',
    uiSwitchSummarySaved: 'Last saved: recipe revision {revision}.',
    uiForestLoading: 'Loading the forest-green UI…',
    uiForestLoadFailed: 'Failed to load',
    uiForestLoadFailedDesc: 'The forest-green UI module failed to load. This usually means the local sources are incomplete or contain an error. The shared draft is unaffected; go back to the current UI to continue.',
    uiForestSkeletonDesc: 'The local forest-green skeleton is loaded. Composing-workbench capabilities arrive with later batch D slices of proposal 019; all real capabilities live in the current UI, and no simulated substitute is provided here.',
    devModeTitle: 'Development mode (per-port connection targets)',
    devModeDesc: 'Switch individual gateway ports between the live connection and demo fixtures. Any fixture port keeps the demo-data badge visible. Session-scoped; a page reload applies each change. Never shown in production builds.',
    presetsLabel: 'Common presets',
    presetAllLive: 'All live',
    presetAllFixture: 'All demo fixture',
    fixtureTierLabel: 'Fixture data tier (applies to ports set to fixture)',
    portEnvironment: 'Environment',    portTutorial: 'Tutorial',    portModelProduction: 'Model production',    portToolCatalog: 'Tool catalog',    portTask: 'Tasks',    portSettings: 'Settings',    portAcquire: 'Warehouse (read)',    portWarehouseCommands: 'Warehouse (write)',    portProjectOps: 'Project operations',    portPackages: 'Packages',
    targetFixture: 'Use demo fixture',
    targetLiveReset: 'Reset to live',
    devModeReloadNote: '{count} port(s) currently on fixture targets.',
    tag: "DEV",
    aria: "Dev scenario switch",
    expandAria: "Expand dev scenario switch",
    collapseAria: "Collapse dev scenario switch",
    demoMixed: "Demo · mixed",
    demoAllGreen: "Demo · all green",
    demoWorkshop: "Demo · workshop",
    demoWorkshopWarning: "Demo · workshop pending",
    demoWorkshopBlocked: "Demo · workshop blocked",
    demoWorkshopRecover: "Demo · workshop recover",
    demoTasks: "Demo · tasks",
    demoEnvFresh: "Demo · env unchecked",
    demoEnvFail: "Demo · check failed",
    demoAcquireEmpty: "Demo · empty warehouse",
    demoPackages: "Demo · packages",
    productionInspect: "Demo · production inspect",
    productionPlan: "Demo · production plan review",
    productionRunning: "Demo · production running",
    productionSuccess: "Demo · production success",
    productionCancelled: "Demo · production cancelled",
    productionDrifted: "Demo · production drifted",
    productionExpired: "Demo · production expired",
    productionRollback: "Demo · production rollback",
    notRun: "Honest empty state",
    perfProbe: {
      title: "Performance sampling",
      longTasks: "{count} long tasks",
      measures: "Recent measures",
      empty: "No samples yet",
    },
  },
  /** 预览实验室(DEV spike ?dev=preview-lab):T1 webview 直渲素材 / T2 Unity 烘焙成品对照 */
  previewLab: {
    title: "Preview lab",
    subtitle:
      "DEV spike: T1 webview-rendered source materials vs T2 Unity-baked product; project data is read from the local demo manifest and never committed to the repo.",
    needRootTitle: "No demo project specified",
    needRootBody:
      "Append &demoRoot=<Unity project path> to the URL; the page reads .vua/bridge/demo-lab.json from that project.",
    demoRootLabel: "Project",
    manifestLoading: "Reading demo manifest…",
    manifestFailedTitle: "Demo manifest unavailable",
    manifestFailedBody:
      "Could not read {path}. Check demoRoot and that .vua/bridge/demo-lab.json exists in the project.",
    sourcesTitle: "Materials · T1 direct webview render",
    sourcesNote:
      "Unity custom shaders are approximated with the base material plus its main texture; FBX-embedded textures are kept. Lighting and shading differ from the Unity bake.",
    productsTitle: "Products · T2 Unity editor bake",
    productsNote:
      "Turntable frames are baked by the Unity editor bridge into .vua/bridge/preview/; the VRM is rendered directly by the webview as a control.",
    cardStatusLoading: "Loading…",
    cardStatusFailed: "Load failed",
    bakePending: "Bake output not found — run build_preview in Unity first ({path}).",
    bakedMeta: "{frames} frames · {width}×{height} · {triangles} tris",
    loadingFrames: "Loading frames {loaded}/{total}…",
    dragHint: "Drag to rotate",
    kindFbx: "FBX source",
    kindVrm: "VRM export",
    kindTurntable: "Unity bake",
  },
  showcase: {
    title: "Component state showcase",
    subtitle: "Dev walkthrough page: interaction states are force-rendered; values reference tokens only, no new visual values.",
    motionNormal: "Normal motion",
    motionReduced: "Simulated reduced motion",
    themeDark: "Dark theme",
    themeLight: "Light theme",
    districtPurple: "VUA purple district (default)",
    districtOrange: "{amf} orange district (avatar production)",
    themeHc: "High contrast (manual preview)",
    loadingNote: "See the skeleton section for loading; buttons have no separate loading state.",
    sections: {
      button: "Button",
      badge: "Badge",
      card: "Card",
      texture: "Control texture (v0.4.0 §3.6)",
      statusLight: "StatusLight",
      emptyState: "EmptyState",
      mascot: "Mascot",
      skeleton: "Skeleton",
      mediaSlot: "MediaSlot",
      navSelected: "Nav selected state",
      capability: "Capability states",
    },
    states: {
      default: "Default",
      hover: "Hover",
      pressed: "Pressed",
      focused: "Focused",
      selected: "Selected",
      disabled: "Disabled",
      loading: "Loading",
      ready: "Ready",
      failed: "Failed",
    },
    badgeTones: {
      neutral: "Neutral",
      brand: "Brand",
      success: "Success",
      warning: "Warning",
      error: "Error",
    },
    demo: {
      buttonLabel: "Action",
      cardBody: "Sample card content; hover lifts with a district-colored border.",
      emptyTitle: "Not connected",
      emptyDescription: "Sample empty-state copy for showcase walkthroughs.",
      navTab: "Top tab",
      navSidebar: "Sidebar item",
    },
    textureDemo: {
      panel: "Glass panel: hairline border · translucent · backdrop blur",
      panelBody: "Cards and panels layer via hairline borders and glass, letting the canvas aurora glow through.",
      elevated: "Elevated overlay: glow shadow",
      elevatedBody: "Overlays keep a dual shadow: ambient light plus an accent-colored glow; hover lifts and blooms.",
      input: "Input: 6px radius",
      inputPlaceholder: "Input placeholder text",
    },
  },
  wizard: {
    wrongStep: "Current step is {current}; cannot submit {submitted}",
    onlyReview: "Execution can only start from the review page",
    noProject: "No project selected yet",
    required: "{label} is required",
    labels: {
      outfit: "Outfit",
      outfitArmature: "Outfit Armature",
      toggleName: "Toggle name",
      workflowId: "Workflow ID",
    },
  },
  /** bdl-queries v0.5 consumption-preparation slice (2026-09-22): dependency
   *  reverse-lookup / observation word-face infrastructure — the consuming
   *  page lands after the U18 final ruling. The clues-not-conclusions law
   *  governs every row: advisory copy always reads as a SUGGESTION (layout-
   *  evidence tiers and suggested install sources), never a fact claim.
   *  Availability pairs ride the standing warehouse.availability rows (zero
   *  dead duplicates; pinned by the dependencies-port test). installSource
   *  carries exactly the two values advisory rule v1 emits — vpm/unknown
   *  stay in the frozen closed set and are never emitted, so no rows exist
   *  for them (no dead word faces). */
  dependencies: {
    confidence: {
      strong: "Explicitly declared by the author (dedicated section or single line)",
      weak: "Mentioned in a listed line (real but compressed)",
    },
    installSource: {
      booth_page: "Suggested install source: BOOTH product page",
      external_page: "Suggested install source: external page",
    },
  },
  /** Application-face error copy, keyed by the messageKey the wire carries
   *  (key-first: provider sends errors.catalog.* on the error channel). The
   *  catalog browser currently degrades failures to not-connected/not-found;
   *  surfacing these keys in that view is a follow-up slice. */
  errors: {
    recipe: { draftFailed: "The Recipe draft operation could not finish." },
    library: { downloadFailed: "The library download could not finish. Previously stored files are kept.", removalFailed: "Local files could not be deleted. Refresh their status and inspect the task." },
    catalog: {
      syncFailed: "Library sync could not finish. Saved entries are kept; check the task record.",
      productNotFound:
        "This catalog entry was not found. It may have been removed or delisted.",
      invalidParams: "The catalog request did not pass validation.",
      unavailable: "The catalog service is not connected.",
      storeFailed: "The catalog store hit a failure; the request was not completed.",
      fallback: "The catalog operation could not be completed.",
    },
    job: {
      environmentUnmet:
        "This job needs a Unity environment that is not in place yet. Install or select the required editor, then retry.",
      environmentCheckFailed:
        "The environment check itself failed (external error). You can retry.",
    },
    project: {
      projectNotFound:
        "This path is not registered with a managed project (VCC/ALCOM), so there is nothing to inspect here.",
    },
    environment: {
      verifyUnavailable: "The editor verification service is not available right now.",
    },
    /** Material-chain error copy (desktop batch 142, task-event failure-row
     *  presentation): keys = wire messageKeys (vua.material family errors
     *  carried by AppErrorV01). Batch 169 completes the table to the engine's
     *  full 12-key errors.material.* emission face (core batch-150
     *  failure_message_key split plus the material_intake / provider-host
     *  emitters; each row anchored to its emission site, no invented
     *  semantics). The failure row still presents the localized face AND the
     *  raw code side by side (batch-148 dual-fact law) — the code is never
     *  shadowed. */
    material: {
      executionFailed: "Material execution failed: the Unity-side operation did not complete.",
      provisionFailed: "Target project provisioning failed: the Unity project is not ready for material import.",
      sourceInvalid: "The material source is invalid: the path does not point to a readable material folder.",
      sourceEmpty: "The material source is empty: the folder contains no .unitypackage.",
      sourceUnreadable: "The material source could not be read: reading the material folder failed.",
      sourceDrift: "The material source changed after the plan was confirmed (source fingerprints no longer match); inspect the source and confirm again.",
      planHashMismatch: "The import plan failed its integrity check (plan hash mismatch) and was rejected.",
      riskDecisionStale: "The recorded risk decision no longer matches the current plan or source; start the material flow again.",
      riskDecisionRequired: "This plan requires a risk decision before it can be confirmed.",
      cancelled: "The material operation was cancelled: the risk decision chose to cancel.",
      internal: "An internal error occurred while preparing the material operation.",
      recordFailed: "The material operation was rolled back and restored, but saving its record failed: the outcome was not persisted to the task records.",
    },
    /** Handoff admission gate copy (U19 user ruling 2026-09-21, BOARD U19 row
     *  as the normative source). Reserved rows — the codes
     *  vua.release_handoff.record_state_blocked (params: {state}) and
     *  vua.release_handoff.record_state_unknown travel with the core seat's
     *  admission-gate slice (wt-2, in flight); the copy lands first in sync
     *  across the four tables so the codes hit on arrival. */
    releaseHandoff: {
      stateBlocked:
        "Handoff was rejected: this build record's current state does not permit handoff (state: {state}).",
      stateUnknown:
        "Handoff was rejected: this build record's state cannot be confirmed.",
    },
  },
};

/**
 * Widening (C-I18N): literal types of the source table → string, so other
 * locale tables can be assigned to the same shape. The key structure is still
 * enforced by the mapped type (missing/extra keys fail compilation);
 * placeholder parity is verified by scripts/check-i18n-tables.mjs.
 */
type Widen<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly Widen<U>[]
    : { [K in keyof T]: Widen<T[K]> };

export type Strings = Widen<typeof strings>;
