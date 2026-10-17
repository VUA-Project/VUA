/**
 * Control center, packages: VCC's way of working on VUA's package backend. Projects come from the
 * workshop's work projects and the Unity projects VCC or ALCOM list; each project shows installed
 * packages with their versions next to what the selected repositories offer. Versions are compared
 * by the backend; this model only arranges its answers.
 */
import type { AmfRunPhase, CatalogVersionRowV01, InstalledPackageRowV01, InstalledPackageRowV02, PackagesPackageRequestV02, RegisteredProjectRow, RepoCatalogRepoRowV01, RepoInfoRowV01, RepoInfoRowV02 } from "../../gateway/index.ts";
import { looksPrerelease } from "../packages/packages-model.ts";
import { packageLabel } from "./control-graph-model.ts";

export type ProjectKind = "work" | "unity";
export interface ControlProject {
  readonly key: string;
  readonly kind: ProjectKind;
  readonly name: string;
  readonly path: string;
  readonly unityVersion: string | null;
  /** The production line that owns a work project. */
  readonly runId: string | null;
  readonly phase: AmfRunPhase | null;
  /** The package backend reads projects that VCC or ALCOM list. */
  readonly listed: boolean;
  readonly present: boolean;
}
export interface WorkProjectFacts {
  readonly runId: string; readonly phase: AmfRunPhase; readonly sourceNames: readonly string[];
  readonly projectRoot: string; readonly editorVersion: string | null;
}

/** Paths compare the way Windows does: either slash, any case, no trailing separator. */
export function samePath(a: string, b: string): boolean { return normalPath(a) === normalPath(b); }
function normalPath(path: string): string { return path.replace(/\\/gu, "/").replace(/\/+$/u, "").toLocaleLowerCase("en-US"); }

export function lineName(sourceNames: readonly string[]): string {
  return [...new Set(sourceNames.map(name => name.replace(/\.zip$/iu, "")))].join(" + ");
}

/** Work projects first in the workshop's order, then the other Unity projects by name. */
export function controlProjects(work: readonly WorkProjectFacts[], registered: readonly RegisteredProjectRow[] | null): ControlProject[] {
  const listedRows = registered ?? [];
  const workProjects = work.filter(item => item.projectRoot.length > 0).map((item): ControlProject => {
    const row = listedRows.find(project => samePath(project.path, item.projectRoot));
    return { key: `work:${item.runId}`, kind: "work", name: lineName(item.sourceNames) || item.runId, path: row?.path ?? item.projectRoot,
      unityVersion: item.editorVersion ?? row?.unityVersion ?? null, runId: item.runId, phase: item.phase, listed: row !== undefined, present: row?.pathPresent ?? true };
  });
  const others = listedRows.filter(row => !work.some(item => samePath(item.projectRoot, row.path)))
    .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
    .map((row): ControlProject => ({ key: `unity:${normalPath(row.path)}`, kind: "unity", name: row.name, path: row.path, unityVersion: row.unityVersion,
      runId: null, phase: null, listed: true, present: row.pathPresent }));
  return [...workProjects, ...others];
}

export function filterProjects(projects: readonly ControlProject[], query: string): readonly ControlProject[] {
  const q = query.trim().toLocaleLowerCase();
  return q === "" ? projects : projects.filter(project => `${project.name} ${project.path}`.toLocaleLowerCase().includes(q));
}

export type RepoKind = "official" | "curated" | "community" | "local";
export interface ControlRepo {
  readonly key: string;
  readonly repoId: string | null;
  readonly name: string;
  readonly url: string | null;
  readonly localPath: string | null;
  readonly kind: RepoKind;
  /** null when the backend does not report it. */
  readonly enabled: boolean | null;
  readonly cached: boolean;
  readonly packageCount: number | null;
  readonly removable: boolean;
  readonly toggleable: boolean;
}
const OFFICIAL = "com.vrchat.repos.official";
const CURATED = "com.vrchat.repos.curated";
const KIND_ORDER: readonly RepoKind[] = ["official", "curated", "community", "local"];

export function repoKey(row: { readonly repoId: string | null; readonly name: string | null; readonly url?: string | null; readonly localPath?: string | null }): string {
  return row.repoId ?? row.url ?? row.localPath ?? row.name ?? "";
}

/** VCC's repository list: Official and Curated first and always kept; community and local repositories after them. */
export function repoRows(repos: readonly (RepoInfoRowV01 | RepoInfoRowV02)[], catalog: readonly RepoCatalogRepoRowV01[] | null): ControlRepo[] {
  return repos.map((row): ControlRepo => {
    const kind: RepoKind = row.repoId === OFFICIAL ? "official" : row.repoId === CURATED ? "curated" : row.url === null && row.localPath !== null ? "local" : "community";
    const enabled = "enabled" in row ? row.enabled : null;
    const listing = catalog?.find(item => (item.repoId !== null && item.repoId === row.repoId) || (item.repoId === null && item.name !== null && item.name === row.name));
    return { key: repoKey(row), repoId: row.repoId, name: row.name ?? row.repoId ?? row.url ?? row.localPath ?? "", url: row.url, localPath: row.localPath, kind,
      enabled, cached: row.cached, packageCount: listing ? listing.packages.length : null,
      removable: row.repoId !== null && (kind === "community" || kind === "local"), toggleable: row.repoId !== null && enabled !== null && kind !== "official" };
  }).sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
}

/** The repositories a project page starts with: every repository the backend has not disabled. */
export function defaultSelectedRepos(repos: readonly ControlRepo[]): ReadonlySet<string> {
  return new Set(repos.filter(repo => repo.enabled !== false).map(repo => repo.key));
}

export interface ControlPackageRow {
  readonly packageId: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly installedVersion: string | null;
  readonly latestVersion: string | null;
  /** The backend's answer; null when it gives none. */
  readonly updateAvailable: boolean | null;
  readonly repoName: string | null;
  readonly dependencies: readonly string[];
  /** Installed packages that depend on this one. */
  readonly requiredBy: readonly string[];
}

export function packageRows(input: {
  readonly installed: readonly (InstalledPackageRowV01 | InstalledPackageRowV02)[];
  readonly catalog: readonly RepoCatalogRepoRowV01[] | null;
  readonly selectedRepos: ReadonlySet<string> | null;
  readonly query: string;
}): { installed: readonly ControlPackageRow[]; available: readonly ControlPackageRow[] } {
  const offered = new Map<string, { displayName: string | null; description: string | null; latestVersion: string | null; repoName: string | null; selected: boolean }>();
  for (const repo of input.catalog ?? []) {
    const selected = input.selectedRepos === null || input.selectedRepos.has(repoKey(repo));
    for (const item of repo.packages) {
      const known = offered.get(item.packageId);
      if (known && (known.selected || !selected)) continue;
      offered.set(item.packageId, { displayName: item.displayName, description: item.description, latestVersion: item.latestVersion, repoName: repo.name ?? repo.repoId, selected });
    }
  }
  const installedIds = new Set(input.installed.map(row => row.packageId));
  const q = input.query.trim().toLocaleLowerCase();
  const matches = (row: ControlPackageRow) => q === "" || `${row.displayName} ${row.packageId} ${row.description ?? ""}`.toLocaleLowerCase().includes(q);
  const byName = (a: ControlPackageRow, b: ControlPackageRow) => a.displayName.localeCompare(b.displayName) || a.packageId.localeCompare(b.packageId);
  const installed = input.installed.map((row): ControlPackageRow => {
    const offer = offered.get(row.packageId);
    const v02 = "latestVersion" in row ? row : null;
    return { packageId: row.packageId, displayName: offer?.displayName ?? packageLabel(row.packageId), description: offer?.description ?? null,
      installedVersion: row.version, latestVersion: v02?.latestVersion ?? offer?.latestVersion ?? null, updateAvailable: v02?.updateAvailable ?? null,
      repoName: offer?.repoName ?? null, dependencies: row.dependencies,
      requiredBy: input.installed.filter(other => other.packageId !== row.packageId && other.dependencies.includes(row.packageId)).map(other => other.packageId) };
  }).filter(matches).sort(byName);
  const available = [...offered].filter(([id, offer]) => offer.selected && !installedIds.has(id)).map(([packageId, offer]): ControlPackageRow => ({
    packageId, displayName: offer.displayName ?? packageLabel(packageId), description: offer.description, installedVersion: null, latestVersion: offer.latestVersion,
    updateAvailable: null, repoName: offer.repoName, dependencies: [], requiredBy: [],
  })).filter(matches).sort(byName);
  return { installed, available };
}

export interface VersionChoice { readonly version: string; readonly yanked: boolean; readonly prerelease: boolean; readonly installed: boolean }
/** Versions for a package's dropdown: compatible ones first, the rest under a divider; withdrawn and pre-release versions stay out unless installed or asked for. */
export function versionChoices(versions: readonly CatalogVersionRowV01[], installed: string | null, showPrerelease: boolean): { compatible: readonly VersionChoice[]; other: readonly VersionChoice[] } {
  const rows = versions.some(row => row.version === installed) || installed === null ? versions : [{ version: installed, yanked: false, compatible: true }, ...versions];
  const choices = rows.filter(row => row.version === installed || (!row.yanked && (showPrerelease || !looksPrerelease(row.version))))
    .map(row => ({ choice: { version: row.version, yanked: row.yanked, prerelease: looksPrerelease(row.version), installed: row.version === installed }, compatible: row.compatible }));
  return { compatible: choices.filter(item => item.compatible !== false).map(item => item.choice), other: choices.filter(item => item.compatible === false).map(item => item.choice) };
}

/** Install or change to a version; a null version lets the resolver pick the latest stable one. */
export function installRequest(packageId: string, version: string | null): readonly PackagesPackageRequestV02[] { return [{ packageId, version }]; }

/** "Update all": every installed package the backend reports an update for, each to its latest stable version. */
export function updateAllRequest(rows: readonly ControlPackageRow[]): readonly PackagesPackageRequestV02[] {
  return rows.filter(row => row.installedVersion !== null && row.updateAvailable === true).map(row => ({ packageId: row.packageId, version: null }));
}
