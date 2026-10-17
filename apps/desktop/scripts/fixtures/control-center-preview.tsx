// Synthetic control center data for visual review: saved Recipes, work projects, Unity projects, packages and repositories.
import React from "react";
import type { AmfRecipeDocument } from "@vua/contracts";
import type { AmfProductionPort, PackagesPort, PackagesView, ProjectOpsPort, RepoCatalogRepoRowV01, VuaGateway } from "../../src/renderer/gateway/index.ts";
import { AmfRoom } from "../../src/renderer/features/amf/AmfRoom.tsx";
import { ControlRecipesPage } from "../../src/renderer/features/amf/ControlRecipesPage.tsx";
import { ControlPackagesPage, type Screen } from "../../src/renderer/features/amf/ControlPackagesPage.tsx";
import { materialNodeId, packageNodeId, recipeNodeId } from "../../src/renderer/features/amf/control-graph-model.ts";

const hex = (seed: number) => seed.toString(16).padStart(4, "0").repeat(16);
const material = (seed: number, packageName: string) => ({ id: `m-${hex(seed)}`, packageName, sha256: hex(seed) });
const avatars = { meiyun: material(1, "Meiyun_v2.1.0.unitypackage"), shinano: material(2, "Shinano_v1.3.1.unitypackage"), manuka: material(3, "Manuka_v1.02.unitypackage") };
const outfits = {
  tshirt: material(11, "TshirtShorts_Meiyun_v1.00.unitypackage"), costume: material(12, "Meiyun_Costume4.unitypackage"), sailor: material(13, "Shinano_Sailor_v2.0.unitypackage"),
  hoodie: material(14, "Oversized_Hoodie_v1.4.unitypackage"), maid: material(15, "Manuka_Maid_v1.1.unitypackage"), cap: material(16, "Universal_Cap_v3.0.2.unitypackage"),
  boots: material(17, "Lace_Boots_v1.2.unitypackage"),
};
const lilToon = material(21, "lilToon_1.8.5.unitypackage");
const recipe = (recipeId: string, title: string, avatar: typeof lilToon, wear: readonly (typeof lilToon)[], packages: Record<string, string> = {}, extra: readonly (typeof lilToon)[] = [lilToon]): AmfRecipeDocument => ({
  formatVersion: "0.4", recipeId, title, editorVersion: "2022.3.22f1",
  materials: [avatar, ...wear, ...extra], avatar: { materialId: avatar.id, prefabPath: `Assets/${avatar.packageName.split("_")[0]}/${avatar.packageName.split("_")[0]}.prefab` },
  outfits: wear.map((item, i) => ({ materialId: item.id, prefabPath: `Assets/Outfits/${item.packageName.replace(/\.unitypackage$/u, "")}.prefab`, mode: i === 2 ? "attach_to_bone" as const : "merge_armature" as const,
    bone: i === 2 ? "Head" : "", toggleName: item.packageName.split("_")[0]!, active: i === 0 })),
  packages: { "com.vrchat.avatars": "3.7.4", "nadena.dev.modular-avatar": "1.10.3", "nadena.dev.ndmf": "1.6.0", ...packages },
});
const recipes: AmfRecipeDocument[] = [
  recipe("summer-meiyun", "Summer Meiyun", avatars.meiyun, [outfits.tshirt, outfits.boots], { "jp.lilxyzw.liltoon": "1.8.5" }),
  recipe("stage-meiyun", "Stage Meiyun", avatars.meiyun, [outfits.costume, outfits.boots, outfits.cap], { "nadena.dev.modular-avatar": "1.11.0", "jp.lilxyzw.liltoon": "1.8.5" }),
  recipe("meiyun-hoodie", "Meiyun hoodie day", avatars.meiyun, [outfits.hoodie, outfits.cap]),
  recipe("shinano-sailor", "Shinano sailor", avatars.shinano, [outfits.sailor], { "jp.lilxyzw.liltoon": "1.8.5" }),
  recipe("shinano-hoodie", "Shinano hoodie and cap", avatars.shinano, [outfits.hoodie, outfits.boots, outfits.cap], { "com.vrchat.avatars": "3.7.6" }),
  recipe("manuka-maid", "Manuka maid", avatars.manuka, [outfits.maid], {}, []),
];
/** About a hundred nodes: the design standard's Recipe graph budget. */
function manyRecipes(): AmfRecipeDocument[] {
  const bases = Array.from({ length: 8 }, (_, i) => material(100 + i, `Avatar${String.fromCharCode(65 + i)}_v1.0.unitypackage`));
  const wear = Array.from({ length: 58 }, (_, i) => material(200 + i, `Outfit_${i + 1}_v1.0.unitypackage`));
  return Array.from({ length: 28 }, (_, i) => recipe(`r${i}`, `Recipe ${i + 1}`, bases[i % 8]!, [wear[(i * 2) % 58]!, wear[(i * 2 + 1) % 58]!, wear[(i * 5 + 3) % 58]!], i % 3 === 0 ? { "jp.lilxyzw.liltoon": "1.8.5" } : {}));
}

const projectRoot = (runId: string) => `C:\\Users\\Player\\AppData\\Roaming\\VUA\\amf\\production\\projects\\${runId}`;
const catalog: RepoCatalogRepoRowV01[] = [
  { repoId: "com.vrchat.repos.official", name: "Official", cached: true, packages: [
    { packageId: "com.vrchat.avatars", displayName: "VRChat SDK - Avatars", description: "Build and upload Avatars", latestVersion: "3.7.6", versionCount: 42 },
    { packageId: "com.vrchat.base", displayName: "VRChat SDK - Base", description: "Shared SDK parts", latestVersion: "3.7.6", versionCount: 42 },
    { packageId: "com.vrchat.worlds", displayName: "VRChat SDK - Worlds", description: "Build and upload worlds", latestVersion: "3.7.6", versionCount: 42 },
  ] },
  { repoId: "com.vrchat.repos.curated", name: "Curated", cached: true, packages: [
    { packageId: "com.vrchat.clientsim", displayName: "ClientSim", description: "Test worlds in the Editor", latestVersion: "1.2.6", versionCount: 12 },
    { packageId: "com.llealloo.audiolink", displayName: "AudioLink", description: "Audio reactive shaders and effects", latestVersion: "2.0.0", versionCount: 20 },
  ] },
  { repoId: "nadena.dev.vpm-repos", name: "bd_", cached: true, packages: [
    { packageId: "nadena.dev.modular-avatar", displayName: "Modular Avatar", description: "Non-destructive Avatar assembly", latestVersion: "1.11.0", versionCount: 80 },
    { packageId: "nadena.dev.ndmf", displayName: "Non-Destructive Modular Framework", description: null, latestVersion: "1.6.0", versionCount: 40 },
  ] },
  { repoId: "jp.lilxyzw.vpm-repos", name: "lilxyzw", cached: true, packages: [
    { packageId: "jp.lilxyzw.liltoon", displayName: "lilToon", description: "Toon shader for Avatars", latestVersion: "1.8.5", versionCount: 55 },
    { packageId: "jp.lilxyzw.lilycalinventory", displayName: "lilycalInventory", description: "Menu and inventory builder", latestVersion: "1.2.0", versionCount: 9 },
  ] },
];
const installed = (path: string) => path.endsWith("finished") ? [
  { packageId: "com.vrchat.base", version: "3.7.4", dependencies: [], latestVersion: "3.7.6", updateAvailable: true },
  { packageId: "com.vrchat.avatars", version: "3.7.4", dependencies: ["com.vrchat.base"], latestVersion: "3.7.6", updateAvailable: true },
  { packageId: "nadena.dev.modular-avatar", version: "1.10.3", dependencies: ["nadena.dev.ndmf"], latestVersion: "1.11.0", updateAvailable: true },
  { packageId: "nadena.dev.ndmf", version: "1.6.0", dependencies: [], latestVersion: "1.6.0", updateAvailable: false },
  { packageId: "jp.lilxyzw.liltoon", version: "1.8.5", dependencies: [], latestVersion: "1.8.5", updateAvailable: false },
] : [{ packageId: "com.vrchat.base", version: "3.7.6", dependencies: [], latestVersion: "3.7.6", updateAvailable: false }];
const versions = (latest: string) => {
  const [major, minor, patch] = latest.split(".").map(Number) as [number, number, number];
  return [{ version: `${major}.${minor + 1}.0-beta.2`, yanked: false, compatible: true }, ...Array.from({ length: 6 }, (_, i) => ({ version: `${major}.${minor}.${Math.max(0, patch - i)}`, yanked: i === 3, compatible: true })),
    { version: `${Math.max(0, major - 1)}.9.0`, yanked: false, compatible: false }].filter((row, i, all) => all.findIndex(other => other.version === row.version) === i);
};
const packagesView: PackagesView = {
  schemaVersion: 1, kind: "ready-p2", projectPath: null, installedPackages: [],
  blocks: { installed: true, repos: true, catalog: true, changes: true, installs: true, registers: true, repoWrites: true, creates: true, repoCatalog: true, templates: true, repoLifecycle: true },
  reposWordFace: "vua.packages-repos/v0.2",
  repos: [
    { repoId: "com.vrchat.repos.official", name: "Official", url: "https://packages.vrchat.com/official", localPath: null, cached: true, enabled: true },
    { repoId: "com.vrchat.repos.curated", name: "Curated", url: "https://packages.vrchat.com/curated", localPath: null, cached: true, enabled: true },
    { repoId: "nadena.dev.vpm-repos", name: "bd_", url: "https://vpm.nadena.dev/vpm.json", localPath: null, cached: true, enabled: true },
    { repoId: "jp.lilxyzw.vpm-repos", name: "lilxyzw", url: "https://lilxyzw.github.io/vpm-repos/vpm.json", localPath: null, cached: true, enabled: true },
    { repoId: "com.example.tools", name: "Example tools", url: "https://tools.example.com/vpm.json", localPath: null, cached: false, enabled: false },
  ],
};
const unavailable = () => Promise.resolve({ kind: "unavailable" } as const);
const packagesPort = {
  snapshot: async () => packagesView, subscribe: () => () => {}, selectProject: async () => packagesView,
  listInstalled: async (path: string) => ({ kind: "ok", result: { family: "vua.packages-installed/v0.2", rows: installed(path), cacheSourced: false } }),
  packageCatalog: async (path: string, packageId: string) => ({ kind: "ok", result: { projectPath: path, packageId, displayName: null, source: "repo", installed: true, updateAvailable: null, cacheSourced: false,
    versions: versions(installed(path).find(row => row.packageId === packageId)?.latestVersion ?? "1.0.0") } }),
  repoCatalog: async () => ({ kind: "ok", result: { repos: catalog, cacheSourced: false } }),
  listTemplates: unavailable, addProject: unavailable, importLocalPackage: unavailable, previewChanges: unavailable, applyChanges: unavailable,
  previewRemove: unavailable, applyRemove: unavailable, previewInstall: unavailable, applyInstall: unavailable, registerLocalPackage: unavailable,
  addRemoteRepo: unavailable, addLocalRepo: unavailable, removeRepo: unavailable, createProject: unavailable, enableRepo: unavailable, disableRepo: unavailable, refreshRepo: unavailable,
  capability: async () => ({ state: "ready" }),
} as unknown as PackagesPort;
const projectOps = (base: ProjectOpsPort): ProjectOpsPort => ({ ...base, listProjects: async () => ({ ok: true, unreadable: 0, projects: [
  { path: projectRoot("finished"), name: "finished", pathPresent: true, unityVersion: "2022.3.22f1" },
  { path: "D:\\Unity\\Shinano Photo World", name: "Shinano Photo World", pathPresent: true, unityVersion: "2022.3.22f1" },
  { path: "D:\\Unity\\Manuka Test", name: "Manuka Test", pathPresent: true, unityVersion: "2022.3.22f1" },
  { path: "E:\\Old\\Avatar 2021", name: "Avatar 2021", pathPresent: false, unityVersion: "2019.4.31f1" },
] }) });

/** Gateway parts and the page for a `control-…` view. */
export function controlPreview(view: string, base: VuaGateway, production: AmfProductionPort): { gateway: VuaGateway; page: React.ReactElement } {
  const saved = view === "control-recipes-many" ? manyRecipes() : view === "control-recipes-empty" ? [] : recipes;
  const amfProduction = {
    ...production,
    async listRecipes() { return saved.map(item => ({ recipeId: item.recipeId, title: item.title, revision: 3, updatedAt: "2026-10-16T09:30:00Z" })); },
    async getRecipe(recipeId: string) { return { recipe: saved.find(item => item.recipeId === recipeId)!, revision: 3, updatedAt: "2026-10-16T09:30:00Z" }; },
    async get(runId: string) { return { ...(await production.get(runId)), projectRoot: projectRoot(runId) }; },
  } as AmfProductionPort;
  // The package view loads once the AMF module reports ready.
  const amfModule = { ...base.amfModule, snapshot: async () => ({ schemaVersion: "0.1" as const, moduleId: "amf" as const, installed: true, state: "ready" as const }) };
  const gateway = { ...base, amfModule, amfProduction, packages: packagesPort, projectOps: projectOps(base.projectOps) };
  try { localStorage.setItem("vua-amf-control-recipes-view-v01", view === "control-recipes-list" ? "list" : "graph"); } catch { /* preview only */ }
  // Resource-saving mode: the graph draws its settled layout without a frame loop.
  if (view === "control-recipes-still") document.documentElement.dataset.effects = "off";
  const selected = view === "control-recipes-selected" ? recipeNodeId("stage-meiyun") : view === "control-recipes-part" ? packageNodeId("nadena.dev.modular-avatar")
    : view === "control-recipes-list" ? materialNodeId(outfits.cap.id) : null;
  const screen: Screen = view === "control-packages-project" ? { kind: "project", key: "work:finished" } : view === "control-packages-unlisted" ? { kind: "project", key: "work:waiting" }
    : view === "control-packages-repos" ? { kind: "repos" } : { kind: "projects" };
  const page = view.startsWith("control-packages")
    ? <AmfRoom page="packages" navigate={() => {}}><ControlPackagesPage onNavigate={() => {}} initialScreen={screen}/></AmfRoom>
    : <AmfRoom page="recipe" navigate={() => {}}><ControlRecipesPage onNavigate={() => {}} initialSelected={selected}/></AmfRoom>;
  return { gateway, page };
}
