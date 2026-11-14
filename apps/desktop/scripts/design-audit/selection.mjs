// Which views a partial run covers: those a change can reach, or one share of the whole set.

const RENDERER = "apps/desktop/src/renderer/";

// A change here can reach every view.
const SHARED = [
  /^packages\/design-system\//,
  /^apps\/desktop\/scripts\/design-audit/,
  /^apps\/desktop\/scripts\/fixtures\/factory-preview/,
  /^apps\/desktop\/src\/renderer\/(App\.tsx|app-shell\.css|main\.tsx)/,
  /^apps\/desktop\/src\/renderer\/(app|components|gateway)\//,
  /^apps\/desktop\/src\/renderer\/i18n\/(strings\.|index|journey-copy|structure-copy)/,
];

// First match wins, so narrower folders come first.
const AREAS = [
  [/features\/amf\/release\/|i18n\/release-room-copy/, ["release-room"]],
  [/features\/amf\/(Control|control-)|i18n\/control-center-copy/, ["control-center"]],
  [/features\/amf\/MaterialsStart|features\/amf\/materials-start/, ["materials-start"]],
  [/features\/amf\/|features\/workshop\/|i18n\/factory-copy/, ["workshop", "control-center", "release-room", "materials-start"]],
  [/features\/warehouse\/|i18n\/(library-view-copy|booth-category-copy)/, ["library", "terms"]],
  [/features\/import\//, ["library", "import-dialog"]],
  [/features\/(home|deployer)\/|i18n\/(play-flow-copy|planned-routes-copy|environment-copy)/, ["environment", "first-run", "first-run-deployment", "network-tiers"]],
  [/features\/help\/(LocalDiagnostics|local-diagnostics)|i18n\/local-diagnostics-copy/, ["help-diagnostics"]],
  [/features\/(help|guidance|tour|shell)\/|i18n\/(first-use-copy|context-guide-copy|help-copy)/, ["first-run", "help-diagnostics"]],
  [/features\/command-palette\//, ["command-palette"]],
  [/features\/tools\/|i18n\/pose-graph-copy/, ["tools"]],
  [/features\/settings\//, ["settings", "settings-licenses"]],
  [/features\/task-center\//, ["task-window"]],
  [/features\/resource/, ["resource-monitor"]],
];

/** Views a set of changed files can reach. A renderer file with no known home counts as shared. */
export function viewsForChanges(files, views) {
  const areas = new Set();
  for (const file of files.map(name => name.replaceAll("\\", "/"))) {
    if (SHARED.some(pattern => pattern.test(file))) return views;
    const area = AREAS.find(([pattern]) => pattern.test(file));
    if (area) { for (const name of area[1]) areas.add(name); continue; }
    if (file.startsWith(RENDERER) || file.startsWith("apps/desktop/scripts/fixtures/")) return views;
  }
  return views.filter(view => areas.has(view.area));
}

/** Parses "2/4" and returns that share of the views, in a stable order. */
export function shardViews(views, shard) {
  const match = /^(\d+)\/(\d+)$/u.exec(shard);
  if (!match) throw new Error(`Unknown shard: ${shard}`);
  const [index, count] = [Number(match[1]), Number(match[2])];
  if (count < 1 || index < 1 || index > count) throw new Error(`Unknown shard: ${shard}`);
  return views.filter((_, position) => position % count === index - 1);
}

/** The time a run may take: generous per state, so only a stuck run reaches it. */
export function runDeadlineMs(stateCount, minutes = 0) {
  return minutes > 0 ? minutes * 60_000 : stateCount * 90_000 + 300_000;
}
