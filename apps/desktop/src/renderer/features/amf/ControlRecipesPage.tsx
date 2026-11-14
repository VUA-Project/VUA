import { PublishedRecipeLinks } from "./PublishedRecipeLinks.tsx";
import type { PendingRecipeShare } from "@vua/contracts";
/** Recipes: every saved Recipe with its pictures and whether this PC has its materials, or the graph of what they share. Details open beside them. */
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Icon } from "@vua/design-system";
import { isTermsProductId, TERMS_PRESET_IDS, type AmfRecipeDocument, type AmfRecipeMaterialPlan, type TermsPresetId, type TermsUseCheckV01 } from "@vua/contracts";
import { catalogBrowser } from "../../app/catalog-browser-instance.ts";
import { catalogImageUrl } from "../../app/catalog-image.ts";
import { ContextMenu, type ContextMenuState } from "../../components/primitives/ContextMenu.tsx";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { toast } from "../../components/primitives/toast-store.ts";
import { useEscapeClose } from "../../components/use-escape-close.ts";
import { useMaterialImages } from "./PlanImages.tsx";
import { latestProductionList, PRODUCTION_LIST_FRESH_MS, readProductionList, useTaskKey } from "./production-list-read.ts";
import {
  fastDocumentReadiness,
  filterRecipeSummaries,
  newestFirst,
  recipeMaterialRows,
  recipeProductIds,
  recipeReadiness,
  type RecipeMaterialRow,
  type RecipeMaterialSource,
  type RecipeReadiness,
  type RecipeReadinessFilter,
} from "./recipe-cards-model.ts";
import { AmfProductionError, useGateway, type AmfProductionPort, type AmfRecipeSummary, type AmfSavedRecipe } from "../../gateway/index.ts";
import type { PageId } from "../../app/nav-model.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { SegmentBar } from "../../components/SegmentBar.tsx";
import { strings, format, formatDateTime } from "../../i18n/index.ts";
import { RecipeWorkspace } from "../recipe/RecipePage.tsx";
import { AmfRecipeShareDialog } from "./AmfRecipeShareDialog.tsx";
import { FitsPanel } from "./FitsPanel.tsx";
import { AmfRecipeImportDialog } from "./AmfRecipeImportDialog.tsx";
import { requestProductionRecipe } from "./production-recipe-navigation.ts";
import { buildRecipeGraph, materialLabel, materialNodeId, pinnedVersions, prefabLabel, recipeNodeId, recipeParts, sharedParts, NODE_KINDS, type GraphNode, type GraphNodeKind, type RecipeGraph } from "./control-graph-model.ts";
import { recipeSettings } from "./recipe-contents-model.ts";
import { NODE_ICONS, NodeShape, RecipeGraphCanvas } from "./ControlRecipeGraph.tsx";
import { SkinSlot } from "./control-slots.tsx";
import "./control-center.css";
import { recipeSharing } from "./recipe-sharing.ts";

const copy = strings.controlCenter.recipes;
const production = strings.amfProduction;
type View = "graph" | "list";
const viewKey = "vua-amf-control-recipes-view-v02";
function storedView(): View { try { return localStorage.getItem(viewKey) === "graph" ? "graph" : "list"; } catch { return "list"; } }
type Pictures = ReadonlyMap<string, { readonly title: string | null; readonly imageUrl: string | null }>;

/** A plan hashes the material files and holds up the module's other answers for seconds, so each Recipe keeps its last one. */
const PLAN_FRESH_MS = 300_000, PLAN_START_MS = 800;
const knownPlans = new Map<string, { readonly at: number; readonly tasks: string; readonly plan: AmfRecipeMaterialPlan }>();
const planKey = (item: { readonly recipeId: string; readonly revision: number }) => `${item.recipeId}:${item.revision}`;

function recipeMutationMessage(error: unknown): string {
  if (error instanceof AmfProductionError) {
    if (error.code === "vua.amf_production.recipe_in_use") return copy.recipeInUse;
    if (error.code === "vua.amf_production.revision_conflict") return copy.revisionConflict;
  }
  return production.taskFailed;
}

/** Reads BOOTH titles and pictures for the materials the Recipes name, a few at a time. */
function useProductPictures(productIds: readonly string[]): Pictures {
  const [pictures, setPictures] = useState<Pictures>(() => new Map());
  const key = productIds.join("|");
  useEffect(() => {
    let alive = true;
    const queue = [...productIds];
    const worker = async () => {
      while (alive && queue.length > 0) {
        const id = queue.shift()!;
        try {
          const detail = await catalogBrowser.detail(id);
          if (alive && detail.kind === "detail") setPictures(current => new Map(current).set(id, { title: detail.product.title, imageUrl: detail.product.imageUrl }));
        } catch { /* The card keeps its file name and shape. */ }
      }
    };
    void Promise.all([worker(), worker(), worker()]);
    return () => { alive = false; };
  }, [key]);
  return pictures;
}

/** Reads rendered Avatar preview PNGs saved alongside Recipes (`amf.production.recipeImage`), two at a time. */
function useRecipeImages(port: AmfProductionPort | undefined, summaries: readonly AmfRecipeSummary[] | null): ReadonlyMap<string, string> {
  const [images, setImages] = useState<ReadonlyMap<string, string>>(() => new Map());
  const key = (summaries ?? []).map(item => `${item.recipeId}:${item.revision}`).join("|");
  useEffect(() => {
    if (!port?.recipeImage || !summaries || summaries.length === 0) return;
    let alive = true;
    const queue = summaries.map(item => item.recipeId);
    const worker = async () => {
      while (alive && queue.length > 0) {
        const id = queue.shift()!;
        try {
          const image = await port.recipeImage!(id);
          if (alive && image) setImages(current => new Map(current).set(id, `data:image/png;base64,${image.data}`));
        } catch { /* Fall back to BOOTH or package picture. */ }
      }
    };
    void Promise.all([worker(), worker()]);
    return () => { alive = false; };
  }, [port, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return images;
}

function rememberView(view: View) { try { localStorage.setItem(viewKey, view); } catch { /* The view applies to this visit. */ } }

export function describeNode(node: GraphNode): string {
  return node.kind === "recipe" ? format(copy.recipeNode, { name: node.label })
    : format(copy.partNode, { kind: copy.kinds[node.kind], name: node.label, count: node.recipeIds.length });
}

interface RecipeTarget {
  readonly recipeId: string;
  readonly title: string;
  readonly revision: number;
}

export function ControlRecipesPage({ onNavigate, initialSelected = null }: { onNavigate: (page: PageId) => void; initialSelected?: string | null }) {
  const gateway = useGateway(); const port = gateway.amfProduction;
  const [packageNames, setPackageNames] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [summaries, setSummaries] = useState<readonly AmfRecipeSummary[] | null>(null);
  const [savedMap, setSavedMap] = useState<ReadonlyMap<string, AmfSavedRecipe>>(() => new Map());
  const [unreadable, setUnreadable] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<View>(storedView);
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const [resetKey, setResetKey] = useState(0);
  const [sharing, setSharing] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [incoming, setIncoming] = useState<PendingRecipeShare | null>(null);
  useEffect(() => {
    const api = recipeSharing();
    if (!api || !port) return;
    let alive = true;
    const take = () => { void api.takePending().then(value => { if (alive && value) { setIncoming(value); setImporting(true); } }).catch(() => {}); };
    take(); const unsubscribe = api.subscribe(take);
    return () => { alive = false; unsubscribe(); };
  }, [port]);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [plans, setPlans] = useState<ReadonlyMap<string, AmfRecipeMaterialPlan>>(() => new Map());
  const [sources, setSources] = useState<readonly RecipeMaterialSource[]>(() => latestProductionList(port)?.sources ?? []);
  const taskKey = useTaskKey();
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [renaming, setRenaming] = useState<RecipeTarget | null>(null);
  const [deleting, setDeleting] = useState<RecipeTarget | null>(null);
  const [recipeQuery, setRecipeQuery] = useState("");
  const [readinessFilter, setReadinessFilter] = useState<RecipeReadinessFilter>("all");

  // Summary-first load: list view renders immediately after `listRecipes()` without waiting for N `getRecipe()` calls.
  useEffect(() => {
    if (!port) return;
    let alive = true;
    setError(null);
    void port.listRecipes().then(list => {
      if (!alive) return;
      setSummaries(list);
      setUnreadable(0);
      setSavedMap(previous => {
        const next = new Map<string, AmfSavedRecipe>();
        for (const summary of list) {
          const existing = previous.get(summary.recipeId);
          if (existing && existing.revision === summary.revision) next.set(summary.recipeId, existing);
        }
        return next;
      });
    }).catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : production.taskFailed); });
    return () => { alive = false; };
  }, [port, reload]);

  const shownView: View = (summaries?.length ?? 0) > 1 ? view : "list";
  const selectedRecipeId = useMemo(() => {
    if (!selected || !summaries) return null;
    const match = summaries.find(item => recipeNodeId(item.recipeId) === selected);
    return match?.recipeId ?? null;
  }, [selected, summaries]);

  // Hydrate full Recipe documents immediately for the selected Recipe or Graph view, and gently in the background when needed.
  useEffect(() => {
    if (!port || summaries === null || summaries.length === 0) return;
    let alive = true;
    const urgent = shownView === "graph"
      || (selected !== null && selectedRecipeId === null)
      || summaries.some(item => item.avatarName === undefined);
    const missing = summaries.filter(item => !savedMap.has(item.recipeId));
    if (missing.length === 0) return;

    if (selectedRecipeId !== null && !savedMap.has(selectedRecipeId)) {
      void port.getRecipe(selectedRecipeId).then(
        value => { if (alive) setSavedMap(current => new Map(current).set(value.recipe.recipeId, value)); },
        () => { if (alive) setUnreadable(count => count + 1); },
      );
    }

    if (urgent) {
      void Promise.allSettled(missing.map(item => port.getRecipe(item.recipeId))).then(results => {
        if (!alive) return;
        const loaded = results.flatMap(result => (result.status === "fulfilled" ? [result.value] : []));
        const failedCount = results.filter(result => result.status === "rejected").length;
        if (loaded.length > 0) {
          setSavedMap(current => {
            const next = new Map(current);
            for (const entry of loaded) next.set(entry.recipe.recipeId, entry);
            return next;
          });
        }
        if (failedCount > 0) setUnreadable(failedCount);
      });
      return () => { alive = false; };
    }

    // In list view with rich summaries, hydrate documents one by one after first paint so shared-items & instant details stay warm without blocking cards.
    if (summaries.length > 1) {
      const queue = missing.map(item => item.recipeId);
      const timer = setTimeout(() => {
        void (async () => {
          let failures = 0;
          while (alive && queue.length > 0) {
            const id = queue.shift()!;
            try {
              const value = await port.getRecipe(id);
              if (alive) setSavedMap(current => new Map(current).set(id, value));
            } catch {
              failures += 1;
            }
          }
          if (alive && failures > 0) setUnreadable(failures);
        })();
      }, 120);
      return () => { alive = false; clearTimeout(timer); };
    }
    return () => { alive = false; };
  }, [port, summaries, shownView, selected, selectedRecipeId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // The files the production list knows lead a Recipe saved without a BOOTH id to its pictures and SHA-256 readiness.
  useEffect(() => {
    if (!port) return;
    let alive = true;
    void readProductionList(port, PRODUCTION_LIST_FRESH_MS, taskKey).then(list => { if (alive) setSources(list.sources); }, () => { /* The cards keep their shapes. */ });
    return () => { alive = false; };
  }, [port, reload, taskKey]);

  const saved = useMemo(
    () => (summaries === null ? null : summaries.flatMap(item => { const full = savedMap.get(item.recipeId); return full ? [full] : []; })),
    [summaries, savedMap],
  );

  // Whether this PC has each Recipe's materials: skip disk-hashing `recipeMaterialPlan` when recorded SHA-256 digests already prove readiness, unless selected.
  const selectedRecipe = useRef(selected); selectedRecipe.current = selected;
  useEffect(() => {
    if (!port || summaries === null) return;
    let alive = true;
    const known = summaries.flatMap(item => { const found = knownPlans.get(planKey(item)); return found ? [[item.recipeId, found.plan] as const] : []; });
    if (known.length > 0) setPlans(new Map(known));
    const queue = summaries.filter(item => {
      const found = knownPlans.get(planKey(item));
      if (found !== undefined && found.tasks === taskKey && Date.now() - found.at <= PLAN_FRESH_MS) return false;
      const isSelected = recipeNodeId(item.recipeId) === selectedRecipe.current;
      if (isSelected) return true;
      const doc = savedMap.get(item.recipeId)?.recipe;
      if (doc && fastDocumentReadiness(doc, sources)?.kind === "ready") return false;
      return doc !== undefined;
    });
    if (queue.length === 0) return;
    const timer = setTimeout(() => {
      void (async () => {
        while (alive && queue.length > 0) {
          const open = queue.findIndex(item => recipeNodeId(item.recipeId) === selectedRecipe.current);
          const item = queue.splice(Math.max(open, 0), 1)[0]!, id = item.recipeId;
          try {
            const plan = await port.recipeMaterialPlan(id);
            knownPlans.set(planKey(item), { at: Date.now(), tasks: taskKey, plan });
            if (alive) setPlans(current => new Map(current).set(id, plan));
          } catch { /* No readiness to show. */ }
        }
      })();
    }, selectedRecipeId !== null ? 0 : PLAN_START_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [port, summaries, savedMap, sources, taskKey, selectedRecipeId]);

  const documents = useMemo(() => (saved ?? []).map(item => item.recipe), [saved]);
  const rowsByRecipe = useMemo(() => new Map(documents.map(recipe => [recipe.recipeId, recipeMaterialRows(recipe, plans.get(recipe.recipeId), sources)] as const)), [documents, plans, sources]);
  const summaryProductIds = useMemo(
    () => (summaries ?? []).flatMap(item => (item.boothProductIds ?? []).map(id => (id.startsWith("booth:") ? id : `booth:${id}`))),
    [summaries],
  );
  const productIds = useMemo(
    () => [...new Set([...summaryProductIds, ...recipeProductIds([...rowsByRecipe.values()])])],
    [summaryProductIds, rowsByRecipe],
  );
  const pictures = useProductPictures(productIds);
  const recipeImages = useRecipeImages(port, summaries);
  const docMap = useMemo(() => new Map(documents.map(doc => [doc.recipeId, doc] as const)), [documents]);
  const filteredSummaries = useMemo(
    () =>
      summaries === null
        ? null
        : filterRecipeSummaries(summaries, {
            query: recipeQuery,
            readiness: shownView === "list" ? readinessFilter : "all",
            recipes: docMap,
            rows: rowsByRecipe,
            plans,
            sources,
            pictures,
          }),
    [summaries, recipeQuery, shownView, readinessFilter, docMap, rowsByRecipe, plans, sources, pictures],
  );
  const visibleDocuments = useMemo(() => {
    if (!filteredSummaries || (recipeQuery.trim() === "" && (shownView !== "list" || readinessFilter === "all"))) {
      return documents;
    }
    const allow = new Set(filteredSummaries.map(item => item.recipeId));
    return documents.filter(doc => allow.has(doc.recipeId));
  }, [filteredSummaries, recipeQuery, shownView, readinessFilter, documents]);
  const graph = useMemo(() => buildRecipeGraph(documents, packageNames), [documents, packageNames]);
  const visibleGraph = useMemo(() => buildRecipeGraph(visibleDocuments, packageNames), [visibleDocuments, packageNames]);
  const shared = useMemo(() => sharedParts(visibleGraph), [visibleGraph]);
  const node = graph.nodes.find(item => item.id === selected) ?? null;
  const chooseView = (next: View) => { setView(next); rememberView(next); };
  const reproduce = (recipeId: string) => { requestProductionRecipe(recipeId); onNavigate("workshop"); };
  const closeDetails = () => setSelected(null);
  useEscapeClose(selected !== null && menu === null, closeDetails);
  const openRecipeMenu = (event: ReactMouseEvent<HTMLElement>, target: RecipeTarget) => {
    const anchor = event.currentTarget.getBoundingClientRect();
    setMenu({ x: anchor.left, y: anchor.bottom + 4, items: [
      { id: "rename", label: port?.renameRecipe ? copy.rename : `${copy.rename} · ${copy.developing}`, disabled: !port?.renameRecipe, onSelect: () => setRenaming(target) },
      { id: "delete", label: port?.deleteRecipe ? copy.delete : `${copy.delete} · ${copy.developing}`, disabled: !port?.deleteRecipe, onSelect: () => setDeleting(target) },
    ] });
  };

  if (!port) return null;
  const selectedSaved = node?.kind === "recipe" ? savedMap.get(node.recipeIds[0]!) ?? null : null;
  const showAside = (node !== null && (node.kind !== "recipe" || selectedSaved !== null)) || (selectedRecipeId !== null && selectedSaved === null);

  return <div className="vua-page vua-control" data-focus-scope>
    <header className="vua-page__hero">
      <h1 className="vua-title">{copy.title}</h1>
      <div className="vua-control__actions">
        {(summaries?.length ?? 0) > 1 && <span className="vua-control__switch vua-segments" role="group" aria-label={copy.viewLabel}>
          <SegmentBar selected={shownView} />
          {(["list", "graph"] as const).map(option => <button type="button" key={option} aria-pressed={shownView === option} onClick={() => chooseView(option)}>
            <Icon name={option === "graph" ? "shader" : "modules"} size={16}/>{copy.views[option]}</button>)}
        </span>}
        {summaries !== null && summaries.length > 0 && <Button onClick={() => { setIncoming(null); setImporting(true); }}>{production.importRecipe}</Button>}
      </div>
    </header>

    {error !== null ? <div className="vua-control__panel" role="alert"><SkinSlot name="control-panel-corner" className="vua-control__corner"/><strong>{production.error}</strong><p className="vua-caption vua-text-secondary">{error}</p>
      <Button onClick={() => setReload(value => value + 1)}>{production.retry}</Button></div>
    : summaries === null ? <p role="status" className="vua-caption vua-text-secondary">{production.loading}</p>
    : summaries.length === 0 ? <div className="vua-control__panel vua-control__empty"><SkinSlot name="control-panel-corner" className="vua-control__corner"/>
        <Icon name="file" size={24}/><h2>{copy.emptyTitle}</h2>
        <div className="vua-n3__actions"><Button onClick={() => onNavigate("workshop")}>{copy.openWorkshop}</Button><Button variant="primary" onClick={() => { setIncoming(null); setImporting(true); }}>{production.importRecipe}</Button></div>
      </div>
    : <div className="vua-control__body" data-details={showAside || undefined}>
        <section className="vua-control__stage" data-view={shownView} aria-label={shownView === "graph" ? copy.graphLabel : copy.listLabel}>
          {unreadable > 0 && <p className="vua-caption vua-control__warn"><Icon name="warning" size={16}/>{format(copy.unreadable, { count: unreadable })}
            <button type="button" className="vua-control__link" onClick={() => setReload(value => value + 1)}>{production.retry}</button></p>}
          {shownView === "graph" ? <>
            <SkinSlot name="control-stage-backdrop" className="vua-control__backdrop"/><SkinSlot name="control-stage-edge" className="vua-control__edge"/>
            <div className="vua-control__stage-bar">
              <span className="vua-caption">{format(copy.count, { recipes: (filteredSummaries ?? summaries).length, shared: shared.length })}</span>
              {(summaries.length > 6 || recipeQuery !== "") && (
                <input
                  type="search"
                  className="vua-control__search"
                  value={recipeQuery}
                  placeholder={copy.searchPlaceholder}
                  aria-label={copy.searchPlaceholder}
                  onChange={event => setRecipeQuery(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === "Escape" && recipeQuery !== "") {
                      event.preventDefault();
                      event.stopPropagation();
                      setRecipeQuery("");
                    }
                  }}
                />
              )}
              <Button variant="subtle" onClick={() => setResetKey(value => value + 1)}><Icon name="refresh" size={16}/>{copy.reset}</Button>
            </div>
            <RecipeGraphCanvas graph={visibleGraph} selectedId={selected} onSelect={setSelected} resetKey={resetKey} label={copy.graphLabel} hint={copy.graphHint} describe={describeNode}/>
            <Legend/>
          </> : <RecipeList totalCount={summaries.length} summaries={filteredSummaries ?? summaries} query={recipeQuery} onQueryChange={setRecipeQuery} readinessFilter={readinessFilter} onReadinessFilterChange={setReadinessFilter} savedMap={savedMap} rows={rowsByRecipe} plans={plans} sources={sources} pictures={pictures} recipeImages={recipeImages} shared={shared} documents={documents} selectedId={selected} onSelect={setSelected} onReproduce={reproduce} onMenu={openRecipeMenu}/>}
        </section>
        {showAside ? <aside className="vua-control__details" aria-live="polite">
          {node?.kind === "recipe" && selectedSaved !== null ? <RecipeDetails key={node.id} graph={graph} saved={selectedSaved} rows={rowsByRecipe.get(node.recipeIds[0]!) ?? []} plan={plans.get(node.recipeIds[0]!)} sources={sources} pictures={pictures} onSelect={setSelected} onClose={closeDetails}
              onReproduce={reproduce} onShare={setSharing} onMenu={openRecipeMenu}/>
            : node !== null && node.kind !== "recipe" ? <PartDetails node={node} documents={documents} onSelect={setSelected} onClose={closeDetails} onNavigate={onNavigate}/>
            : <div className="vua-control__panel"><p className="vua-caption vua-text-secondary">{production.loading}</p></div>}
        </aside> : null}
      </div>}

    <section className="vua-control__drafts">
      <button type="button" className="vua-control__section-toggle" data-nav-id="recipe-drafts" aria-expanded={draftsOpen} aria-controls="control-recipe-drafts" onClick={() => setDraftsOpen(value => !value)}><Icon name="caret-down" size={16}/>{production.recipeWorkspace}</button>
      {draftsOpen && <div id="control-recipe-drafts"><RecipeWorkspace embedded onNavigate={onNavigate}/></div>}
    </section>
    <PublishedRecipeLinks/>
    <FitsPanel port={port} />
    {sharing !== null && <AmfRecipeShareDialog recipeId={sharing} onClose={() => setSharing(null)}/>}
    {menu !== null && <ContextMenu menu={menu} onClose={() => setMenu(null)}/>}
    {renaming !== null && <RenameRecipeDialog target={renaming} onClose={() => setRenaming(null)} onRenamed={() => { setRenaming(null); setReload(value => value + 1); }}/>}
    {deleting !== null && <DeleteRecipeDialog target={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); setSelected(null); setReload(value => value + 1); }}/>}
    {importing && <AmfRecipeImportDialog initial={incoming} onClose={() => setImporting(false)} onImported={() => setReload(value => value + 1)} onOpen={recipeId => setSelected(recipeNodeId(recipeId))}/>}
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

function PanelHead({ kind, title, onClose }: { kind: GraphNodeKind; title: string; onClose: () => void }) {
  return <div className="vua-control__panel-head">
    <span className="vua-control__kind" data-kind={kind}><Icon name={NODE_ICONS[kind]} size={16}/>{copy.kinds[kind]}</span>
    <button type="button" className="vua-control__close" onClick={onClose} aria-label={copy.close}><Icon name="close" size={16}/></button>
    <h2>{title}</h2>
  </div>;
}

/** A material's picture, or a Recipe's saved Avatar preview, or its kind's shape when none is on record. */
function MaterialPicture({ row, pictures, kind, size, directUrl, fallbackProductId }: {
  row: RecipeMaterialRow | undefined; pictures: Pictures; kind: GraphNodeKind; size: "large" | "small";
  directUrl?: string | undefined; fallbackProductId?: string | undefined;
}) {
  const libraryImage = useMaterialImages();
  const productKey = row?.productId ?? fallbackProductId;
  const resolved = directUrl ?? (productKey ? pictures.get(productKey)?.imageUrl : null) ?? libraryImage(row?.source ?? undefined);
  const src = resolved ? (resolved.startsWith("data:") ? resolved : catalogImageUrl(resolved)) : null;
  const [failed, setFailed] = useState(false);
  return <span className="vua-recipe-picture" data-size={size} data-kind={kind}>
    {src && !failed ? <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)}/> : <Icon name={NODE_ICONS[kind]} size={size === "large" ? 24 : 16}/>}
  </span>;
}

function ReadinessLine({ plan, fallback }: { plan: AmfRecipeMaterialPlan | undefined; fallback?: RecipeReadiness | null | undefined }) {
  const readiness = plan !== undefined ? recipeReadiness(plan) : fallback ?? null;
  if (readiness === null) return null;
  return <span className="vua-recipe-ready" data-ready={readiness.kind}>
    <Icon name={readiness.kind === "ready" ? "check" : "warning"} size={16}/>
    {readiness.kind === "ready" ? copy.ready : format(readiness.kind === "choose" ? copy.chooseCount : copy.missingCount, { count: readiness.count })}
  </span>;
}

function RecipeDetails({ graph, saved, rows, plan, sources, pictures, onSelect, onClose, onReproduce, onShare, onMenu }: {
  graph: RecipeGraph; saved: AmfSavedRecipe; rows: readonly RecipeMaterialRow[]; plan: AmfRecipeMaterialPlan | undefined; sources: readonly RecipeMaterialSource[]; pictures: Pictures; onSelect: (id: string) => void; onClose: () => void;
  onReproduce: (recipeId: string) => void; onShare: (recipeId: string) => void; onMenu: (event: ReactMouseEvent<HTMLElement>, target: RecipeTarget) => void;
}) {
  const recipe = saved.recipe;
  const parts = recipeParts(graph, recipe.recipeId);
  const nodeOf = new Map(graph.nodes.map(node => [node.id, node] as const));
  const panel = useRef<HTMLDivElement>(null);
  // A click on a card leaves the page where it is, unless the details opened out of sight.
  useEffect(() => {
    const details = panel.current?.closest<HTMLElement>(".vua-control__details"), view = details?.closest(".vua-shell__main")?.getBoundingClientRect();
    if (details === null || details === undefined || view === undefined) return;
    const top = details.getBoundingClientRect().top;
    if (top < view.top || top > view.bottom - 120) details.scrollIntoView({ block: "start" });
  }, []);
  const others = (node: GraphNode) => node.recipeIds.length > 1 ? format(copy.sharedWith, { count: node.recipeIds.length - 1 }) : undefined;
  const stateOf = (row: RecipeMaterialRow) => row.status === null || row.status === "ready" ? null : copy.materialStates[row.status];
  const materialDetail = (row: RecipeMaterialRow, node: GraphNode) => {
    if (row.role === "avatar") return [prefabLabel(recipe.avatar.prefabPath), others(node)];
    const outfit = recipe.outfits.find(item => item.materialId === row.materialId);
    if (outfit === undefined) return [others(node)];
    const how = `${format(outfit.active ? copy.switchOn : copy.switchOff, { name: outfit.toggleName || node.label })} · ${outfit.mode === "merge_armature" ? copy.merge : format(copy.attach, { bone: outfit.bone })}`;
    return [prefabLabel(outfit.prefabPath), how, others(node)];
  };
  const settings = recipeSettings(recipe);
  const materialRow = (row: RecipeMaterialRow) => {
    const node = nodeOf.get(materialNodeId(row.materialId));
    if (node === undefined) return null;
    const state = stateOf(row);
    const title = (row.productId ? pictures.get(row.productId)?.title : null) ?? node.label;
    return <button type="button" key={row.materialId} className="vua-control__part vua-recipe-material" data-kind={node.kind} data-status={row.status ?? undefined} onClick={() => onSelect(node.id)}>
      <MaterialPicture row={row} pictures={pictures} kind={node.kind} size="small"/>
      <span><strong title={title}>{title}</strong><small>{materialDetail(row, node).filter(Boolean).join(" · ")}</small>{state !== null && <small className="vua-recipe-material__state">{state}</small>}</span>
    </button>;
  };
  const target: RecipeTarget = { recipeId: recipe.recipeId, title: recipe.title, revision: saved.revision };
  return <div className="vua-control__panel" data-kind="recipe" ref={panel}><SkinSlot name="control-panel-corner" className="vua-control__corner"/>
    <PanelHead kind="recipe" title={recipe.title} onClose={onClose}/>
    <p className="vua-caption vua-text-secondary">{format(copy.saved, { revision: saved.revision, date: formatDateTime(saved.updatedAt) })} · {format(copy.unity, { version: recipe.editorVersion })}</p>
    <ReadinessLine plan={plan} fallback={fastDocumentReadiness(recipe, sources)}/>
    <div className="vua-n3__actions vua-control__primary">
      <Button variant="primary" data-nav-id={`recipe-start-${recipe.recipeId}`} onClick={() => onReproduce(recipe.recipeId)}>{copy.reproduce}</Button>
      <Button onClick={() => onShare(recipe.recipeId)}>{production.shareRecipe}</Button>
      <Button variant="subtle" className="vua-recipe-more" aria-label={copy.more} title={copy.more} aria-haspopup="menu" onClick={event => onMenu(event, target)}><Icon name="more" size={16}/></Button>
    </div>
    <h3>{format(copy.materials, { count: rows.length })}</h3>
    <div className="vua-control__parts">{rows.map(materialRow)}</div>
    <h3>{format(copy.packages, { count: parts.package.length })}</h3>
    <div className="vua-control__parts">{parts.package.map(node => <PartButton key={node.id} node={node} onSelect={onSelect}
      detail={[recipe.packages[node.packageId!], others(node)].filter(Boolean).join(" · ")}/>)}</div>
    {settings.fits + settings.lighting + settings.sdkFixes + settings.optimizer > 0 ? <>
      <h3>{copy.adjustments}</h3>
      <p className="vua-caption vua-text-secondary">{[
        settings.fits > 0 ? format(copy.adjustFits, { count: settings.fits }) : null,
        settings.lighting > 0 ? format(copy.adjustLighting, { count: settings.lighting }) : null,
        settings.sdkFixes > 0 ? format(copy.adjustFixes, { count: settings.sdkFixes }) : null,
        settings.optimizer > 0 ? copy.adjustOptimizer : null,
      ].filter(Boolean).join(" · ")}</p>
    </> : null}
    <RecipeTermsSummary rows={rows} />
  </div>;
}

function RecipeTermsSummary({ rows }: { rows: readonly RecipeMaterialRow[] }) {
  const port = useGateway().terms;
  const termsCopy = strings.useTerms;
  const [presetId, setPresetId] = useState<TermsPresetId>("vrchat_personal");
  const [check, setCheck] = useState<TermsUseCheckV01 | null>(null);
  const { productIds, unlinked } = useMemo(() => {
    const ids = new Set<string>();
    let missing = 0;
    for (const row of rows) {
      if (row.productId && isTermsProductId(row.productId)) ids.add(row.productId);
      else missing += 1;
    }
    return { productIds: [...ids], unlinked: missing };
  }, [rows]);
  const key = productIds.join(" ");
  useEffect(() => {
    setCheck(null);
    if (!port || key === "") return;
    let alive = true;
    void port.checkUse(presetId, key.split(" ")).then(next => { if (alive) setCheck(next); }, () => {});
    return () => { alive = false; };
  }, [port, presetId, key]);
  if (!port || productIds.length === 0) return null;
  return <section className="vua-recipe-terms">
    <h3>{termsCopy.line.title}</h3>
    <label className="vua-recipe-terms__use">
      <span>{termsCopy.line.use}</span>
      <select value={presetId} onChange={event => setPresetId(event.target.value as TermsPresetId)}>
        {TERMS_PRESET_IDS.map(id => <option key={id} value={id}>{termsCopy.presets[id]}</option>)}
      </select>
    </label>
    {check && <>
      <p className="vua-recipe-terms__decision" data-decision={check.combination.decision}>{termsCopy.decisions[check.combination.decision]}</p>
      {check.combination.hasSpecialNote && <p className="vua-caption vua-text-secondary">{termsCopy.line.special}</p>}
    </>}
    {unlinked > 0 && <p className="vua-caption vua-text-secondary">{format(termsCopy.line.unlinked, { count: String(unlinked) })}</p>}
  </section>;
}

function RenameRecipeDialog({ target, onClose, onRenamed }: { target: RecipeTarget; onClose: () => void; onRenamed: () => void }) {
  const port = useGateway().amfProduction;
  const [title, setTitle] = useState(target.title);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const valid = title.trim() !== "" && [...title].length <= 120;
  const save = () => {
    if (!port?.renameRecipe || !valid || busy) return;
    setBusy(true); setErrorMessage(null);
    void port.renameRecipe(target.recipeId, target.revision, title.trim()).then(onRenamed, error => { setErrorMessage(recipeMutationMessage(error)); setBusy(false); });
  };
  return <ContentDialog open title={copy.rename} closeLabel={strings.common.dialogClose} onClose={() => { if (!busy) onClose(); }}>
    <div className="vua-page__stack">
      <input type="text" aria-label={copy.rename} value={title} maxLength={120} autoFocus disabled={busy} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === "Enter") save(); }}/>
      {errorMessage !== null ? <p role="alert">{errorMessage}</p> : null}
      <div className="vua-n3__actions"><Button variant="subtle" disabled={busy} onClick={onClose}>{strings.common.cancel}</Button><Button variant="primary" disabled={busy || !valid} onClick={save}>{copy.renameSave}</Button></div>
    </div>
  </ContentDialog>;
}

function DeleteRecipeDialog({ target, onClose, onDeleted }: { target: RecipeTarget; onClose: () => void; onDeleted: () => void }) {
  const port = useGateway().amfProduction;
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const remove = () => {
    if (!port?.deleteRecipe || busy) return;
    setBusy(true); setErrorMessage(null);
    void port.deleteRecipe(target.recipeId, target.revision).then(() => { toast(copy.deleted, "success"); onDeleted(); }, error => { setErrorMessage(recipeMutationMessage(error)); setBusy(false); });
  };
  return <ContentDialog open title={copy.deleteTitle} closeLabel={strings.common.dialogClose} onClose={() => { if (!busy) onClose(); }}>
    <div className="vua-page__stack">
      <p>{format(copy.deleteBody, { name: target.title })}</p>
      {errorMessage !== null ? <p role="alert">{errorMessage}</p> : null}
      <div className="vua-n3__actions"><Button variant="subtle" disabled={busy} onClick={onClose}>{strings.common.cancel}</Button><Button variant="danger" disabled={busy} onClick={remove}>{copy.delete}</Button></div>
    </div>
  </ContentDialog>;
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

/** The cards carry everything the graph shows, for keyboard and screen-reader use and for effects-off. */
function RecipeList({ totalCount, summaries, query, onQueryChange, readinessFilter, onReadinessFilterChange, savedMap, rows, plans, sources, pictures, recipeImages, shared, documents, selectedId, onSelect, onReproduce, onMenu }: {
  totalCount: number; summaries: readonly AmfRecipeSummary[];
  query: string; onQueryChange: (value: string) => void;
  readinessFilter: RecipeReadinessFilter; onReadinessFilterChange: (value: RecipeReadinessFilter) => void;
  savedMap: ReadonlyMap<string, AmfSavedRecipe>; rows: ReadonlyMap<string, readonly RecipeMaterialRow[]>;
  plans: ReadonlyMap<string, AmfRecipeMaterialPlan>; sources: readonly RecipeMaterialSource[]; pictures: Pictures; recipeImages: ReadonlyMap<string, string>;
  shared: readonly GraphNode[]; documents: readonly AmfRecipeDocument[];
  selectedId: string | null; onSelect: (id: string | null) => void; onReproduce: (recipeId: string) => void; onMenu: (event: ReactMouseEvent<HTMLElement>, target: RecipeTarget) => void;
}) {
  const titleOf = new Map([
    ...summaries.map(item => [item.recipeId, item.title] as const),
    ...documents.map(recipe => [recipe.recipeId, recipe.title] as const),
  ]);
  const sharedMaterials = shared.filter(node => node.kind !== "package");
  const filterLabels: Readonly<Record<RecipeReadinessFilter, string>> = {
    all: copy.filterAll,
    ready: copy.filterReady,
    attention: copy.filterAttention,
  };
  return <div className="vua-control__list">
    {(totalCount >= 2 || query !== "" || readinessFilter !== "all") && (
      <div className="vua-control__list-bar">
        <input
          type="search"
          className="vua-control__search"
          value={query}
          placeholder={copy.searchPlaceholder}
          aria-label={copy.searchPlaceholder}
          onChange={event => onQueryChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Escape" && query !== "") {
              event.preventDefault();
              event.stopPropagation();
              onQueryChange("");
            }
          }}
        />
        <span className="vua-control__switch vua-segments" role="group" aria-label={copy.listLabel}>
          <SegmentBar selected={readinessFilter} />
          {(["all", "ready", "attention"] as const).map(option => (
            <button
              type="button"
              key={option}
              aria-pressed={readinessFilter === option}
              onClick={() => onReadinessFilterChange(option)}
            >
              {filterLabels[option]}
            </button>
          ))}
        </span>
      </div>
    )}
    {summaries.length === 0 ? <p role="status" className="vua-caption vua-text-secondary">{copy.noMatches}</p> : null}
    <ul className="vua-recipe-cards">{newestFirst(summaries).map(summary => {
      const full = savedMap.get(summary.recipeId);
      const recipe = full?.recipe;
      const id = recipeNodeId(summary.recipeId), selected = id === selectedId;
      const list = rows.get(summary.recipeId) ?? [];
      const avatar = list.find(row => row.role === "avatar"), outfits = list.filter(row => row.role === "outfit");
      const rawBoothIds = (summary.boothProductIds ?? []).map(pid => (pid.startsWith("booth:") ? pid : `booth:${pid}`));
      const heroProductId = avatar?.productId ?? rawBoothIds[0];
      const avatarName = (heroProductId ? pictures.get(heroProductId)?.title : null)
        ?? (avatar ? materialLabel(avatar.packageName) : (summary.avatarName ?? ""));
      const outfitCount = recipe ? outfits.length : (summary.outfitCount ?? 0);
      const packageCount = recipe ? Object.keys(recipe.packages).length : (summary.packageCount ?? 0);
      const fallbackOutfitProducts = rawBoothIds.slice(1, 6);
      const target: RecipeTarget = { recipeId: summary.recipeId, title: summary.title, revision: summary.revision };
      return <li key={id} className="vua-recipe-card" data-selected={selected || undefined}>
        <button type="button" className="vua-recipe-card__main" data-nav-id={`recipe-${summary.recipeId}`} aria-pressed={selected} onClick={() => onSelect(selected ? null : id)}>
          <MaterialPicture row={avatar} pictures={pictures} kind="avatar" size="large" directUrl={recipeImages.get(summary.recipeId)} fallbackProductId={heroProductId}/>
          <span className="vua-recipe-card__text">
            <strong title={summary.title}>{summary.title}</strong>
            <small title={avatarName}>{avatarName}</small>
            <span className="vua-recipe-card__outfits" title={format(copy.partsCount, { outfits: outfitCount, packages: packageCount })}>
              {outfits.length > 0
                ? outfits.slice(0, 5).map(row => <MaterialPicture key={row.materialId} row={row} pictures={pictures} kind="outfit" size="small"/>)
                : fallbackOutfitProducts.map(pid => <MaterialPicture key={pid} row={undefined} pictures={pictures} kind="outfit" size="small" fallbackProductId={pid}/>)}
              {outfitCount > Math.max(outfits.length > 0 ? Math.min(5, outfits.length) : fallbackOutfitProducts.length, 0) && outfits.length === 0 && fallbackOutfitProducts.length === 0 && outfitCount > 0
                ? Array.from({ length: Math.min(5, outfitCount) }, (_, idx) => <MaterialPicture key={idx} row={undefined} pictures={pictures} kind="outfit" size="small"/>)
                : null}
              {outfitCount > 5 ? <span className="vua-recipe-picture" data-size="small">+{outfitCount - 5}</span> : null}
            </span>
          </span>
        </button>
        <div className="vua-recipe-card__foot">
          <ReadinessLine plan={plans.get(summary.recipeId)} fallback={recipe ? fastDocumentReadiness(recipe, sources) : null}/>
          <span className="vua-recipe-card__actions">
            <Button variant="subtle" className="vua-recipe-more" aria-label={copy.more} title={copy.more} aria-haspopup="menu" onClick={event => onMenu(event, target)}><Icon name="more" size={16}/></Button>
            <Button data-nav-id={`recipe-card-start-${summary.recipeId}`} onClick={() => onReproduce(summary.recipeId)}>{copy.reproduce}</Button>
          </span>
        </div>
      </li>;
    })}</ul>
    {sharedMaterials.length > 0 ? <>
      <h2 className="vua-control__list-heading">{copy.sharedHeading}</h2>
      <ul>{sharedMaterials.map(node => <li key={node.id}>
        <button type="button" className="vua-control__row" aria-pressed={node.id === selectedId} onClick={() => onSelect(node.id)}>
          <KindMark kind={node.kind}/>
          <span><strong>{node.label}</strong><small>{copy.kinds[node.kind]} · {node.recipeIds.map(id => titleOf.get(id) ?? id).join(", ")}</small></span>
          <span className="vua-control__shared-dot">{node.recipeIds.length}</span>
        </button></li>)}</ul>
    </> : null}
  </div>;
}
