/** Control center, packages: VCC's projects list, each project's packages and versions, and the repositories they come from. */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@vua/design-system";
import {
  useGateway, usePackagesView, type CatalogVersionRowV01, type InstalledPackageRowV01, type InstalledPackageRowV02, type PackagesInstallPlanV02,
  type PackagesInstallReceiptV02, type PackagesOpsRejectedV02, type PackagesPackageRequestV02, type PackagesRemovePlanV01, type PackagesRemoveReceiptV01,
  type PackagesRemoveRejectedV01, type RegisteredProjectRow, type RepoCatalogRepoRowV01, type PackagesView,
} from "../../gateway/index.ts";
import type { PageId } from "../../app/nav-model.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { strings, format } from "../../i18n/index.ts";
import { PackagesPage } from "../packages/PackagesPage.tsx";
import { InstallConfirmDialog } from "../packages/InstallConfirmDialog.tsx";
import { RemoveConfirmDialog } from "../packages/RemoveConfirmDialog.tsx";
import "../packages/packages.css";
import { phaseStatus } from "./factory-model.ts";
import { requestProductionRun } from "./production-recipe-navigation.ts";
import {
  controlProjects, defaultSelectedRepos, filterProjects, installRequest, packageRows, repoRows, updateAllRequest, versionChoices,
  type ControlPackageRow, type ControlProject, type ControlRepo, type WorkProjectFacts,
} from "./control-packages-model.ts";
import { SkinSlot } from "./control-slots.tsx";
import "./control-center.css";

const copy = strings.controlCenter.packages;
const pkg = strings.packages;
const factory = strings.factory;
export type Screen = { readonly kind: "projects" } | { readonly kind: "project"; readonly key: string } | { readonly kind: "repos" };
type LiveView = Extract<PackagesView, { kind: "ready-p1" | "ready-p2" }>;
type Blocks = LiveView["blocks"] & { readonly catalog?: boolean; readonly repoCatalog?: boolean };
interface Notice { readonly tone: "ok" | "error"; readonly text: string }
const BUSY_PHASES = new Set(["preparing", "assembling", "restoring"]);
const MAX_WORK_PROJECTS = 40;

export function ControlPackagesPage({ onNavigate, initialScreen = { kind: "projects" } }: { onNavigate: (page: PageId) => void; initialScreen?: Screen }) {
  const gateway = useGateway();
  const view = usePackagesView();
  const live: LiveView | null = view.kind === "ready-p1" || view.kind === "ready-p2" ? view : null;
  const blocks = (live?.blocks ?? null) as Blocks | null;
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [work, setWork] = useState<readonly WorkProjectFacts[] | null>(null);
  const [registered, setRegistered] = useState<readonly RegisteredProjectRow[] | null>(null);
  const [registeredFailed, setRegisteredFailed] = useState(false);
  const [catalog, setCatalog] = useState<readonly RepoCatalogRepoRowV01[] | null>(null);
  const [catalogReload, setCatalogReload] = useState(0);
  const [projectsReload, setProjectsReload] = useState(0);

  useEffect(() => {
    const port = gateway.amfProduction;
    if (!port) { setWork([]); return; }
    let alive = true;
    void port.list().then(async list => {
      const runs = list.runs.slice(0, MAX_WORK_PROJECTS);
      const details = await Promise.allSettled(runs.map(run => port.get(run.runId)));
      if (!alive) return;
      setWork(runs.flatMap((run, i) => {
        const detail = details[i];
        return detail?.status === "fulfilled" ? [{ runId: run.runId, phase: run.phase, sourceNames: run.sourceNames, projectRoot: detail.value.projectRoot, editorVersion: detail.value.editor.version }] : [];
      }));
    }).catch(() => { if (alive) setWork([]); });
    return () => { alive = false; };
  }, [gateway, projectsReload]);
  useEffect(() => {
    let alive = true;
    void gateway.projectOps.listProjects().then(outcome => {
      if (!alive) return;
      setRegistered(outcome.ok ? outcome.projects : []); setRegisteredFailed(!outcome.ok);
    });
    return () => { alive = false; };
  }, [gateway, projectsReload]);
  useEffect(() => {
    if (!blocks?.repoCatalog) { setCatalog(null); return; }
    let alive = true;
    void gateway.packages.repoCatalog(null, null).then(outcome => { if (alive) setCatalog(outcome.kind === "ok" ? outcome.result.repos : null); });
    return () => { alive = false; };
  }, [gateway, blocks?.repoCatalog, catalogReload, view]);

  const projects = useMemo(() => controlProjects(work ?? [], registered), [work, registered]);
  const repos = useMemo(() => repoRows(view.kind === "ready-p2" ? view.repos : [], catalog), [view, catalog]);

  // The development data source keeps the full package tools with their sample data.
  if (view.kind === "ready") return <PackagesPage/>;
  const current = screen.kind === "project" ? projects.find(project => project.key === screen.key) ?? null : null;
  return <div className="vua-page vua-control vua-control--packages" data-focus-scope>
    <header className="vua-control__head">
      <div><h1 className="vua-title">{copy.title}</h1><p className="vua-text-secondary">{copy.intro}</p></div>
      <span className="vua-control__switch" role="group" aria-label={copy.viewLabel}>
        {(["projects", "repos"] as const).map(option => <button type="button" key={option} aria-pressed={option === "repos" ? screen.kind === "repos" : screen.kind !== "repos"}
          onClick={() => setScreen({ kind: option })}><Icon name={option === "projects" ? "folder" : "cloud"} size={16}/>{copy.views[option]}</button>)}
      </span>
    </header>
    {live === null ? <div className="vua-control__panel vua-control__empty" role="status"><SkinSlot name="control-panel-corner" className="vua-control__corner"/><Icon name="cloud" size={24}/><h2>{copy.notConnectedTitle}</h2><p className="vua-text-secondary">{copy.notConnectedHint}</p></div>
      : screen.kind === "repos" ? <ReposScreen view={live} blocks={blocks!} repos={repos} catalog={catalog} onChanged={() => setCatalogReload(value => value + 1)}/>
      : current !== null ? <ProjectScreen key={current.key} project={current} blocks={blocks!} repos={repos} catalog={catalog} onBack={() => setScreen({ kind: "projects" })} onNavigate={onNavigate}/>
      : <ProjectsScreen projects={projects} loading={work === null || registered === null} registeredFailed={registeredFailed}
          onOpen={project => setScreen({ kind: "project", key: project.key })} onNavigate={onNavigate} onReload={() => setProjectsReload(value => value + 1)}/>}
  </div>;
}

function ProjectsScreen({ projects, loading, registeredFailed, onOpen, onNavigate, onReload }: {
  projects: readonly ControlProject[]; loading: boolean; registeredFailed: boolean;
  onOpen: (project: ControlProject) => void; onNavigate: (page: PageId) => void; onReload: () => void;
}) {
  const [query, setQuery] = useState("");
  const shown = filterProjects(projects, query);
  const groups = (["work", "unity"] as const).map(kind => ({ kind, rows: shown.filter(project => project.kind === kind) })).filter(group => group.rows.length > 0);
  return <section className="vua-control__screen" aria-label={copy.views.projects}>
    <div className="vua-control__stage-bar">
      <input type="search" className="vua-control__search" value={query} placeholder={copy.searchProjects} aria-label={copy.searchProjects} onChange={event => setQuery(event.target.value)}/>
      <Button variant="subtle" onClick={onReload}><Icon name="refresh" size={16}/>{copy.reload}</Button>
      <Button onClick={() => onNavigate("workshop")}>{factory.newLine}</Button>
    </div>
    {registeredFailed && <p className="vua-caption vua-control__warn"><Icon name="warning" size={16}/>{copy.projectsUnreadable}</p>}
    {loading ? <p role="status" className="vua-caption vua-text-secondary">{strings.amfProduction.loading}</p>
      : projects.length === 0 ? <div className="vua-control__panel vua-control__empty"><SkinSlot name="control-panel-corner" className="vua-control__corner"/><Icon name="folder" size={24}/><p className="vua-text-secondary">{copy.projectsEmpty}</p></div>
      : groups.map(group => <section key={group.kind} className="vua-control__group">
        <h2 className="vua-control__group-head"><span>{copy.groups[group.kind]}</span><small>{copy.groupHints[group.kind]}</small><span className="vua-control__count">{group.rows.length}</span></h2>
        <ul className="vua-control__projects">{group.rows.map(project => <li key={project.key}>
          <button type="button" className="vua-control__project" data-kind={project.kind} disabled={!project.present} onClick={() => onOpen(project)} aria-label={format(copy.manageAria, { name: project.name })}>
            <span className="vua-control__project-icon"><Icon name={project.kind === "work" ? "avatar" : "folder"} size={20}/></span>
            <span className="vua-control__project-main"><strong>{project.name}</strong><small className="vua-control__mono" title={project.path}>{project.path}</small></span>
            <span className="vua-caption vua-text-secondary">{project.unityVersion ? format(copy.unity, { version: project.unityVersion }) : copy.unityUnknown}</span>
            <span>{project.phase !== null ? <span className="vua-line__status" data-status={phaseStatus(project.phase)}>{factory.status[phaseStatus(project.phase)]}</span>
              : !project.present ? <span className="vua-caption vua-control__warn">{copy.missing}</span> : null}</span>
            <span className="vua-control__project-go">{copy.manage}<Icon name="arrow-right" size={16}/></span>
          </button></li>)}</ul>
      </section>)}
  </section>;
}

type InstalledAnswer = { readonly kind: "loading" } | { readonly kind: "ok"; readonly rows: readonly (InstalledPackageRowV01 | InstalledPackageRowV02)[]; readonly cached: boolean }
  | { readonly kind: "failed"; readonly code: string } | { readonly kind: "unavailable" };
interface InstallFlow { phase: "confirm" | "applying" | "receipt" | "rejected"; plan: PackagesInstallPlanV02; requested: readonly PackagesPackageRequestV02[]; receipt: PackagesInstallReceiptV02 | null; rejection: PackagesOpsRejectedV02 | null }
interface RemoveFlow { phase: "confirm" | "applying" | "receipt" | "rejected"; plan: PackagesRemovePlanV01; requested: readonly string[]; receipt: PackagesRemoveReceiptV01 | null; rejection: PackagesRemoveRejectedV01 | null }

function ProjectScreen({ project, blocks, repos, catalog, onBack, onNavigate }: {
  project: ControlProject; blocks: Blocks; repos: readonly ControlRepo[]; catalog: readonly RepoCatalogRepoRowV01[] | null;
  onBack: () => void; onNavigate: (page: PageId) => void;
}) {
  const gateway = useGateway();
  const [installed, setInstalled] = useState<InstalledAnswer>({ kind: "loading" });
  const [reload, setReload] = useState(0);
  const [versions, setVersions] = useState<Readonly<Record<string, readonly CatalogVersionRowV01[] | "failed">>>({});
  const [selectedRepos, setSelectedRepos] = useState<ReadonlySet<string>>(() => defaultSelectedRepos(repos));
  const [query, setQuery] = useState("");
  const [prerelease, setPrerelease] = useState(false);
  const [askPrerelease, setAskPrerelease] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [installFlow, setInstallFlow] = useState<InstallFlow | null>(null);
  const [removeFlow, setRemoveFlow] = useState<RemoveFlow | null>(null);

  useEffect(() => {
    if (!project.listed) return;
    let alive = true;
    setInstalled({ kind: "loading" });
    void gateway.packages.listInstalled(project.path).then(outcome => {
      if (!alive) return;
      setInstalled(outcome.kind === "ok" ? { kind: "ok", rows: outcome.result.rows, cached: outcome.result.family === "vua.packages-installed/v0.2" && outcome.result.cacheSourced }
        : outcome.kind === "failed" ? { kind: "failed", code: outcome.code } : { kind: "unavailable" });
    });
    return () => { alive = false; };
  }, [gateway, project.path, project.listed, reload]);
  const installedRows = installed.kind === "ok" ? installed.rows : null;
  useEffect(() => {
    if (!blocks.catalog || installedRows === null) return;
    let alive = true;
    for (const row of installedRows) {
      void gateway.packages.packageCatalog(project.path, row.packageId).then(outcome => {
        if (alive) setVersions(current => ({ ...current, [row.packageId]: outcome.kind === "ok" ? outcome.result.versions : "failed" }));
      });
    }
    return () => { alive = false; };
  }, [gateway, project.path, blocks.catalog, installedRows]);

  const rows = useMemo(() => packageRows({ installed: installedRows ?? [], catalog, selectedRepos, query }), [installedRows, catalog, selectedRepos, query]);
  const updates = updateAllRequest(rows.installed);
  const canInstall = blocks.installs; const canRemove = blocks.changes;
  const fail = (code: string) => setNotice({ tone: "error", text: format(copy.failed, { code }) });

  const previewInstall = async (requests: readonly PackagesPackageRequestV02[]) => {
    if (busy || requests.length === 0) return;
    setBusy(true); setNotice(null);
    const outcome = await gateway.packages.previewInstall(project.path, requests);
    setBusy(false);
    if (outcome.kind === "ok") setInstallFlow({ phase: "confirm", plan: outcome.plan, requested: requests, receipt: null, rejection: null });
    else fail(outcome.kind === "failed" ? outcome.code : "unavailable");
  };
  const applyInstall = async () => {
    if (!installFlow || installFlow.phase !== "confirm") return;
    const flow = installFlow;
    setInstallFlow({ ...flow, phase: "applying" });
    const outcome = await gateway.packages.applyInstall(flow.plan.projectPath, flow.requested, flow.plan.digest);
    if (outcome.kind === "ok") { setInstallFlow({ ...flow, phase: "receipt", receipt: outcome.receipt }); setReload(value => value + 1); }
    else if (outcome.kind === "rejected") setInstallFlow({ ...flow, phase: "rejected", rejection: outcome.rejection });
    else { setInstallFlow(null); fail(outcome.kind === "failed" ? outcome.code : "unavailable"); }
  };
  const previewRemove = async (packageId: string) => {
    if (busy) return;
    setBusy(true); setNotice(null);
    const outcome = await gateway.packages.previewRemove(project.path, [packageId]);
    setBusy(false);
    if (outcome.kind === "ok") setRemoveFlow({ phase: "confirm", plan: outcome.plan, requested: [packageId], receipt: null, rejection: null });
    else fail(outcome.kind === "failed" ? outcome.code : "unavailable");
  };
  const applyRemove = async () => {
    if (!removeFlow || removeFlow.phase !== "confirm") return;
    const flow = removeFlow;
    setRemoveFlow({ ...flow, phase: "applying" });
    const outcome = await gateway.packages.applyRemove(flow.plan.projectPath, flow.requested, flow.plan.digest);
    if (outcome.kind === "ok") { setRemoveFlow({ ...flow, phase: "receipt", receipt: outcome.receipt }); setReload(value => value + 1); }
    else if (outcome.kind === "rejected") setRemoveFlow({ ...flow, phase: "rejected", rejection: outcome.rejection });
    else { setRemoveFlow(null); fail(outcome.kind === "failed" ? outcome.code : "unavailable"); }
  };
  const openInUnity = async () => {
    const port = gateway.amfProduction;
    if (!port || project.runId === null || busy) return;
    setBusy(true); setNotice(null);
    try { await port.open(project.runId); setNotice({ tone: "ok", text: copy.opening }); }
    catch (reason) { setNotice({ tone: "error", text: reason instanceof Error ? reason.message : strings.amfProduction.taskFailed }); }
    finally { setBusy(false); }
  };
  const lineBusy = project.phase !== null && BUSY_PHASES.has(project.phase);

  return <section className="vua-control__screen" aria-label={project.name}>
    <div className="vua-control__project-head">
      <button type="button" className="vua-control__back" onClick={onBack}><Icon name="arrow-left" size={16}/>{copy.back}</button>
      <div className="vua-control__project-title">
        <span className="vua-control__kind" data-kind={project.kind === "work" ? "avatar" : "material"}><Icon name={project.kind === "work" ? "avatar" : "folder"} size={16}/>{copy.kinds[project.kind]}</span>
        <h2>{project.name}</h2>
        <p className="vua-caption vua-text-secondary"><span className="vua-control__mono">{project.path}</span> · {project.unityVersion ? format(copy.unity, { version: project.unityVersion }) : copy.unityUnknown}
          {project.phase !== null && <> · <span className="vua-line__status" data-status={phaseStatus(project.phase)}>{factory.status[phaseStatus(project.phase)]}</span></>}</p>
      </div>
      {project.runId !== null && <div className="vua-n3__actions">
        <Button onClick={() => { requestProductionRun(project.runId!); onNavigate("workshop"); }}>{copy.openLine}</Button>
        <Button variant="primary" disabled={busy || lineBusy} onClick={() => { void openInUnity(); }}>{copy.openUnity}</Button>
      </div>}
    </div>
    {notice !== null && <p className="vua-control__notice" data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>
      <Icon name={notice.tone === "error" ? "warning" : "check"} size={16}/>{notice.text}</p>}

    {!project.listed ? <div className="vua-control__panel vua-control__unlisted"><SkinSlot name="control-panel-corner" className="vua-control__corner"/>
        <h3>{copy.unlistedTitle}</h3><p className="vua-text-secondary">{copy.unlistedHint}</p>
        <p className="vua-control__mono vua-control__path">{project.path}</p>
      </div>
    : <>
      <div className="vua-control__stage-bar vua-control__toolbar">
        {repos.length > 0 && <details className="vua-control__menu">
          <summary>{format(copy.selectedRepos, { count: repos.filter(repo => selectedRepos.has(repo.key)).length })}<Icon name="chevron-down" size={16}/></summary>
          <fieldset><legend className="vua-caption vua-text-secondary">{copy.selectedReposLabel}</legend>
            {repos.map(repo => <label key={repo.key} data-disabled={repo.enabled === false || undefined}>
              <input type="checkbox" checked={selectedRepos.has(repo.key)} onChange={event => setSelectedRepos(current => {
                const next = new Set(current); if (event.target.checked) next.add(repo.key); else next.delete(repo.key); return next; })}/>
              <span>{repo.name}</span><small>{pkg.sources[repo.kind]}</small></label>)}
          </fieldset>
        </details>}
        <input type="search" className="vua-control__search" value={query} placeholder={copy.searchPackages} aria-label={copy.searchPackages} onChange={event => setQuery(event.target.value)}/>
        <label className="vua-control__check"><input type="checkbox" checked={prerelease} onChange={event => { if (event.target.checked) setAskPrerelease(true); else setPrerelease(false); }}/>{copy.showPrerelease}</label>
        {canInstall && updates.length > 0 && <Button disabled={busy} onClick={() => { void previewInstall(updates); }}><Icon name="arrow-up" size={16}/>{format(copy.updateAll, { count: updates.length })}</Button>}
      </div>
      {askPrerelease && <div className="vua-control__panel vua-control__confirm" role="alertdialog" aria-label={pkg.toolbar.prereleaseTitle}><SkinSlot name="control-panel-corner" className="vua-control__corner"/>
        <strong>{pkg.toolbar.prereleaseTitle}</strong><p className="vua-caption vua-text-secondary">{pkg.toolbar.prereleaseBody}</p>
        <div className="vua-n3__actions"><Button variant="subtle" onClick={() => setAskPrerelease(false)}>{pkg.toolbar.prereleaseCancel}</Button>
          <Button onClick={() => { setPrerelease(true); setAskPrerelease(false); }}>{pkg.toolbar.prereleaseConfirm}</Button></div>
      </div>}
      {installed.kind === "loading" ? <p role="status" className="vua-caption vua-text-secondary">{copy.loadingPackages}</p>
        : installed.kind === "failed" ? <div className="vua-control__panel" role="alert"><SkinSlot name="control-panel-corner" className="vua-control__corner"/><p>{format(copy.failed, { code: installed.code })}</p><Button onClick={() => setReload(value => value + 1)}>{strings.amfProduction.retry}</Button></div>
        : installed.kind === "unavailable" ? <div className="vua-control__panel" role="status"><SkinSlot name="control-panel-corner" className="vua-control__corner"/><p>{copy.notConnectedHint}</p></div>
        : <div className="vua-control__table" role="table" aria-label={format(copy.installedHeading, { count: rows.installed.length })}>
          <div className="vua-control__tr vua-control__th" role="row">
            <span role="columnheader">{pkg.columns.name}</span><span role="columnheader">{pkg.columns.installed}</span><span role="columnheader">{pkg.columns.latest}</span><span role="columnheader"><span className="vua-control__sr">{copy.actions}</span></span>
          </div>
          <div className="vua-control__tsection" role="row"><span role="cell">{format(copy.installedHeading, { count: rows.installed.length })}{installed.cached && <small> · {copy.cached}</small>}</span></div>
          {rows.installed.length === 0 && <div className="vua-control__tr" role="row"><span role="cell" className="vua-caption vua-text-secondary">{copy.installedEmpty}</span></div>}
          {rows.installed.map(row => <PackageLine key={row.packageId} row={row} versions={versions[row.packageId]} prerelease={prerelease} busy={busy}
            canInstall={canInstall} canRemove={canRemove} onVersion={version => { void previewInstall(installRequest(row.packageId, version)); }}
            onUpdate={() => { void previewInstall(installRequest(row.packageId, null)); }} onRemove={() => { void previewRemove(row.packageId); }}/>)}
          {catalog !== null && <>
            <div className="vua-control__tsection" role="row"><span role="cell">{format(copy.availableHeading, { count: rows.available.length })}</span></div>
            {rows.available.length === 0 && <div className="vua-control__tr" role="row"><span role="cell" className="vua-caption vua-text-secondary">{copy.availableEmpty}</span></div>}
            {rows.available.map(row => <PackageLine key={row.packageId} row={row} versions={undefined} prerelease={prerelease} busy={busy}
              canInstall={canInstall} canRemove={false} onVersion={() => {}} onUpdate={() => {}} onAdd={() => { void previewInstall(installRequest(row.packageId, null)); }} onRemove={() => {}}/>)}
          </>}
        </div>}
    </>}
    {installFlow !== null && <InstallConfirmDialog plan={installFlow.plan} requestedPackages={installFlow.requested} phase={installFlow.phase} receipt={installFlow.receipt}
      rejection={installFlow.rejection} onCancel={() => setInstallFlow(null)} onConfirm={() => { void applyInstall(); }}/>}
    {removeFlow !== null && <RemoveConfirmDialog plan={removeFlow.plan} requestedPackageIds={removeFlow.requested} phase={removeFlow.phase} receipt={removeFlow.receipt}
      rejection={removeFlow.rejection} onCancel={() => setRemoveFlow(null)} onConfirm={() => { void applyRemove(); }}/>}
  </section>;
}

function versionText(version: string, prerelease: boolean, yanked: boolean): string {
  return yanked ? format(pkg.states.versionSuffix, { version, suffix: pkg.states.yanked }) : prerelease ? format(pkg.states.versionSuffix, { version, suffix: pkg.states.prerelease }) : version;
}

function PackageLine({ row, versions, prerelease, busy, canInstall, canRemove, onVersion, onUpdate, onAdd, onRemove }: {
  row: ControlPackageRow; versions: readonly CatalogVersionRowV01[] | "failed" | undefined; prerelease: boolean; busy: boolean;
  canInstall: boolean; canRemove: boolean; onVersion: (version: string) => void; onUpdate: () => void; onAdd?: () => void; onRemove: () => void;
}) {
  const choices = Array.isArray(versions) ? versionChoices(versions, row.installedVersion, prerelease) : null;
  return <div className="vua-control__tr" role="row" data-installed={row.installedVersion !== null || undefined}>
    <span role="cell" className="vua-control__pkg">
      <strong>{row.displayName}</strong>
      <small className="vua-control__mono">{row.packageId}</small>
      {(row.description || row.requiredBy.length > 0 || (row.installedVersion === null && row.repoName)) && <small>
        {[row.description, row.requiredBy.length > 0 ? format(copy.requiredBy, { names: row.requiredBy.join(", ") }) : null,
          row.installedVersion === null && row.repoName ? format(copy.fromRepo, { repo: row.repoName }) : null].filter(Boolean).join(" · ")}</small>}
    </span>
    <span role="cell">{row.installedVersion === null ? <span className="vua-text-secondary">—</span>
      : choices !== null && canInstall ? <select className="vua-control__version" value={row.installedVersion} disabled={busy}
          aria-label={format(pkg.columns.versionSelectAria, { name: row.displayName })} onChange={event => onVersion(event.target.value)}>
          <optgroup label={pkg.columns.compatibleGroup}>{choices.compatible.map(choice => <option key={choice.version} value={choice.version}>{versionText(choice.version, choice.prerelease, choice.yanked)}</option>)}</optgroup>
          {choices.other.length > 0 && <optgroup label={pkg.columns.incompatibleGroup}>{choices.other.map(choice => <option key={choice.version} value={choice.version}>{versionText(choice.version, choice.prerelease, choice.yanked)}</option>)}</optgroup>}
        </select>
      : <span className="vua-control__mono">{row.installedVersion}</span>}</span>
    <span role="cell" className="vua-control__latest">
      <span className="vua-control__mono">{row.latestVersion ?? "—"}</span>
      {row.installedVersion !== null && row.updateAvailable === true && canInstall && row.latestVersion !== null && <button type="button" className="vua-control__icon-button" data-tone="update" disabled={busy}
        onClick={onUpdate} aria-label={format(copy.update, { version: row.latestVersion })} title={format(copy.update, { version: row.latestVersion })}><Icon name="arrow-up" size={16}/></button>}
      {row.installedVersion !== null && row.updateAvailable === false && <Icon name="check" size={16}/>}
    </span>
    <span role="cell" className="vua-control__row-actions">
      {row.installedVersion === null ? canInstall && onAdd && <button type="button" className="vua-control__icon-button" data-tone="add" disabled={busy} onClick={onAdd}
          aria-label={format(copy.addAria, { name: row.displayName })} title={format(copy.addAria, { name: row.displayName })}><Icon name="add" size={16}/></button>
        : canRemove && <button type="button" className="vua-control__icon-button" data-tone="remove" disabled={busy} onClick={onRemove}
          aria-label={format(copy.removeAria, { name: row.displayName })} title={format(copy.removeAria, { name: row.displayName })}><Icon name="dash" size={16}/></button>}
    </span>
  </div>;
}

function ReposScreen({ view, blocks, repos, catalog, onChanged }: {
  view: LiveView; blocks: Blocks; repos: readonly ControlRepo[]; catalog: readonly RepoCatalogRepoRowV01[] | null; onChanged: () => void;
}) {
  const gateway = useGateway();
  const [adding, setAdding] = useState<"closed" | "form" | "review">("closed");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const reposError = view.kind === "ready-p2" ? view.reposError : undefined;
  const run = async (key: string, action: () => Promise<{ kind: string; code?: string; rejection?: { code: string } }>, done: string) => {
    if (busy !== null) return;
    setBusy(key); setNotice(null);
    const outcome = await action();
    setBusy(null);
    if (outcome.kind === "ok") { setNotice({ tone: "ok", text: done }); onChanged(); }
    else setNotice({ tone: "error", text: format(copy.repos.failed, { code: outcome.kind === "rejected" ? outcome.rejection?.code ?? "rejected" : outcome.code ?? outcome.kind }) });
    return outcome.kind === "ok";
  };
  const addRepo = async () => {
    const ok = await run("add", () => gateway.packages.addRemoteRepo(url.trim(), name.trim()), copy.repos.added);
    if (ok) { setAdding("closed"); setUrl(""); setName(""); }
  };
  return <section className="vua-control__screen" aria-label={copy.repos.title}>
    <div className="vua-control__stage-bar">
      <div><h2>{copy.repos.title}</h2><p className="vua-caption vua-text-secondary">{copy.repos.hint}</p></div>
      {blocks.repoWrites && adding === "closed" && <Button onClick={() => setAdding("form")}><Icon name="add" size={16}/>{copy.repos.add}</Button>}
    </div>
    {notice !== null && <p className="vua-control__notice" data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}><Icon name={notice.tone === "error" ? "warning" : "check"} size={16}/>{notice.text}</p>}
    {adding !== "closed" && <form className="vua-control__panel vua-control__add" onSubmit={event => { event.preventDefault(); if (adding === "form") setAdding("review"); else void addRepo(); }}><SkinSlot name="control-panel-corner" className="vua-control__corner"/>
      <label>{copy.repos.url}<input type="url" required value={url} placeholder={copy.repos.urlPlaceholder} disabled={adding === "review"} onChange={event => setUrl(event.target.value)}/></label>
      <label>{copy.repos.name}<input type="text" required value={name} placeholder={copy.repos.namePlaceholder} disabled={adding === "review"} onChange={event => setName(event.target.value)}/></label>
      {adding === "review" && <p className="vua-control__review"><Icon name="warning" size={16}/>{copy.repos.addReview}</p>}
      <div className="vua-n3__actions">
        <Button variant="subtle" onClick={() => setAdding(adding === "review" ? "form" : "closed")}>{adding === "review" ? copy.repos.back : copy.repos.cancel}</Button>
        <Button type="submit" variant="primary" disabled={busy !== null || url.trim() === "" || name.trim() === ""}>{adding === "review" ? copy.repos.addConfirm : copy.repos.next}</Button>
      </div>
    </form>}
    {reposError !== undefined && <p className="vua-caption vua-control__warn" role="alert"><Icon name="warning" size={16}/>{format(copy.repos.failed, { code: reposError.code })}</p>}
    {!blocks.repos ? <div className="vua-control__panel" role="status"><SkinSlot name="control-panel-corner" className="vua-control__corner"/><p className="vua-text-secondary">{copy.repos.unavailable}</p></div>
      : <ul className="vua-control__repos">{repos.map(repo => {
        const listing = catalog?.find(item => (item.repoId ?? item.name) === (repo.repoId ?? repo.name));
        return <li key={repo.key} data-kind={repo.kind} data-enabled={repo.enabled !== false || undefined}>
          <div className="vua-control__repo">
            <input type="checkbox" checked={repo.enabled !== false} aria-label={format(copy.repos.useAria, { name: repo.name })} disabled={!repo.toggleable || !blocks.repoLifecycle || busy !== null}
              onChange={event => { void run(repo.key, () => (event.target.checked ? gateway.packages.enableRepo(repo.repoId!) : gateway.packages.disableRepo(repo.repoId!)), format(event.target.checked ? copy.repos.enabled : copy.repos.disabled, { name: repo.name })); }}/>
            <span className="vua-control__repo-main"><strong>{repo.name}</strong><small className="vua-control__mono">{repo.url ?? repo.localPath ?? repo.repoId}</small></span>
            <span className="vua-control__badge" data-kind={repo.kind}>{pkg.sources[repo.kind]}</span>
            <span className="vua-caption vua-text-secondary">{repo.packageCount !== null ? format(copy.repos.packages, { count: repo.packageCount }) : repo.cached ? "" : copy.repos.notCached}</span>
            <span className="vua-control__repo-actions">
              {blocks.repoLifecycle && repo.repoId !== null && <Button variant="subtle" disabled={busy !== null} onClick={() => { void run(repo.key, () => gateway.packages.refreshRepo(repo.repoId!), copy.repos.refreshed); }}>
                <Icon name="refresh" size={16}/>{busy === repo.key ? copy.repos.working : copy.repos.refresh}</Button>}
              {blocks.repoWrites && repo.removable && (confirmRemove === repo.key
                ? <Button variant="danger" disabled={busy !== null} onClick={() => { setConfirmRemove(null); void run(repo.key, () => gateway.packages.removeRepo(repo.repoId!), copy.repos.removed); }}>{copy.repos.removeConfirm}</Button>
                : <Button variant="subtle" disabled={busy !== null} onClick={() => setConfirmRemove(repo.key)}>{copy.repos.remove}</Button>)}
            </span>
          </div>
          {listing && listing.packages.length > 0 && <details className="vua-control__repo-packages"><summary>{copy.repos.showPackages}</summary>
            <ul>{listing.packages.map(item => <li key={item.packageId}><span>{item.displayName ?? item.packageId}</span><small className="vua-control__mono">{item.packageId} · {item.latestVersion ?? "—"}</small></li>)}</ul>
          </details>}
        </li>;
      })}</ul>}
    {blocks.registers && <form className="vua-control__panel vua-control__local" onSubmit={event => {
      event.preventDefault();
      void run("local", () => gateway.packages.registerLocalPackage(localPath.trim()), copy.repos.localAdded).then(ok => { if (ok) setLocalPath(""); });
    }}><SkinSlot name="control-panel-corner" className="vua-control__corner"/>
      <div><h3>{copy.repos.localTitle}</h3><p className="vua-caption vua-text-secondary">{copy.repos.localHint}</p></div>
      <label>{copy.repos.localPath}<input type="text" value={localPath} placeholder="C:\Packages\com.example.tool" onChange={event => setLocalPath(event.target.value)}/></label>
      <Button type="submit" disabled={busy !== null || localPath.trim() === ""}>{copy.repos.localAdd}</Button>
    </form>}
  </section>;
}
