import { verifyGridFactoryState } from "./grid-review.js";

// View registry for the design audit. Adding a view to the audit means adding
// one entry to VIEWS (or one view id to a FACTORY_VIEWS expansion). Each entry
// names its fixture harness, its functional area and how the runner drives it
// to the wanted state. Fixtures describe the HTML shell and readiness signal;
// the runner (../design-audit.mjs) executes the rest generically.
//
// Shell templates mirror the corresponding smoke/preview scripts exactly so the
// audited render matches the reviewed render.

export const FIXTURES = {
  factory: {
    prefix: "/__factory",
    // preview-factory.mjs shell: locale written before module load, theme on
    // <html>, AMF production jurisdiction on #root.
    shell: ({ locale, theme, themeFamily = "grid" }) =>
      `<html data-theme="${theme}" data-theme-family="${themeFamily}"><head><script>localStorage.setItem("vua-locale", ${JSON.stringify(locale)});</script>`
      + `<style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column;padding:24px;box-sizing:border-box;background:var(--vua-bg-canvas)}</style></head>`
      + `<body><div id="root" data-module="production"></div>`
      + `<script type="module" src="/scripts/fixtures/factory-preview.tsx"></script></body></html>`,
    themeMode: "attribute",
    readyGlobal: null,
    viewport: () => ({ width: 1280, height: 860 }),
    settleFor: view => (view.startsWith("control-recipes") || view === "workshop-delete" ? 4500 : 2500),
  },
  "library-navigation": {
    prefix: "/__library-navigation",
    shell: ({ locale }) =>
      `<html><body data-module="production" data-vua-shape-scope="amf"><div id="root"></div>`
      + `<script>localStorage.setItem('vua-locale',${JSON.stringify(locale)})</script>`
      + `<script type="module" src="/scripts/fixtures/library-navigation.tsx"></script></body></html>`,
    themeMode: "attribute",
    readyGlobal: "libraryNavigationReview",
    viewport: () => ({ width: 1200, height: 900 }),
  },
  "migration-planner": {
    prefix: "/__migration-planner",
    shell: ({ locale }) =>
      `<html><body data-module="production" data-vua-shape-scope="amf"><div id="root"></div>`
      + `<script>localStorage.setItem('vua-locale',${JSON.stringify(locale)})</script>`
      + `<script type="module" src="/scripts/fixtures/migration-planner.tsx"></script></body></html>`,
    themeMode: "attribute",
    viewport: () => ({ width: 1200, height: 900 }),
  },
  "library-bulk": {
    prefix: "/__library-bulk",
    shell: ({ locale }) =>
      `<html><body data-module="production" data-vua-shape-scope="amf"><div id="root"></div>`
      + `<script>localStorage.setItem('vua-locale',${JSON.stringify(locale)})</script>`
      + `<script type="module" src="/scripts/fixtures/library-bulk.tsx"></script></body></html>`,
    themeMode: "attribute",
    readyGlobal: "libraryBulkReview",
    viewport: () => ({ width: 1200, height: 900 }),
  },
  "library-corners": {
    prefix: "/__library-corners",
    shell: ({ locale }) =>
      `<html><body data-module="production" data-vua-shape-scope="amf"><div id="root"></div>`
      + `<script>localStorage.setItem('vua-locale',${JSON.stringify(locale)})</script>`
      + `<script type="module" src="/scripts/fixtures/library-corners.tsx"></script></body></html>`,
    themeMode: "attribute",
    readyGlobal: "libraryBulkReview",
    viewport: () => ({ width: 1200, height: 900 }),
  },
  "library-entries": {
    prefix: "/__library-entries",
    shell: ({ locale }) =>
      `<html><body data-module="production" data-vua-shape-scope="amf"><div id="root"></div>`
      + `<script>localStorage.setItem('vua-locale',${JSON.stringify(locale)})</script>`
      + `<script type="module" src="/scripts/fixtures/library-entries.tsx"></script></body></html>`,
    themeMode: "attribute",
    readyGlobal: "n5EntriesReview",
    viewport: () => ({ width: 1200, height: 900 }),
  },
  "library-maintenance": {
    prefix: "/__library-maintenance",
    shell: ({ locale }) =>
      `<html><body data-module="production" data-vua-shape-scope="amf"><div id="root"></div>`
      + `<script>localStorage.setItem('vua-locale',${JSON.stringify(locale)})</script>`
      + `<script type="module" src="/scripts/fixtures/library-maintenance.tsx"></script></body></html>`,
    themeMode: "attribute",
    readyGlobal: "n5MaintenanceReview",
    viewport: () => ({ width: 1200, height: 900 }),
  },
  "first-run": {
    prefix: "/__first-run-review",
    shell: ({ locale, theme }) =>
      `<html data-theme="${theme}"><head><script>localStorage.setItem("vua-locale", ${JSON.stringify(locale)});localStorage.setItem("vua-theme", ${JSON.stringify(theme)});</script></head>`
      + `<body><div id="root"></div>`
      + `<script type="module" src="/scripts/fixtures/first-run-review.tsx"></script></body></html>`,
    // The App reads its theme preference at mount, so each theme reloads and
    // the fixture steps re-mount the wanted page.
    themeMode: "storage-reload",
    readyGlobal: "firstRunReview",
    viewport: () => ({ width: 1280, height: 860 }),
  },
  "deployment-check": {
    prefix: "/__deployment",
    shell: ({ locale }) =>
      `<html data-theme="dark"><head><script>localStorage.setItem("vua-locale", ${JSON.stringify(locale)});</script></head>`
      + `<body><div id="root"></div>`
      + `<script type="module" src="/scripts/fixtures/deployment-check.tsx"></script></body></html>`,
    themeMode: "attribute",
    readyGlobal: "deploymentReview",
    viewport: () => ({ width: 1200, height: 900 }),
  },
  "network-check": {
    prefix: "/__network",
    shell: ({ locale }) =>
      `<html data-theme="dark"><head><script>localStorage.setItem("vua-locale", ${JSON.stringify(locale)});</script></head>`
      + `<body><div id="root"></div>`
      + `<script type="module" src="/scripts/fixtures/network-check.tsx"></script></body></html>`,
    themeMode: "attribute",
    readyGlobal: "networkReview",
    viewport: () => ({ width: 1200, height: 900 }),
  },
  "import-dialog": {
    prefix: "/__import-dialog",
    shell: ({ locale }) =>
      `<html data-theme="dark"><head><script>localStorage.setItem("vua-locale", ${JSON.stringify(locale)});</script></head>`
      + `<body><div id="root"></div>`
      + `<script type="module" src="/scripts/fixtures/import-dialog-modal.tsx"></script></body></html>`,
    themeMode: "attribute",
    readyGlobal: "importDialog",
    viewport: () => ({ width: 1200, height: 900 }),
  },
  "resource-monitor": {
    prefix: "/__resource-monitor",
    shell: ({ locale }) =>
      `<html data-theme="dark"><head><script>localStorage.setItem("vua-locale", ${JSON.stringify(locale)});</script></head>`
      + `<body><div id="root"></div>`
      + `<script type="module" src="/scripts/fixtures/resource-monitor-popover.tsx"></script></body></html>`,
    themeMode: "attribute",
    readyGlobal: "resourceMonitorSmoke",
    viewport: () => ({ width: 1200, height: 900 }),
  },
  "task-window": {
    prefix: "/__task-window-review",
    query: { view: "status" },
    shell: ({ locale, theme }) =>
      `<html data-theme="${theme}"><head>`
      + `<script>localStorage.setItem("vua-locale", ${JSON.stringify(locale)});localStorage.setItem("vua-theme", ${JSON.stringify(theme)});</script></head>`
      + `<body><div id="root"></div>`
      + `<script type="module" src="/scripts/fixtures/task-window-review.tsx"></script></body></html>`,
    // The overlay surface reads vua-theme at mount, so each theme reloads.
    themeMode: "storage-reload",
    readyGlobal: "taskWindowReview",
    viewport: () => ({ width: 1200, height: 900 }),
  },
  "ai-preparation": {
    prefix: "/__agent",
    shell: ({ locale }) =>
      `<html data-theme="dark"><head><script>localStorage.setItem("vua-locale", ${JSON.stringify(locale)});</script>`
      + `<style>html,body,#root{height:100%;margin:0}#root{padding:24px;max-width:1000px;box-sizing:border-box}</style></head>`
      + `<body><div id="root"></div>`
      + `<script type="module" src="/scripts/fixtures/ai-preparation.tsx"></script></body></html>`,
    themeMode: "attribute",
    readyGlobal: "agentUiReview",
    viewport: () => ({ width: 1200, height: 900 }),
  },
};

// AMF/preview views, including the unavailable repository-action layout.
const FACTORY_VIEWS = [
  "workshop-running", "workshop-waiting-auto", "workshop-waiting", "workshop-mode-menu",
  "workshop-full-access", "workshop-attention", "workshop-interrupted", "workshop-finished",
  "workshop-materials", "workshop-inspect", "workshop-line-menu", "workshop-delete",
  "workshop-capacity", "workshop-rebuild", "workshop-opening", "workshop-opened",
  "workshop-versions", "workshop-versions-plan", "workshop-versions-confirm", "workshop-versions-error",
  "workshop-fitsave", "workshop-fitplan", "workshop-fitreview", "workshop-ft", "workshop-ft-dialog",
  "workshop-ft-locked", "workshop-ft-none", "workshop-close-offer", "workshop-texture",
  "workshop-switch", "workshop-switch-adjust", "workshop-prediction",
  "control-recipes", "control-recipes-still", "control-recipes-selected", "control-recipes-part",
  "control-recipes-list", "control-recipes-many", "control-recipes-empty", "control-fits",
  "control-packages", "control-packages-project", "control-packages-project-smart",
  "control-packages-project-full", "control-packages-unlisted", "control-packages-repos", "control-packages-repos-add", "control-packages-repos-disabled",
  "release-album", "release-stills", "release-turn", "release-confirm", "release-signin",
  "release-uploading", "release-uploaded", "release-check", "release-failed", "release-empty",
  "release-sdk", "release-vrchat", "release-vrchat-signin", "release-queued", "release-terms",
  "release-guide",
  "settings-vrchat", "settings-vrchat-account",
  "license-hub", "license-check", "license-active",
  "terms-parsed", "terms-items", "terms-unread", "terms-link",
  "materials-start", "materials-start-missing",
  "network-tiers", "network-tiers-details",
  "feedback-tiers", "feedback-dialog",
];

function factoryArea(view) {
  if (view.startsWith("workshop")) return "workshop";
  if (view.startsWith("control")) return "control-center";
  if (view.startsWith("release")) return "release-room";
  if (view.startsWith("settings") || view.startsWith("license")) return "settings-licenses";
  if (view.startsWith("terms")) return "terms";
  if (view.startsWith("materials")) return "materials-start";
  if (view.startsWith("network")) return "network-tiers";
  if (view.startsWith("feedback")) return "feedback";
  return "other";
}

const ONE_ACCENT_EXEMPT = new Set();

function factoryView(id) {
  const review = ["workshop-running", "workshop-waiting", "workshop-finished", "control-packages-repos", "control-packages-repos-disabled"].includes(id);
  // The prediction table sits below the plan's review list and arrives with the plan; wait
  // for it, then settle the capture on it.
  const waitForPrediction = "for (let i = 0; i < 120 && !document.querySelector('.vua-line__prediction'); i++) await new Promise(resolve => setTimeout(resolve, 100));"
    + "document.querySelector('.vua-line__prediction')?.scrollIntoView({block:'center'});";
  const scroll = id === "workshop-prediction" ? { settleMs: 900, steps: [waitForPrediction] } : {};
  return { id, fixture: "factory", area: factoryArea(id), exemptRules: ONE_ACCENT_EXEMPT.has(id) ? ["one-accent"] : [],
    ...(review ? { steps: [`await (${verifyGridFactoryState.toString()})(${JSON.stringify(id)})`] } : {}), ...scroll };
}

export const VIEWS = [
  ...FACTORY_VIEWS.map(factoryView),

  // Material library (warehouse) fixture states.
  // These fixtures mount their UI inside run(); run() leaves the wanted state on screen.
  { id: "library-wall", fixture: "library-navigation", area: "library", steps: ["await window.libraryNavigationReview.run()"], settleMs: 600 },
  { id: "library-picker", fixture: "library-navigation", area: "library", steps: ["await window.libraryNavigationReview.run()", "await window.libraryNavigationReview.showPicker()"], settleMs: 600 },
  { id: "library-bulk", fixture: "library-bulk", area: "library", steps: ["await window.libraryBulkReview.run()", "await window.libraryBulkReview.showLibrary()"], settleMs: 600 },
  { id: "library-corners", fixture: "library-corners", area: "library", steps: ["await window.libraryBulkReview.run()"], settleMs: 600 },
  { id: "library-entries", fixture: "library-entries", area: "library", steps: ["await window.n5EntriesReview.run()"], settleMs: 600 },
  { id: "library-maintenance", fixture: "library-maintenance", area: "library", steps: ["await window.n5MaintenanceReview.run()"], settleMs: 600 },
  { id: "library-adaptations", fixture: "library-navigation", area: "library", steps: ["await window.libraryNavigationReview.run()", "await window.libraryNavigationReview.showAdaptations()"], settleMs: 600 },

  { id: "migration-plan", fixture: "migration-planner", area: "library", steps: [
    "for (let i = 0; i < 60 && !document.querySelector('[data-nav-id]'); i++) await new Promise(resolve => setTimeout(resolve, 100))",
    "[...document.querySelectorAll('[data-nav-id]')].find(el => el.dataset.navId === 'migration-material-Meiyun Coat')?.click()",
    "await new Promise(resolve => setTimeout(resolve, 500))",
    "[...document.querySelectorAll('[data-nav-id]')].find(el => el.dataset.navId === 'migration-material-Meiyun Hat')?.click()",
    "await new Promise(resolve => setTimeout(resolve, 500))",
    "for (const name of ['README.txt', 'LICENSE.txt', 'extra-poses.unitypackage']) [...document.querySelectorAll('[data-nav-id]')].find(el => el.dataset.navId === 'migration-exclude-file-' + name)?.click()",
  ], settleMs: 900 },

  // Whole-shell App states via first-run-review. The fixture renders the real
  // App only inside mount() (internal), so states are driven through its
  // exported previewEnvironment()/run() end states.
  { id: "first-run-home", fixture: "first-run", area: "first-run",
    steps: ["await window.firstRunReview.previewEnvironment(\"play\")", "document.querySelector('[data-nav-id=\"logo-home\"]').click()"], settleMs: 600 },
  { id: "first-run-settings", fixture: "first-run", area: "settings", steps: ["await window.firstRunReview.previewSettings()"], settleMs: 600 },
  { id: "first-use-notice", fixture: "first-run", area: "first-run", steps: ["await window.firstRunReview.previewFirstUse()"], settleMs: 600 },
  { id: "beginner-wizard", fixture: "first-run", area: "first-run", steps: ["await window.firstRunReview.previewBeginner()"], settleMs: 600 },
  { id: "env-play", fixture: "first-run", area: "environment", steps: ['await window.firstRunReview.previewEnvironment("play")'], settleMs: 600 },
  { id: "env-create", fixture: "first-run", area: "environment", steps: ['await window.firstRunReview.previewEnvironment("create")'], settleMs: 600 },
  { id: "env-create-standard", fixture: "first-run", area: "environment", steps: ['await window.firstRunReview.previewEnvironment("create", "standard")'], settleMs: 600 },
  { id: "tools-hub", fixture: "first-run", area: "tools", steps: ["await window.firstRunReview.previewTools()"], settleMs: 600 },
  { id: "help-diagnostics", fixture: "first-run", area: "help-diagnostics", steps: ["await window.firstRunReview.previewDiagnostics()"], settleMs: 600 },
  { id: "command-palette-open", fixture: "first-run", area: "command-palette", steps: ["await window.firstRunReview.previewCommandPalette()"], settleMs: 600 },

  // Focused panels and dialogs.
  { id: "deployment-check", fixture: "deployment-check", area: "first-run-deployment", steps: ["await window.deploymentReview.run()"], settleMs: 600 },
  { id: "network-check", fixture: "network-check", area: "environment", steps: ["await window.networkReview.run()"], settleMs: 600 },
  { id: "import-dialog", fixture: "import-dialog", area: "import-dialog", steps: ["await window.importDialog.run()", "window.__setImportOpen(true)"], settleMs: 600 },
  { id: "resource-monitor", fixture: "resource-monitor", area: "resource-monitor",
    steps: ["await window.resourceMonitorSmoke.base()", "document.querySelector('[data-nav-id=\"system-resources\"]').click()"], settleMs: 600 },
  { id: "task-window", fixture: "task-window", area: "task-window", steps: ["await window.taskWindowReview.run()"] },
  { id: "ai-preparation", fixture: "ai-preparation", area: "ai-preparation", steps: ["await window.agentUiReview.previewPreparation()"] },
];

export const AREAS = [...new Set(VIEWS.map(v => v.area))].sort();

/** Overflow locales use the family's first supported mode; Grid/Aero use dark, light-only presets use light. */
export const OVERFLOW_LOCALES = ["en", "ja", "ko", "zh-TW"];
export const DEFAULT_LOCALE = "zh-CN";
export const THEMES = ["dark", "light"];
