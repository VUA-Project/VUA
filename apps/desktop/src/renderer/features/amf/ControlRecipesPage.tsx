/** Control center, Recipes: every saved Recipe and what it uses, as a living graph or a list, with details beside it. */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@vua/design-system";
import type { AmfRecipeDocument } from "@vua/contracts";
import { useGateway, type AmfSavedRecipe } from "../../gateway/index.ts";
import type { PageId } from "../../app/nav-model.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { strings, format, formatDateTime } from "../../i18n/index.ts";
import { RecipeWorkspace } from "../recipe/RecipePage.tsx";
import { AmfRecipeShareDialog } from "./AmfRecipeShareDialog.tsx";
import { AmfRecipeImportDialog } from "./AmfRecipeImportDialog.tsx";
import { requestProductionRecipe } from "./production-recipe-navigation.ts";
import { buildRecipeGraph, materialNodeId, pinnedVersions, prefabLabel, recipeNodeId, recipeParts, sharedParts, NODE_KINDS, type GraphNode, type GraphNodeKind, type RecipeGraph } from "./control-graph-model.ts";
import { NODE_ICONS, NodeShape, RecipeGraphCanvas } from "./ControlRecipeGraph.tsx";
import { SkinSlot } from "./control-slots.tsx";
import "./control-center.css";

const copy = strings.controlCenter.recipes;
const production = strings.amfProduction;
type View = "graph" | "list";
const viewKey = "vua-amf-control-recipes-view-v01";
function storedView(): View { try { return localStorage.getItem(viewKey) === "list" ? "list" : "graph"; } catch { return "graph"; } }
function rememberView(view: View) { try { localStorage.setItem(viewKey, view); } catch { /* The view applies to this visit. */ } }

export function describeNode(node: GraphNode): string {
  return node.kind === "recipe" ? format(copy.recipeNode, { name: node.label })
    : format(copy.partNode, { kind: copy.kinds[node.kind], name: node.label, count: node.recipeIds.length });
}

export function ControlRecipesPage({ onNavigate, initialSelected = null }: { onNavigate: (page: PageId) => void; initialSelected?: string | null }) {
  const gateway = useGateway(); const port = gateway.amfProduction;
  const [packageNames, setPackageNames] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [saved, setSaved] = useState<readonly AmfSavedRecipe[] | null>(null);
  const [unreadable, setUnreadable] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<View>(storedView);
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const [resetKey, setResetKey] = useState(0);
  const [sharing, setSharing] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);

  useEffect(() => {
    if (!port) return;
    let alive = true;
    setError(null);
    void port.listRecipes().then(async summaries => {
      const results = await Promise.allSettled(summaries.map(summary => port.getRecipe(summary.recipeId)));
      if (!alive) return;
      setSaved(results.flatMap(result => (result.status === "fulfilled" ? [result.value] : [])));
      setUnreadable(results.filter(result => result.status === "rejected").length);
    }).catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : production.taskFailed); });
    return () => { alive = false; };
  }, [port, reload]);

  // Package names come from the repositories the package manager knows; ids stand in for the rest.
  useEffect(() => {
    let alive = true;
    void gateway.packages.repoCatalog(null, null).then(outcome => {
      if (!alive || outcome.kind !== "ok") return;
      const names = new Map<string, string>();
      for (const repo of outcome.result.repos) for (const item of repo.packages) if (item.displayName && !names.has(item.packageId)) names.set(item.packageId, item.displayName);
      setPackageNames(names);
    }).catch(() => { /* Package ids stay as labels. */ });
    return () => { alive = false; };
  }, [gateway]);
  const documents = useMemo(() => (saved ?? []).map(item => item.recipe), [saved]);
  const graph = useMemo(() => buildRecipeGraph(documents, packageNames), [documents, packageNames]);
  const shared = useMemo(() => sharedParts(graph), [graph]);
  const savedById = useMemo(() => new Map((saved ?? []).map(item => [item.recipe.recipeId, item] as const)), [saved]);
  const node = graph.nodes.find(item => item.id === selected) ?? null;
  const chooseView = (next: View) => { setView(next); rememberView(next); };
  const reproduce = (recipeId: string) => { requestProductionRecipe(recipeId); onNavigate("workshop"); };

  if (!port) return null;
  return <div className="vua-page vua-control" data-focus-scope>
    <header className="vua-control__head">
      <div><h1 className="vua-title">{copy.title}</h1><p className="vua-text-secondary">{copy.intro}</p></div>
      <div className="vua-control__actions">
        {graph.nodes.length > 0 && <span className="vua-control__switch" role="group" aria-label={copy.viewLabel}>
          {(["graph", "list"] as const).map(option => <button type="button" key={option} aria-pressed={view === option} onClick={() => chooseView(option)}>
            <Icon name={option === "graph" ? "shader" : "file"} size={16}/>{copy.views[option]}</button>)}
        </span>}
        {saved !== null && saved.length > 0 && <Button onClick={() => setImporting(true)}>{production.importRecipe}</Button>}
      </div>
    </header>

    {error !== null ? <div className="vua-control__panel" role="alert"><SkinSlot name="control-panel-corner" className="vua-control__corner"/><strong>{production.error}</strong><p className="vua-caption vua-text-secondary">{error}</p>
      <Button onClick={() => setReload(value => value + 1)}>{production.retry}</Button></div>
    : saved === null ? <p role="status" className="vua-caption vua-text-secondary">{production.loading}</p>
    : saved.length === 0 ? <div className="vua-control__panel vua-control__empty"><SkinSlot name="control-panel-corner" className="vua-control__corner"/>
        <Icon name="file" size={24}/><h2>{copy.emptyTitle}</h2><p className="vua-text-secondary">{copy.emptyHint}</p>
        <div className="vua-n3__actions"><Button onClick={() => onNavigate("workshop")}>{copy.openWorkshop}</Button><Button variant="primary" onClick={() => setImporting(true)}>{production.importRecipe}</Button></div>
      </div>
    : <div className="vua-control__body">
        <section className="vua-control__stage" aria-label={view === "graph" ? copy.graphLabel : copy.listLabel}>
          <SkinSlot name="control-stage-backdrop" className="vua-control__backdrop"/><SkinSlot name="control-stage-edge" className="vua-control__edge"/>
          <div className="vua-control__stage-bar">
            <span className="vua-caption">{format(copy.count, { recipes: documents.length, shared: shared.length })}</span>
            {unreadable > 0 && <span className="vua-caption vua-control__warn"><Icon name="warning" size={16}/>{format(copy.unreadable, { count: unreadable })}
              <button type="button" className="vua-control__link" onClick={() => setReload(value => value + 1)}>{production.retry}</button></span>}
            {view === "graph" && <Button variant="subtle" onClick={() => setResetKey(value => value + 1)}><Icon name="refresh" size={16}/>{copy.reset}</Button>}
          </div>
          {view === "graph"
            ? <RecipeGraphCanvas graph={graph} selectedId={selected} onSelect={setSelected} resetKey={resetKey} label={copy.graphLabel} hint={copy.graphHint} describe={describeNode}/>
            : <RecipeList graph={graph} shared={shared} documents={documents} selectedId={selected} onSelect={setSelected}/>}
          {view === "graph" && <Legend/>}
        </section>
        <aside className="vua-control__details" aria-live="polite">
          {node === null ? <Overview graph={graph} shared={shared} onSelect={setSelected}/>
            : node.kind === "recipe" ? <RecipeDetails graph={graph} saved={savedById.get(node.recipeIds[0]!)!} onSelect={setSelected} onClose={() => setSelected(null)}
              onReproduce={reproduce} onShare={setSharing}/>
            : <PartDetails node={node} documents={documents} onSelect={setSelected} onClose={() => setSelected(null)} onNavigate={onNavigate}/>}
        </aside>
      </div>}

    <section className="vua-control__drafts">
      <Button variant="subtle" aria-expanded={draftsOpen} aria-controls="control-recipe-drafts" onClick={() => setDraftsOpen(value => !value)}>{production.recipeWorkspace}</Button>
      <p className="vua-caption vua-text-secondary">{production.recipeWorkspaceHint}</p>
      {draftsOpen && <div id="control-recipe-drafts"><RecipeWorkspace/></div>}
    </section>
    {sharing !== null && <AmfRecipeShareDialog recipeId={sharing} onClose={() => setSharing(null)}/>}
    {importing && <AmfRecipeImportDialog onClose={() => setImporting(false)} onImported={() => setReload(value => value + 1)} onOpen={recipeId => setSelected(recipeNodeId(recipeId))}/>}
  </div>;
}

function KindMark({ kind }: { kind: GraphNodeKind }) {
  return <svg className="vua-control__mark" data-kind={kind} viewBox="-30 -30 60 60" width={18} height={18} aria-hidden="true"><NodeShape kind={kind}/></svg>;
}

function Legend() {
  return <ul className="vua-control__legend" aria-label={copy.legend}>
    {NODE_KINDS.map(kind => <li key={kind}><KindMark kind={kind}/>{copy.kinds[kind]}</li>)}
    <li><span className="vua-control__shared-dot" aria-hidden="true">2</span>{copy.sharedLegend}</li>
  </ul>;
}

function PartButton({ node, onSelect, detail }: { node: GraphNode; onSelect: (id: string) => void; detail?: string | undefined }) {
  return <button type="button" className="vua-control__part" data-kind={node.kind} onClick={() => onSelect(node.id)}>
    <KindMark kind={node.kind}/>
    <span><strong>{node.label}</strong>{detail !== undefined && <small>{detail}</small>}</span>
    {node.kind !== "recipe" && node.recipeIds.length > 1 && <span className="vua-control__shared-dot" title={format(copy.usedBy, { count: node.recipeIds.length })}>{node.recipeIds.length}</span>}
  </button>;
}

function Overview({ graph, shared, onSelect }: { graph: RecipeGraph; shared: readonly GraphNode[]; onSelect: (id: string) => void }) {
  const counts = NODE_KINDS.map(kind => [kind, graph.nodes.filter(node => node.kind === kind).length] as const).filter(([, count]) => count > 0);
  return <div className="vua-control__panel"><SkinSlot name="control-panel-corner" className="vua-control__corner"/>
    <h2>{copy.overview}</h2>
    <p className="vua-caption vua-text-secondary">{copy.overviewHint}</p>
    <dl className="vua-control__counts">{counts.map(([kind, count]) => <div key={kind}><dt><KindMark kind={kind}/>{copy.kinds[kind]}</dt><dd>{count}</dd></div>)}</dl>
    <h3>{copy.mostShared}</h3>
    {shared.length === 0 ? <p className="vua-caption vua-text-secondary">{copy.sharedEmpty}</p>
      : <div className="vua-control__parts">{shared.slice(0, 6).map(node => <PartButton key={node.id} node={node} onSelect={onSelect} detail={format(copy.usedBy, { count: node.recipeIds.length })}/>)}</div>}
  </div>;
}

function PanelHead({ kind, title, onClose }: { kind: GraphNodeKind; title: string; onClose: () => void }) {
  return <div className="vua-control__panel-head">
    <span className="vua-control__kind" data-kind={kind}><Icon name={NODE_ICONS[kind]} size={16}/>{copy.kinds[kind]}</span>
    <button type="button" className="vua-control__close" onClick={onClose} aria-label={copy.close}><Icon name="close" size={16}/></button>
    <h2>{title}</h2>
  </div>;
}

function RecipeDetails({ graph, saved, onSelect, onClose, onReproduce, onShare }: {
  graph: RecipeGraph; saved: AmfSavedRecipe; onSelect: (id: string) => void; onClose: () => void;
  onReproduce: (recipeId: string) => void; onShare: (recipeId: string) => void;
}) {
  const recipe = saved.recipe;
  const parts = recipeParts(graph, recipe.recipeId);
  const nodeOf = new Map(graph.nodes.map(node => [node.id, node] as const));
  // Outfits come from the Recipe itself: an Avatar package may also carry an outfit.
  const worn = recipe.outfits.flatMap(outfit => { const node = nodeOf.get(materialNodeId(outfit.materialId)); return node ? [{ node, outfit }] : []; });
  const others = (node: GraphNode) => node.recipeIds.length > 1 ? format(copy.sharedWith, { count: node.recipeIds.length - 1 }) : undefined;
  return <div className="vua-control__panel" data-kind="recipe"><SkinSlot name="control-panel-corner" className="vua-control__corner"/>
    <PanelHead kind="recipe" title={recipe.title} onClose={onClose}/>
    <p className="vua-caption vua-text-secondary">{format(copy.saved, { revision: saved.revision, date: formatDateTime(saved.updatedAt) })} · {format(copy.unity, { version: recipe.editorVersion })}</p>
    <div className="vua-n3__actions vua-control__primary">
      <Button variant="primary" onClick={() => onReproduce(recipe.recipeId)}>{copy.reproduce}</Button>
      <Button onClick={() => onShare(recipe.recipeId)}>{production.shareRecipe}</Button>
    </div>
    <p className="vua-caption vua-text-secondary">{production.recipeReproduceHint}</p>
    <h3>{copy.avatar}</h3>
    <div className="vua-control__parts">{parts.avatar.map(node => <PartButton key={node.id} node={node} onSelect={onSelect} detail={[prefabLabel(recipe.avatar.prefabPath), others(node)].filter(Boolean).join(" · ")}/>)}</div>
    <h3>{format(copy.outfits, { count: worn.length })}</h3>
    <div className="vua-control__parts">{worn.map(({ node, outfit }) => {
      const how = `${format(outfit.active ? copy.switchOn : copy.switchOff, { name: outfit.toggleName || node.label })} · ${outfit.mode === "merge_armature" ? copy.merge : format(copy.attach, { bone: outfit.bone })}`;
      return <PartButton key={`${node.id}:${outfit.prefabPath}`} node={node} onSelect={onSelect} detail={[prefabLabel(outfit.prefabPath), how, others(node)].filter(Boolean).join(" · ")}/>;
    })}</div>
    {parts.material.length > 0 && <><h3>{format(copy.materials, { count: parts.material.length })}</h3>
      <div className="vua-control__parts">{parts.material.map(node => <PartButton key={node.id} node={node} onSelect={onSelect} detail={others(node)}/>)}</div></>}
    <h3>{format(copy.packages, { count: parts.package.length })}</h3>
    <div className="vua-control__parts">{parts.package.map(node => <PartButton key={node.id} node={node} onSelect={onSelect}
      detail={[recipe.packages[node.packageId!], others(node)].filter(Boolean).join(" · ")}/>)}</div>
  </div>;
}

function PartDetails({ node, documents, onSelect, onClose, onNavigate }: {
  node: GraphNode; documents: readonly AmfRecipeDocument[]; onSelect: (id: string) => void; onClose: () => void; onNavigate: (page: PageId) => void;
}) {
  const titleOf = new Map(documents.map(recipe => [recipe.recipeId, recipe.title] as const));
  const versions = node.kind === "package" ? pinnedVersions(node) : [];
  return <div className="vua-control__panel" data-kind={node.kind}><SkinSlot name="control-panel-corner" className="vua-control__corner"/>
    <PanelHead kind={node.kind} title={node.label} onClose={onClose}/>
    <p className="vua-caption vua-text-secondary vua-control__mono">{node.packageName ?? node.packageId}</p>
    {node.kind === "package" && versions.length > 1 && <p className="vua-caption vua-control__warn"><Icon name="warning" size={16}/>{format(copy.versionsDiffer, { count: versions.length })}</p>}
    {(node.prefabs?.length ?? 0) > 0 && <><h3>{copy.prefabs}</h3><ul className="vua-control__plain">{node.prefabs!.map(path => <li key={path} title={path}>{prefabLabel(path)}</li>)}</ul></>}
    <h3>{format(copy.usedBy, { count: node.recipeIds.length })}</h3>
    <div className="vua-control__parts">{node.recipeIds.map(recipeId => <button type="button" key={recipeId} className="vua-control__part" data-kind="recipe" onClick={() => onSelect(recipeNodeId(recipeId))}>
      <KindMark kind="recipe"/><span><strong>{titleOf.get(recipeId) ?? recipeId}</strong>
        {node.kind === "package" && <small>{format(copy.pinned, { version: node.versions?.[recipeId] ?? "" })}</small>}</span>
    </button>)}</div>
    <div className="vua-n3__actions">
      {node.kind === "package" ? <Button onClick={() => onNavigate("packages")}>{copy.openPackages}</Button> : <Button onClick={() => onNavigate("warehouse")}>{copy.openLibrary}</Button>}
    </div>
  </div>;
}

/** The list carries everything the graph shows, for keyboard and screen-reader use and for effects-off. */
function RecipeList({ graph, shared, documents, selectedId, onSelect }: {
  graph: RecipeGraph; shared: readonly GraphNode[]; documents: readonly AmfRecipeDocument[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const titleOf = new Map(documents.map(recipe => [recipe.recipeId, recipe.title] as const));
  const recipes = graph.nodes.filter(node => node.kind === "recipe");
  const outfitCount = new Map(documents.map(recipe => [recipe.recipeId, recipe.outfits.length] as const));
  return <div className="vua-control__list">
    <h2 className="vua-caption">{copy.recipesHeading}</h2>
    <ul>{recipes.map(node => {
      const parts = recipeParts(graph, node.recipeIds[0]!);
      return <li key={node.id}><button type="button" className="vua-control__row" aria-pressed={node.id === selectedId} onClick={() => onSelect(node.id)}>
        <KindMark kind="recipe"/>
        <span><strong>{node.label}</strong><small>{format(copy.partsSummary, { avatar: parts.avatar.map(item => item.label).join(", "), outfits: outfitCount.get(node.recipeIds[0]!) ?? parts.outfit.length, packages: parts.package.length })}</small></span>
        <span className="vua-control__chips">{[...parts.avatar, ...parts.outfit, ...parts.material].filter(item => item.recipeIds.length > 1).map(item => <span key={item.id} data-kind={item.kind}>{item.label}</span>)}</span>
      </button></li>;
    })}</ul>
    <h2 className="vua-caption">{copy.sharedHeading}</h2>
    {shared.length === 0 ? <p className="vua-caption vua-text-secondary">{copy.sharedEmpty}</p> : <ul>{shared.map(node => <li key={node.id}>
      <button type="button" className="vua-control__row" aria-pressed={node.id === selectedId} onClick={() => onSelect(node.id)}>
        <KindMark kind={node.kind}/>
        <span><strong>{node.label}</strong><small>{copy.kinds[node.kind]} · {node.recipeIds.map(id => titleOf.get(id) ?? id).join(", ")}</small></span>
        <span className="vua-control__shared-dot">{node.recipeIds.length}</span>
      </button></li>)}</ul>}
  </div>;
}
