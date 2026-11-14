import assert from "node:assert/strict";
import test from "node:test";
import { runDeadlineMs, shardViews, viewsForChanges } from "./design-audit/selection.mjs";

const views = [
  { id: "library-wall", area: "library" }, { id: "terms-parsed", area: "terms" }, { id: "workshop-a", area: "workshop" },
  { id: "control-recipes", area: "control-center" }, { id: "release-a", area: "release-room" }, { id: "env-play", area: "environment" },
  { id: "help-diagnostics", area: "help-diagnostics" }, { id: "command-palette-open", area: "command-palette" },
];
const ids = list => list.map(view => view.id);

test("a feature file reaches its own views", () => {
  assert.deepEqual(ids(viewsForChanges(["apps/desktop/src/renderer/features/warehouse/WarehousePage.tsx"], views)), ["library-wall", "terms-parsed"]);
  assert.deepEqual(ids(viewsForChanges(["apps/desktop/src/renderer/features/amf/ControlRecipeGraph.tsx"], views)), ["control-recipes"]);
  assert.deepEqual(ids(viewsForChanges(["apps/desktop/src/renderer/features/amf/release/ReleaseSheet.tsx"], views)), ["release-a"]);
  assert.deepEqual(ids(viewsForChanges(["apps/desktop/src/renderer/features/help/LocalDiagnosticsPanel.tsx"], views)), ["help-diagnostics"]);
  assert.deepEqual(ids(viewsForChanges(["apps/desktop/src/renderer/features/command-palette/CommandPalette.tsx"], views)), ["command-palette-open"]);
});

test("shared styles and unknown renderer files reach every view", () => {
  assert.equal(viewsForChanges(["packages/design-system/src/base.css"], views), views);
  assert.equal(viewsForChanges(["apps/desktop/src/renderer/features/brand-new/Page.tsx"], views), views);
});

test("files outside the renderer reach nothing", () => {
  assert.deepEqual(viewsForChanges(["crates/acquisition/src/library_view.rs", "docs/north-star.md"], views), []);
});

test("Windows separators still match", () => {
  assert.deepEqual(ids(viewsForChanges(["apps\\desktop\\src\\renderer\\features\\home\\PlayPage.tsx"], views)), ["env-play"]);
});

test("shards split the views without overlap", () => {
  const shards = [1, 2, 3].map(index => ids(shardViews(views, `${index}/3`)));
  assert.deepEqual(shards.flat().sort(), ids(views).sort());
  assert.equal(new Set(shards.flat()).size, views.length);
  assert.throws(() => shardViews(views, "4/3"));
  assert.throws(() => shardViews(views, "soon"));
});

test("a run's limit grows with its states and can be set outright", () => {
  assert.equal(runDeadlineMs(10), 1_200_000);
  assert.equal(runDeadlineMs(10, 5), 300_000);
});
