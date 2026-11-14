import { useCallback, useEffect, useRef, useState } from "react";
import { useGateway, type CreatorEditor, type CreatorManagers } from "../../gateway/index.ts";
import { currentLocale, format, strings } from "../../i18n/index.ts";
import { structureCopy } from "../../i18n/structure-copy.ts";
import { RouteTile } from "../../components/RouteTile.tsx";
import { useEscapeClose } from "../../components/use-escape-close.ts";
import { Tooltip } from "../../components/primitives/Tooltip.tsx";
import { SlideDrawer } from "../../components/SlideDrawer.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { CopyableText } from "../../components/primitives/CopyableText.tsx";
import { toast } from "../../components/primitives/toast-store.ts";
import { DeploymentPanel } from "../deployer/DeploymentPanel.tsx";
import { openExternalUrl } from "../../app/open-external.ts";
import { ModulesPage } from "../modules/ModulesPage.tsx";
import { consumeLicenseStep } from "../deployer/license-step-navigation.ts";
import { requestProductionRun } from "../amf/production-recipe-navigation.ts";
import { UploadEligibilityNote } from "../help/UploadEligibilityNote.tsx";
const copy = strings.environmentCards;
const unitySetup = structureCopy[currentLocale].unitySetup;
const reinstallFromPage = structureCopy[currentLocale].reinstallFromPage;
export function CreatorPage({ onOpenAmf, onWorkshop }: { onOpenAmf: () => void; onWorkshop?: (() => void) | undefined }) {
  const [licenseRequest] = useState(consumeLicenseStep);
  const port = useGateway().environment.managers;
  const [inventory, setInventory] = useState<CreatorManagers | null>(() => port?.peek?.() ?? null); const [busy, setBusy] = useState(() => !port?.peek?.()); const [failed, setFailed] = useState(false);
  const [purpose, setPurpose] = useState<"pc_avatar" | "quest_avatar">("pc_avatar");
  const [detail, setDetail] = useState<CreatorEditor | "unity2022" | "unity6" | "unity_hub" | "vcc" | "alcom" | null>(licenseRequest ? "unity2022" : null);
  const [openingManager, setOpeningManager] = useState<"unity_hub" | "vcc" | "alcom" | null>(null);
  const [unityVisited, setUnityVisited] = useState(false);
  useEffect(() => { if (detail === "unity2022") setUnityVisited(true); }, [detail]);
  const closeDetail = useCallback(() => setDetail(null), []);
  useEscapeClose(detail !== null, closeDetail);
  const toggle = (next: NonNullable<typeof detail>) => setDetail(current => typeof current === "object" && current && typeof next === "object" ? current.path === next.path ? null : next : current === next ? null : next);
  const generation = useRef(0); const alive = useRef(false);
  const inspect = useCallback(async (refresh = true) => {
    const cached = !refresh ? port?.peek?.() : null;
    if (cached) { setInventory(cached); setBusy(false); setFailed(false); return; }
    const ticket = ++generation.current; setBusy(true); setFailed(false);
    try { if (!port) throw new Error("unavailable"); const snapshot = await port.inspect({ refresh }); if (alive.current && ticket === generation.current) setInventory(snapshot); }
    catch { if (alive.current && ticket === generation.current) setFailed(true); }
    finally { if (alive.current && ticket === generation.current) setBusy(false); }
  }, [port]);
  useEffect(() => { alive.current = true; void inspect(false); return () => { alive.current = false; generation.current += 1; }; }, [inspect]);
  const editors = inventory?.editors ?? [];
  const unity2022 = editors.find(e => e.version === "2022.3.22f1") ?? editors.find(e => e.version === "2022.3.22f1c1");
  const unity2022Status = busy ? copy.checking : failed ? copy.unknown : unity2022 ? `${copy.installed} · ${unity2022.version}` : inventory?.editorsKnown ? copy.notFound : copy.unknown;
  const others = editors.filter(e => !["2022.3.22f1", "2022.3.22f1c1"].includes(e.version) && !e.version.startsWith("6000."));
  const unity6 = editors.filter(e => e.version.startsWith("6000."));
  const name = (app: "unity_hub" | "vcc" | "alcom") => app === "unity_hub" ? "Unity Hub" : app === "vcc" ? "VCC" : "ALCOM";
  const config = (presence: CreatorManagers["vcc"]) => presence === "found" ? copy.configFound : presence === "not_found" ? copy.configMissing : presence === "read_failed" ? copy.configFailed : copy.unknown;
  const official = (app: "unity_hub" | "vcc" | "alcom") => app === "unity_hub" ? "https://unity.com/download" : app === "vcc" ? "https://vrchat.com/home/download" : "https://vrc-get.anatawa12.com/alcom/";
  const openManager = async (app: "unity_hub" | "vcc" | "alcom") => {
    if (!port?.openManager || openingManager !== null) return;
    setOpeningManager(app);
    try {
      await port.openManager(app);
      toast(format(copy.managerOpened, { tool: name(app) }), "success");
    } catch {
      toast(format(copy.managerOpenFailed, { tool: name(app) }), "error");
    } finally {
      if (alive.current) setOpeningManager(null);
    }
  };
  const detailHeader = (title: string) => <header className="vua-environment-heading"><h2>{title}</h2><Button variant="subtle" data-back onClick={() => setDetail(null)}>{copy.closeDetails}</Button></header>;
  return <div className="vua-page vua-route-page vua-creator-page" data-route-stage={detail === "unity2022" ? "prepare" : "pick"}>
    <header className="vua-page__hero vua-environment-heading"><h1 className="vua-title">{unitySetup}</h1><Button variant="subtle" data-nav-id="creator-refresh-environment" disabled={busy} onClick={() => void inspect()}>{busy ? copy.checking : copy.inspect}</Button></header>
    <section className="vua-environment-section"><h2>{copy.editors}</h2><div className="vua-route-grid vua-route-grid--devices">
      <div className="vua-card-entry" data-card-entry="route-unity2022">
        <div className="vua-manager-card"><RouteTile title={strings.journey.unity2022} kind="unity" id="route-unity2022" selected={detail === "unity2022"} expanded={detail === "unity2022"} controls="route-unity2022-details" onClick={() => toggle("unity2022")} status={<span className="vua-manager-card__status" data-editor-status role="status">{unity2022Status}</span>} /></div>
        <SlideDrawer id="route-unity2022-details" open={detail === "unity2022"} label={strings.journey.unity2022} className="vua-creator-drawer"><section className="vua-environment-detail">
          {detailHeader(strings.journey.unity2022)}
          <div className="vua-route-platform"><Button aria-pressed={purpose === "pc_avatar"} onClick={() => setPurpose("pc_avatar")}>{strings.journey.pcAvatar}</Button><Button aria-pressed={purpose === "quest_avatar"} onClick={() => setPurpose("quest_avatar")}>{strings.journey.questAvatar}</Button></div>
          {unityVisited || detail === "unity2022" ? <DeploymentPanel key={purpose} zone="create" purpose={purpose} autoPlan focusLicense={licenseRequest !== null}
            onReturnToWorkshop={licenseRequest?.runId && onWorkshop ? () => { requestProductionRun(licenseRequest.runId!); onWorkshop(); } : undefined} /> : null}
        </section></SlideDrawer>
      </div>
      <div className="vua-card-entry" data-card-entry="route-unity6">
        {unity6.length ? <>
          <RouteTile title={strings.journey.unity6} kind="unity" id="route-unity6" developing selected={detail === "unity6"} expanded={detail === "unity6"} controls="route-unity6-details" onClick={() => toggle("unity6")} />
          <SlideDrawer id="route-unity6-details" open={detail === "unity6"} label={strings.journey.unity6} className="vua-creator-drawer"><section className="vua-environment-detail">
            {detailHeader(strings.journey.unity6)}{unity6.map(editor => <p key={editor.path}><strong>Unity {editor.version}</strong><br /><CopyableText value={editor.path} copyLabel={strings.controlCenter.packages.copyPath} copiedLabel={strings.controlCenter.packages.copiedPath} /></p>)}
          </section></SlideDrawer>
        </> : <Tooltip block content={strings.journey.developingTip}><RouteTile title={strings.journey.unity6} kind="unity" id="route-unity6" developing disabled /></Tooltip>}
      </div>
      {others.map(e => {
        const selected = typeof detail === "object" && detail?.path === e.path;
        const detailId = `creator-editor-${encodeURIComponent(e.path)}-details`;
        return <div className="vua-card-entry" data-card-entry={`editor-${e.version}`} key={e.path}>
          <RouteTile title={`Unity ${e.version}`} kind="unity" id={`editor-${e.version}`} selected={selected} expanded={selected} controls={detailId} onClick={() => toggle(e)} />
          <SlideDrawer id={detailId} open={selected} label={`Unity ${e.version}`} className="vua-creator-drawer"><section className="vua-environment-detail">
            {detailHeader(`Unity ${e.version}`)}<p>{copy.otherEditor}</p><CopyableText value={e.path} copyLabel={strings.controlCenter.packages.copyPath} copiedLabel={strings.controlCenter.packages.copiedPath} /><Button onClick={() => setDetail("unity2022")}>{copy.choose2022}</Button>
          </section></SlideDrawer>
        </div>;
      })}
    </div>{failed || !busy && !inventory?.editorsKnown ? <p role="status">{copy.inventoryUnknown}</p> : null}</section>
    <section className="vua-environment-section"><h2>{copy.managers}</h2><div className="vua-route-grid vua-manager-grid">
      {(["unity_hub", "vcc", "alcom"] as const).map(app => {
        const found = inventory?.apps?.find(a => a.component === app);
        const status = busy ? copy.checking : failed || !found || found.presence === "unknown" ? copy.unknown : found.presence === "found" ? copy.installed : copy.notFound;
        return <div className="vua-card-entry" data-card-entry={`manager-${app}`} key={app}>
          <div className="vua-manager-card" data-manager={app}><RouteTile title={name(app)} kind={app === "unity_hub" ? "unity" : undefined} icon="folder" id={`manager-${app}`} selected={detail === app} expanded={detail === app} controls={`manager-${app}-details`} onClick={() => toggle(app)} status={<span className="vua-manager-card__status" role="status">{status}</span>} /></div>
          <SlideDrawer id={`manager-${app}-details`} open={detail === app} label={name(app)} className="vua-creator-drawer"><section className="vua-environment-detail">
            {detailHeader(name(app))}{app !== "unity_hub" ? <p>{config(inventory?.[app] ?? null)}</p> : null}{found?.path ? <><h3>{copy.paths}</h3><CopyableText value={found.path} copyLabel={strings.controlCenter.packages.copyPath} copiedLabel={strings.controlCenter.packages.copiedPath} /></> : null}<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{found?.presence === "found" && port?.openManager ? <Button variant="primary" data-nav-id={`open-manager-${app}`} disabled={openingManager !== null} onClick={() => void openManager(app)}>{openingManager === app ? copy.starting : format(copy.openManager, { tool: name(app) })}</Button> : null}<Button onClick={() => void openExternalUrl(official(app))}>{found?.presence === "found" ? format(reinstallFromPage, { tool: name(app) }) : copy.official}</Button></div>
          </section></SlideDrawer>
        </div>;
      })}
    </div></section>
    <UploadEligibilityNote />
    <section className="vua-environment-section" data-amf-setup><ModulesPage embedded activationSwitch onOpen={onOpenAmf} /></section>
  </div>;
}
