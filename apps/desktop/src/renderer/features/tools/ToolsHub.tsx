import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IconName } from "@vua/design-system";
import {
  TOOL_CATALOG_BY_ID_V01,
  TOOL_CATALOG_V01,
  type ExternalToolId,
  type ToolCatalogEntryV01,
  type ToolGoalIdV01,
} from "@vua/contracts";
import type { PageId } from "../../app/nav-model.ts";
import { currentLocale, format, strings } from "../../i18n/index.ts";
import { structureCopy } from "../../i18n/structure-copy.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { EmptyState } from "../../components/primitives/EmptyState.tsx";
import { VrcftCard } from "./VrcftCard.tsx";
import { SteamToolCard } from "./SteamToolCard.tsx";
import { InstallerToolCard } from "./InstallerToolCard.tsx";
import { PlannedToolCard } from "./PlannedToolCard.tsx";
import { isInstallerTool, isPlannedTool } from "./planned-tools.ts";
import { SlideDrawer } from "../../components/SlideDrawer.tsx";
import { useEscapeClose } from "../../components/use-escape-close.ts";
import { useGridColumns } from "../../components/use-grid-columns.ts";
import { ToolDetailsContext } from "./ToolDetails.tsx";
import { PoseGraphSection } from "./PoseGraphSection.tsx";
import "./tools.css";

/** Connected Steam entries share the Candidate connection (VRCFT adds device guidance); planned tools describe themselves and link out. */
export const TOOL_HUB_GROUPS = [
  { key: "toolTracking", goal: "tracking", icon: "avatar", tools: [{ id: "vrcft", title: "VRCFaceTracking" }, { id: "space", title: "OpenVR Space Calibrator" }, { id: "slimevr", title: "SlimeVR Server" }] },
  { key: "toolTranslation", goal: "translation", icon: "question", tools: [{ id: "vrcs", title: "VRCS" }, { id: "translator", title: "OVR Overlay Translator" }, { id: "vrct", title: "VRCT" }] },
  { key: "toolUtilities", goal: "utilities", icon: "flask", tools: [{ id: "advanced", title: "OVR Advanced Settings" }, { id: "toolkit", title: "OVR Toolkit" }, { id: "oyasumi", title: "OyasumiVR" }, { id: "xsoverlay", title: "XSOverlay" }, { id: "desktopplus", title: "Desktop+" }, { id: "fpsvr", title: "fpsVR" }] },
  { key: "toolSocial", goal: "social", icon: "avatar", tools: [{ id: "vrcx", title: "VRCX" }] },
  { key: "toolCapture", goal: "capture", icon: "anim", tools: [{ id: "liv", title: "LIV" }] },
] as const;
const ALL_TOOL_IDS = new Set<string>(TOOL_HUB_GROUPS.flatMap(group => group.tools.map(tool => tool.id)));

function formatToolProvenanceBadge(id: string, planned: (typeof structureCopy)["en"]["planned"]): string | null {
  const entry = (TOOL_CATALOG_BY_ID_V01 as Readonly<Record<string, ToolCatalogEntryV01 | undefined>>)[id];
  if (!entry) return null;
  if (entry.delivery === "official_installer") {
    return format(planned.githubLicense, { license: entry.license });
  }
  return entry.free ? planned.steamFree : planned.steamPaid;
}

function readRequestedTool(hash = window.location.hash): string | null {
  const [page, query] = hash.replace(/^#\/?/, "").split("?");
  if ((page !== "tools" && page !== "tools-discover") || !query) return null;
  const id = new URLSearchParams(query).get("tool");
  return id !== null && ALL_TOOL_IDS.has(id) ? id : null;
}

interface ToolGroupItem { readonly id: string; readonly title: string }
/** A titled row of tool cards with one shared details drawer. */
export function ToolGroup({ title, group, selected, onSelect, onPrepareSteam }: {
  title: string; group: { readonly icon: IconName; readonly tools: readonly ToolGroupItem[] }; selected: string | null; onSelect(id: string | null): void; onPrepareSteam(): void;
}) {
  const localeCopy = structureCopy[currentLocale];
  const hints = localeCopy.toolHints;
  const platforms = localeCopy.platforms;
  const planned = localeCopy.planned;
  const [shown, setShown] = useState<string>(() => group.tools.find(tool => tool.id === selected)?.id ?? group.tools[0]?.id ?? "");
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const columns = useGridColumns(grid);
  useEffect(() => {
    if (selected !== null && group.tools.some(tool => tool.id === selected)) setShown(selected);
    else if (group.tools.length > 0 && !group.tools.some(tool => tool.id === shown)) setShown(group.tools[0]!.id);
  }, [selected, shown, group.tools]);
  if (group.tools.length === 0) return null;
  const reveal = (id: string) => { setShown(id); onSelect(id); };
  const toggle = (id: string) => { setShown(id); onSelect(selected === id ? null : id); };
  const shownIndex = Math.max(0, group.tools.findIndex(tool => tool.id === shown));
  const drawerAfter = Math.min(group.tools.length - 1, (Math.floor(shownIndex / columns) + 1) * columns - 1);
  const drawer = <SlideDrawer key="details" open={group.tools.some(tool => tool.id === selected)} className="vua-tools-drawer" label={group.tools[shownIndex]!.title}>
    <div ref={setHost} />
  </SlideDrawer>;
  const hintFor = (id: string): string | undefined => {
    const base = hints[id as keyof typeof hints] ?? platforms[id as keyof typeof platforms];
    const badge = formatToolProvenanceBadge(id, planned);
    return base && badge ? `${base} · ${badge}` : base ?? badge ?? undefined;
  };
  const cards = group.tools.map(tool => {
    const toolHint = hintFor(tool.id);
    return <div className="vua-card-entry" data-card-entry={`tool-${tool.id}`} key={tool.id}>
      {tool.id === "vrcft" ? <VrcftCard hint={toolHint ?? hints.vrcft} selected={selected === tool.id} onDetails={() => toggle(tool.id)} onReveal={() => reveal(tool.id)} onPrepareSteam={onPrepareSteam} />
        : isPlannedTool(tool.id) ? <PlannedToolCard id={tool.id} title={tool.title} hint={toolHint} icon={group.icon}
            selected={selected === tool.id} onDetails={() => toggle(tool.id)} onClose={() => onSelect(null)} />
        : isInstallerTool(tool.id) ? <InstallerToolCard toolId={tool.id} title={tool.title} hint={toolHint} icon={group.icon} selected={selected === tool.id}
            onDetails={() => toggle(tool.id)} onReveal={() => reveal(tool.id)} />
        : <SteamToolCard toolId={tool.id as ExternalToolId} title={tool.title} hint={toolHint} icon={group.icon} selected={selected === tool.id}
          onDetails={() => toggle(tool.id)} onReveal={() => reveal(tool.id)} onPrepareSteam={onPrepareSteam} />}
    </div>;
  });
  return <section className="vua-environment-section">
    <h2>{title}</h2>
    <ToolDetailsContext.Provider value={{ host, shown }}>
      <div className="vua-environment-grid" ref={grid}>{cards.flatMap((card, index) => index === drawerAfter ? [card, drawer] : [card])}</div>
    </ToolDetailsContext.Provider>
  </section>;
}

export function ToolsHub({
  onPrepareSteam,
  navigate,
}: {
  onPrepareSteam(): void;
  navigate?: ((page: PageId, hash?: string) => void) | undefined;
}) {
  const [selected, setSelected] = useState<string | null>(() => readRequestedTool());
  const [goalFilter, setGoalFilter] = useState<ToolGoalIdV01 | "all">("all");
  const [freeOnly, setFreeOnly] = useState(false);
  const filterCopy = structureCopy[currentLocale].toolFilter;

  useEffect(() => {
    const applyHash = () => {
      const target = readRequestedTool();
      if (target !== null) {
        setGoalFilter("all");
        setFreeOnly(false);
        setSelected(target);
        const escaped =
          typeof CSS !== "undefined" && typeof CSS.escape === "function"
            ? CSS.escape(target)
            : target.replace(/["\\]/g, "\\$&");
        requestAnimationFrame(() => document.querySelector(`[data-card-entry="tool-${escaped}"]`)?.scrollIntoView?.({ block: "nearest" }));
      }
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  const filteredGroups = useMemo(() => TOOL_HUB_GROUPS
    .filter(group => goalFilter === "all" || group.goal === goalFilter)
    .map(group => ({
      ...group,
      tools: group.tools.filter(tool => {
        if (!freeOnly) return true;
        const meta = TOOL_CATALOG_BY_ID_V01[tool.id];
        return meta ? meta.free : true;
      }),
    }))
    .filter(group => group.tools.length > 0), [goalFilter, freeOnly]);

  const shownCount = useMemo(
    () => filteredGroups.reduce((sum, group) => sum + group.tools.length, 0),
    [filteredGroups],
  );

  const close = useCallback(() => setSelected(null), []);
  useEscapeClose(selected !== null, close);
  return <div className="vua-page vua-route-page vua-tools-hub vua-compact-environments" data-focus-scope>
    <header className="vua-page__hero"><h1 className="vua-title">{strings.journey.tools}</h1></header>
    <div className="vua-tools-filter-bar" role="region" aria-label={filterCopy.label} data-testid="tools-filter-bar">
      <div className="vua-tools-filter-bar__goals">
        <Button
          variant="subtle"
          className={goalFilter === "all" ? "vua-tools-filter-pill vua-tools-filter-pill--active" : "vua-tools-filter-pill"}
          aria-pressed={goalFilter === "all"}
          data-testid="tools-goal-all"
          onClick={() => setGoalFilter("all")}
        >
          {filterCopy.all}
        </Button>
        {TOOL_HUB_GROUPS.map(group => (
          <Button
            key={group.goal}
            variant="subtle"
            className={goalFilter === group.goal ? "vua-tools-filter-pill vua-tools-filter-pill--active" : "vua-tools-filter-pill"}
            aria-pressed={goalFilter === group.goal}
            data-testid={`tools-goal-${group.goal}`}
            onClick={() => setGoalFilter(group.goal)}
          >
            {strings.journey[group.key]}
          </Button>
        ))}
      </div>
      <div className="vua-tools-filter-bar__meta">
        <Button
          variant="subtle"
          className={freeOnly ? "vua-tools-filter-pill vua-tools-filter-pill--active" : "vua-tools-filter-pill"}
          aria-pressed={freeOnly}
          data-testid="tools-filter-free-only"
          onClick={() => setFreeOnly(prev => !prev)}
        >
          {filterCopy.freeOnly}
        </Button>
        <span className="vua-tools-filter-bar__count" aria-live="polite">
          {format(filterCopy.count, { shown: String(shownCount), total: String(TOOL_CATALOG_V01.length) })}
        </span>
      </div>
    </div>
    {filteredGroups.length === 0 ? (
      <EmptyState
        title={filterCopy.emptyTitle}
        action={
          <Button
            variant="subtle"
            data-testid="tools-filter-reset"
            onClick={() => {
              setGoalFilter("all");
              setFreeOnly(false);
            }}
          >
            {filterCopy.emptyReset}
          </Button>
        }
      />
    ) : (
      filteredGroups.map(group => <ToolGroup key={group.key} title={strings.journey[group.key]} group={group} selected={selected} onSelect={setSelected} onPrepareSteam={onPrepareSteam} />)
    )}
    <PoseGraphSection navigate={navigate} />
  </div>;
}
