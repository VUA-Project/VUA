import { describe, expect, it } from "vitest";
import type { RepoCatalogRepoRowV01 } from "../../gateway/index.ts";
import { controlProjects, defaultSelectedRepos, filterProjects, installRequest, lineName, packageRows, repoRows, samePath, updateAllRequest, versionChoices, type WorkProjectFacts } from "./control-packages-model.ts";

const work: WorkProjectFacts[] = [
  { runId: "run-2", phase: "ready", sourceNames: ["Meiyun_v2.1.0.zip", "TshirtShorts_Meiyun_v1.00.zip", "Meiyun_v2.1.0.zip"], projectRoot: "C:\\VUA\\production\\projects\\run-2", editorVersion: "2022.3.22f1" },
  { runId: "run-1", phase: "succeeded", sourceNames: [], projectRoot: "C:\\VUA\\production\\projects\\run-1", editorVersion: null },
  { runId: "run-0", phase: "failed", sourceNames: ["Lost.zip"], projectRoot: "", editorVersion: null },
];
const registered = [
  { path: "c:/vua/production/projects/run-1/", name: "run-1", pathPresent: true, unityVersion: "2022.3.22f1" },
  { path: "D:\\Unity\\Zeta World", name: "Zeta World", pathPresent: true, unityVersion: "2022.3.22f1" },
  { path: "D:\\Unity\\Alpha Avatar", name: "Alpha Avatar", pathPresent: false, unityVersion: null },
];

describe("projects list", () => {
  it("lists work projects first, then the other Unity projects by name", () => {
    const projects = controlProjects(work, registered);
    expect(projects.map(project => [project.kind, project.name])).toEqual([
      ["work", "Meiyun_v2.1.0 + TshirtShorts_Meiyun_v1.00"], ["work", "run-1"], ["unity", "Alpha Avatar"], ["unity", "Zeta World"],
    ]);
  });

  it("marks which work projects the package backend can read and uses the listed path", () => {
    const [unlisted, listed] = controlProjects(work, registered);
    expect(unlisted).toMatchObject({ runId: "run-2", listed: false, present: true, path: "C:\\VUA\\production\\projects\\run-2", unityVersion: "2022.3.22f1", phase: "ready" });
    expect(listed).toMatchObject({ runId: "run-1", listed: true, path: "c:/vua/production/projects/run-1/", unityVersion: "2022.3.22f1" });
  });

  it("keeps a missing Unity project visible and lists only work projects without the registry", () => {
    expect(controlProjects([], registered).find(project => project.name === "Alpha Avatar")).toMatchObject({ present: false, listed: true });
    expect(controlProjects(work, null).map(project => project.listed)).toEqual([false, false]);
  });

  it("compares Windows paths by folder", () => {
    expect(samePath("C:\\A\\b\\", "c:/a/B")).toBe(true);
    expect(samePath("C:\\A\\b", "C:\\A\\bc")).toBe(false);
    expect(lineName(["A.zip", "a.ZIP", "B.zip"])).toBe("A + a + B");
  });

  it("searches projects by name and path", () => {
    const projects = controlProjects(work, registered);
    expect(filterProjects(projects, "zeta").map(project => project.name)).toEqual(["Zeta World"]);
    expect(filterProjects(projects, "projects\\run-2")).toHaveLength(1);
    expect(filterProjects(projects, "  ")).toHaveLength(4);
  });
});

const catalog: RepoCatalogRepoRowV01[] = [
  { repoId: "com.vrchat.repos.official", name: "Official", cached: true, packages: [
    { packageId: "com.vrchat.avatars", displayName: "VRChat SDK - Avatars", description: "Build avatars", latestVersion: "3.7.6", versionCount: 30 },
    { packageId: "com.vrchat.base", displayName: "VRChat SDK - Base", description: null, latestVersion: "3.7.6", versionCount: 30 },
    { packageId: "com.vrchat.worlds", displayName: "VRChat SDK - Worlds", description: null, latestVersion: "3.7.6", versionCount: 30 },
  ] },
  { repoId: "nadena.dev.vpm-repos", name: "bd_", cached: true, packages: [
    { packageId: "nadena.dev.modular-avatar", displayName: "Modular Avatar", description: "Non-destructive avatar assembly", latestVersion: "1.11.0", versionCount: 80 },
    { packageId: "nadena.dev.ndmf", displayName: "NDMF", description: null, latestVersion: "1.6.0", versionCount: 40 },
  ] },
  { repoId: "jp.lilxyzw.vpm-repos", name: "lilxyzw", cached: true, packages: [
    { packageId: "jp.lilxyzw.liltoon", displayName: "lilToon", description: null, latestVersion: "1.8.5", versionCount: 50 },
    { packageId: "com.vrchat.avatars", displayName: "Mirror of the SDK", description: null, latestVersion: "3.0.0", versionCount: 1 },
  ] },
];
const installed = [
  { packageId: "com.vrchat.base", version: "3.7.4", dependencies: [], latestVersion: "3.7.6", updateAvailable: true },
  { packageId: "com.vrchat.avatars", version: "3.7.4", dependencies: ["com.vrchat.base"], latestVersion: "3.7.6", updateAvailable: true },
  { packageId: "nadena.dev.modular-avatar", version: "1.11.0", dependencies: ["nadena.dev.ndmf"], latestVersion: "1.11.0", updateAvailable: false },
  { packageId: "nadena.dev.ndmf", version: "1.6.0", dependencies: [] },
];

describe("project packages", () => {
  const all = new Set(["com.vrchat.repos.official", "nadena.dev.vpm-repos", "jp.lilxyzw.vpm-repos"]);

  it("shows installed packages with the backend's latest version and update answer", () => {
    const rows = packageRows({ installed, catalog, selectedRepos: all, query: "" });
    expect(rows.installed.map(row => [row.displayName, row.installedVersion, row.latestVersion, row.updateAvailable])).toEqual([
      ["Modular Avatar", "1.11.0", "1.11.0", false], ["NDMF", "1.6.0", "1.6.0", null],
      ["VRChat SDK - Avatars", "3.7.4", "3.7.6", true], ["VRChat SDK - Base", "3.7.4", "3.7.6", true],
    ]);
    expect(rows.installed.find(row => row.packageId === "com.vrchat.base")?.requiredBy).toEqual(["com.vrchat.avatars"]);
    expect(rows.installed.find(row => row.packageId === "nadena.dev.ndmf")?.requiredBy).toEqual(["nadena.dev.modular-avatar"]);
  });

  it("offers the packages of the selected repositories that are not installed", () => {
    expect(packageRows({ installed, catalog, selectedRepos: all, query: "" }).available.map(row => [row.packageId, row.repoName]))
      .toEqual([["jp.lilxyzw.liltoon", "lilxyzw"], ["com.vrchat.worlds", "Official"]]);
    expect(packageRows({ installed, catalog, selectedRepos: new Set(["nadena.dev.vpm-repos"]), query: "" }).available).toEqual([]);
  });

  it("takes a package's name from the first selected repository that offers it", () => {
    const onlyMirror = packageRows({ installed: [], catalog, selectedRepos: new Set(["jp.lilxyzw.vpm-repos"]), query: "" });
    expect(onlyMirror.available.find(row => row.packageId === "com.vrchat.avatars")).toMatchObject({ displayName: "Mirror of the SDK", repoName: "lilxyzw" });
    const both = packageRows({ installed: [], catalog, selectedRepos: all, query: "" });
    expect(both.available.find(row => row.packageId === "com.vrchat.avatars")).toMatchObject({ displayName: "VRChat SDK - Avatars", repoName: "Official" });
  });

  it("searches name, id and description and works without a catalog", () => {
    expect(packageRows({ installed, catalog, selectedRepos: all, query: "non-destructive" }).installed.map(row => row.packageId)).toEqual(["nadena.dev.modular-avatar"]);
    const bare = packageRows({ installed: [{ packageId: "com.example.tool", version: "1.0.0", dependencies: [] }], catalog: null, selectedRepos: null, query: "" });
    expect(bare.installed[0]).toMatchObject({ displayName: "com.example.tool", latestVersion: null, updateAvailable: null });
    expect(bare.available).toEqual([]);
  });

  it("updates every package the backend marks, each to its latest stable version", () => {
    const rows = packageRows({ installed, catalog, selectedRepos: all, query: "" });
    expect(updateAllRequest(rows.installed)).toEqual([{ packageId: "com.vrchat.avatars", version: null }, { packageId: "com.vrchat.base", version: null }]);
    expect(installRequest("jp.lilxyzw.liltoon", "1.8.5")).toEqual([{ packageId: "jp.lilxyzw.liltoon", version: "1.8.5" }]);
  });
});

describe("versions", () => {
  const versions = [
    { version: "1.12.0-beta.1", yanked: false, compatible: true },
    { version: "1.11.0", yanked: false, compatible: true },
    { version: "1.10.9", yanked: true, compatible: true },
    { version: "1.10.3", yanked: false, compatible: null },
    { version: "0.9.0", yanked: false, compatible: false },
  ];
  it("puts compatible versions first and holds back withdrawn and pre-release ones", () => {
    const choices = versionChoices(versions, "1.11.0", false);
    expect(choices.compatible.map(choice => choice.version)).toEqual(["1.11.0", "1.10.3"]);
    expect(choices.other.map(choice => choice.version)).toEqual(["0.9.0"]);
    expect(choices.compatible[0]?.installed).toBe(true);
  });
  it("shows pre-releases on request and always keeps the installed version", () => {
    expect(versionChoices(versions, "1.10.9", true).compatible.map(choice => [choice.version, choice.yanked, choice.prerelease])).toEqual([
      ["1.12.0-beta.1", false, true], ["1.11.0", false, false], ["1.10.9", true, false], ["1.10.3", false, false],
    ]);
    expect(versionChoices(versions, "2.0.0-local", false).compatible[0]).toMatchObject({ version: "2.0.0-local", installed: true });
  });
});

describe("repositories", () => {
  const rows = repoRows([
    { repoId: "jp.lilxyzw.vpm-repos", name: "lilxyzw", url: "https://lilxyzw.github.io/vpm-repos/vpm.json", localPath: null, cached: true, enabled: false },
    { repoId: "com.vrchat.repos.curated", name: "Curated", url: "https://packages.vrchat.com/curated", localPath: null, cached: true, enabled: true },
    { repoId: "com.vrchat.repos.official", name: "Official", url: "https://packages.vrchat.com/official", localPath: null, cached: true, enabled: true },
    { repoId: "local.tools", name: "My tools", url: null, localPath: "D:\\Packages\\repo.json", cached: false, enabled: true },
    { repoId: "nadena.dev.vpm-repos", name: "bd_", url: "https://vpm.nadena.dev/vpm.json", localPath: null, cached: true, enabled: true },
  ], catalog);

  it("orders Official and Curated first and marks what can change", () => {
    expect(rows.map(row => [row.name, row.kind, row.removable, row.toggleable])).toEqual([
      ["Official", "official", false, false], ["Curated", "curated", false, true],
      ["bd_", "community", true, true], ["lilxyzw", "community", true, true], ["My tools", "local", true, true],
    ]);
    expect(rows.find(row => row.name === "bd_")?.packageCount).toBe(2);
    expect(rows.find(row => row.name === "My tools")?.packageCount).toBeNull();
  });

  it("starts the project page with the repositories in use", () => {
    expect([...defaultSelectedRepos(rows)]).toEqual(["com.vrchat.repos.official", "com.vrchat.repos.curated", "nadena.dev.vpm-repos", "local.tools"]);
  });

  it("reads the earlier repository rows without an enabled state", () => {
    const [row] = repoRows([{ repoId: "x.y", name: null, url: "https://x.example/index.json", localPath: null, cached: false }], null);
    expect(row).toMatchObject({ name: "x.y", enabled: null, toggleable: false, removable: true, packageCount: null });
  });
});
