// Synthetic preview of the AMF base map and workshop for visual review; no production claims.
import React from "react";
import { createRoot } from "react-dom/client";
import { GatewayProvider } from "../../src/renderer/gateway/GatewayProvider.tsx";
import { emptyGateway } from "../../src/renderer/gateway/empty-gateway.ts";
import { FactoryMap, type Room } from "../../src/renderer/features/amf/FactoryMap.tsx";
import { AmfRoom } from "../../src/renderer/features/amf/AmfRoom.tsx";
import { AmfProductionPage } from "../../src/renderer/features/amf/AmfProductionPage.tsx";
import { controlPreview } from "./control-center-preview.tsx";
import type { AmfProductionPort, AmfProductionRun } from "../../src/renderer/gateway/index.ts";
import { ReleasePreview, releasePorts, vrchatPreviewPort } from "./release-preview.tsx";
import { VrchatSignInSection } from "../../src/renderer/features/settings/vrchat-sign-in.tsx";
import { Card } from "../../src/renderer/components/primitives/Card.tsx";
import "@vua/design-system/tokens.css";
import "@vua/design-system/base.css";
import "../../src/renderer/app-shell.css";
import "../../src/renderer/features/settings/settings.css";

const view = location.hash.slice(1) || "map";
const sources = [
  { sourceId: "avatar", itemId: "a", itemName: "Meiyun_v2.1.0.zip", name: "Meiyun_v2.1.0/Meiyun.unitypackage" },
  { sourceId: "outfit", itemId: "b", itemName: "TshirtShorts_Meiyun_v1.00.zip", name: "TshirtShorts_Meiyun_v1.00.unitypackage" },
  { sourceId: "costume", itemId: "c", itemName: "Meiyun_Costume4_v1.0.0.zip", name: "Meiyun_Costume4.unitypackage" },
];
const base = (runId: string, phase: AmfProductionRun["phase"], steps: [string, string, string?][], outfit = "outfit"): AmfProductionRun => ({
  schemaVersion: "0.1", runId, phase, taskId: "task-" + runId, editor: { path: "C:/Unity/Unity.exe", version: "2022.3.22f1" }, projectRoot: "C:/work/" + runId,
  choices: [], sources: [sources[0]!, sources.find(s => s.sourceId === outfit)!].map(s => ({ ...s, role: s.sourceId === "avatar" ? "avatar" as const : "outfit" as const, sha256: "a".repeat(64) })),
  prefabs: [{ sourceId: "avatar", path: "Assets/Meiyun/Meiyu_改変.prefab", name: "Meiyu_改変", isAvatar: true, hasSkinnedMesh: true, hasMergeArmature: false, hasMissingScripts: false, humanoidBones: ["Head"] },
    { sourceId: outfit, path: "Assets/Outfit/Outfit.prefab", name: outfit === "outfit" ? "TshirtShorts_Meiyun" : "Meiyun_Costume4", isAvatar: false, hasSkinnedMesh: true, hasMergeArmature: true, hasMissingScripts: false, humanoidBones: [] }],
  steps: steps.map(([key, state, detail]) => ({ key, name: key, state, detail: detail ?? "" })), selection: null, error: null, recovery: null, result: null, snapshotId: null,
});
const runs: Record<string, AmfProductionRun> = {
  running: { ...base("running", "preparing", [["project", "succeeded"], ["materials", "succeeded"], ["inspect", "running"]], "costume"),
    progress: { step: "inspect", name: "Read actual prefabs", startedAt: new Date(Date.now() - 161_000).toISOString(), elapsedSeconds: 161, usualSeconds: 310,
      unity: { stage: "importing", current: 123, total: 379, lastActivityAt: new Date().toISOString() } } } as AmfProductionRun,
  waiting: base("waiting", "ready", [["project", "succeeded"], ["materials", "succeeded"], ["inspect", "succeeded"]]),
  attention: { ...base("attention", "failed", [["project", "succeeded"], ["materials", "succeeded"], ["inspect", "failed", "Unity could not get a license."]]), error: "vua.amf_production.unity_license_unavailable — detail: Activate this Editor's license in Unity Hub, then retry preparation. Selected materials are retained." },
  finished: { ...base("finished", "succeeded", [["project", "succeeded"], ["materials", "succeeded"], ["inspect", "succeeded"], ["snapshot", "succeeded"], ["assembly", "succeeded"]]),
    result: { facts: { sdkDescriptorRecognized: true, missingReferences: 0, avatarName: "Meiyu_改変", instances: [{ sourceId: "outfit", bindingVerified: true, menuVerified: true, menuModified: true }], missingShaderMaterials: [], sdkSignedIn: "no" } } },
};
const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const api = {
  async list() { return { sources, editors: [{ path: "C:/Unity/Unity.exe", version: "2022.3.22f1" }], busy: true,
    runs: Object.values(runs).map(run => ({ runId: run.runId, phase: run.phase, sourceNames: run.sources.map(s => s.itemName) })) }; },
  async get(runId: string) { return structuredClone(runs[runId]!); },
  async listRecipes() { return [1, 2, 3].map(i => ({ recipeId: "r" + i, title: "Recipe " + i, revision: 1, updatedAt: "2026-10-17T00:00:00Z" })); },
  async previewImage() { return pixel; },
} as unknown as AmfProductionPort;
const gateway = emptyGateway(null);
const selected = view.startsWith("workshop-") ? view.slice("workshop-".length) : "";
try { localStorage.setItem("vua-amf-production-run-v01", selected); localStorage.setItem("vua-amf-automation-level-v01", view.endsWith("auto") ? "auto" : "semi"); } catch { /* preview only */ }
const runOf = selected.replace(/-auto$/u, "");
try { localStorage.setItem("vua-amf-production-run-v01", runOf); } catch { /* preview only */ }
const control = view.startsWith("control-") ? controlPreview(view, { ...gateway, amfProduction: api }, api) : null;
const release = view.startsWith("release-") ? releasePorts(view) : null;
const signedIn = view === "release-check" || view === "release-uploaded";
const vrchatOfRelease = signedIn ? vrchatPreviewPort({ enabled: true, state: "signed_in", account: null, rememberPassword: false, pendingMethods: [], canCheckUploads: true }) : undefined;
const settingsVrchat = view.startsWith("settings-vrchat")
  ? vrchatPreviewPort(view === "settings-vrchat-account"
    ? { enabled: true, state: "signed_in", account: { displayName: "Aran", thumbnail: pixel }, rememberPassword: true, pendingMethods: [], canCheckUploads: true }
    : { enabled: true, state: "signed_out", account: null, rememberPassword: false, pendingMethods: [], canCheckUploads: false })
  : undefined;
createRoot(document.getElementById("root")!).render(release ? <GatewayProvider gateway={{ ...gateway, amfProduction: release.production, amfRelease: release.release, ...(vrchatOfRelease ? { vrchat: vrchatOfRelease } : {}) }}>
  <ReleasePreview view={view} />
</GatewayProvider> : view.startsWith("settings-") ? <GatewayProvider gateway={{ ...gateway, ...(settingsVrchat ? { vrchat: settingsVrchat } : {}) }}>
  <div className="vua-page" style={{ maxWidth: 760 }}>
    <section className="vua-page__hero"><h1 className="vua-title">设置 · 实验性</h1></section>
    <Card><VrchatSignInSection /></Card>
  </div>
</GatewayProvider> : <GatewayProvider gateway={control?.gateway ?? { ...gateway, amfProduction: api }}>
  {control ? control.page : view.startsWith("map") ? <FactoryMap navigate={() => {}} initialRoom={(view === "map-flight" ? null : view.slice(4) || null) as Room | null} /> : <AmfRoom page="workshop" navigate={() => {}}><AmfProductionPage onNavigate={() => {}} onPrepareEnv={() => {}} /></AmfRoom>}
</GatewayProvider>);

// Mid-flight frame: the capture runs 2.5 s after load; the camera move takes 0.65 s.
if (view === "map-flight") setTimeout(() => document.querySelector<HTMLElement>("[data-nav-id=door-workshop], [data-nav-id=room-workshop]")?.click(), 2200);
