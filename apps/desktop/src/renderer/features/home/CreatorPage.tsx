import { useCallback, useEffect, useRef, useState } from "react";
import { useGateway, type CreatorEditor, type CreatorManagers } from "../../gateway/index.ts";
import { strings } from "../../i18n/index.ts";
import { RouteTile } from "../../components/RouteTile.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { DeploymentPanel } from "../deployer/DeploymentPanel.tsx";
import { openExternalUrl } from "../../app/open-external.ts";
import { ModulesPage } from "../modules/ModulesPage.tsx";
const copy = strings.environmentCards;
export function CreatorPage({ onOpenAmf }: { onOpenAmf: () => void }) {
  const port = useGateway().environment.managers;
  const [inventory, setInventory] = useState<CreatorManagers | null>(null); const [busy, setBusy] = useState(true); const [failed, setFailed] = useState(false);
  const [purpose, setPurpose] = useState<"pc_avatar" | "quest_avatar">("pc_avatar");
  const [detail, setDetail] = useState<CreatorEditor | "unity2022" | "unity6" | "unity_hub" | "vcc" | "alcom" | null>(null);
  const [unityVisited, setUnityVisited] = useState(false);
  useEffect(() => { if (detail === "unity2022") setUnityVisited(true); }, [detail]);
  const toggle = (next: NonNullable<typeof detail>) => setDetail(current => typeof current === "object" && current && typeof next === "object" ? current.path === next.path ? null : next : current === next ? null : next);
  const generation = useRef(0); const alive = useRef(false);
  const inspect = useCallback(async () => {
    const ticket = ++generation.current; setBusy(true); setFailed(false);
    try { if (!port) throw new Error("unavailable"); const snapshot = await port.inspect(); if (alive.current && ticket === generation.current) setInventory(snapshot); }
    catch { if (alive.current && ticket === generation.current) setFailed(true); }
    finally { if (alive.current && ticket === generation.current) setBusy(false); }
  }, [port]);
  useEffect(() => { alive.current = true; void inspect(); return () => { alive.current = false; generation.current += 1; }; }, [inspect]);
  const editors = inventory?.editors ?? [];
  const others = editors.filter(e => !["2022.3.22f1", "2022.3.22f1c1"].includes(e.version) && !e.version.startsWith("6000."));
  const unity6 = editors.filter(e => e.version.startsWith("6000."));
  const selectedApp = typeof detail === "string" ? inventory?.apps?.find(a => a.component === detail) : null;
  const name = (app: "unity_hub" | "vcc" | "alcom") => app === "unity_hub" ? "Unity Hub" : app === "vcc" ? "VCC" : "ALCOM";
  const config = (presence: CreatorManagers["vcc"]) => presence === "found" ? copy.configFound : presence === "not_found" ? copy.configMissing : presence === "read_failed" ? copy.configFailed : copy.unknown;
  const official = (app: "unity_hub" | "vcc" | "alcom") => app === "unity_hub" ? "https://unity.com/download" : app === "vcc" ? "https://vrchat.com/home/download" : "https://vrc-get.anatawa12.com/alcom/";
  return <div className="vua-page vua-route-page vua-creator-page" data-route-stage={detail === "unity2022" ? "prepare" : "pick"}>
    <header className="vua-page__hero vua-environment-heading"><h1 className="vua-title">{strings.journey.create}</h1><Button variant="subtle" disabled={busy} onClick={() => void inspect()}>{busy ? copy.checking : copy.inspect}</Button></header>
    <section className="vua-environment-section"><h2>{copy.editors}</h2><div className="vua-route-grid vua-route-grid--devices">
      <RouteTile title={strings.journey.unity2022} kind="unity" id="route-unity2022" selected={detail === "unity2022"} expanded={detail === "unity2022"} controls="route-unity2022-details" onClick={() => toggle("unity2022")} />
      <RouteTile title={strings.journey.unity6} kind="unity" id="route-unity6" developing selected={detail === "unity6"} expanded={detail === "unity6"} controls="creator-editor-details" onClick={() => toggle("unity6")} />
      {others.map(e => <RouteTile key={e.path} title={`Unity ${e.version}`} kind="unity" id={`editor-${e.version}`} selected={typeof detail === "object" && detail?.path === e.path} expanded={typeof detail === "object" && detail?.path === e.path} controls="creator-editor-details" onClick={() => toggle(e)} />)}
    </div>{failed || !busy && !inventory?.editorsKnown ? <p role="status">{copy.inventoryUnknown}</p> : !busy && !others.length && !unity6.length ? <p className="vua-caption">{copy.noEditors}</p> : null}</section>
    <section className="vua-environment-section"><h2>{copy.managers}</h2><div className="vua-route-grid vua-manager-grid">
      {(["unity_hub", "vcc", "alcom"] as const).map(app => {
        const found = inventory?.apps?.find(a => a.component === app);
        const status = busy ? copy.checking : failed || !found || found.presence === "unknown" ? copy.unknown : found.presence === "found" ? copy.installed : copy.notFound;
        return <div className="vua-manager-card" data-manager={app} key={app}><RouteTile title={name(app)} kind={app === "unity_hub" ? "unity" : undefined} icon="folder" id={`manager-${app}`} selected={detail === app} expanded={detail === app} controls="creator-editor-details" onClick={() => toggle(app)} /><span className="vua-manager-card__status" role="status">{status}</span></div>;
      })}
    </div></section>
    <section id="route-unity2022-details" className="vua-environment-detail" hidden={detail !== "unity2022"}><header className="vua-environment-heading"><h2>{strings.journey.unity2022}</h2><Button variant="subtle" data-back onClick={() => setDetail(null)}>{copy.closeDetails}</Button></header>
      <div className="vua-route-platform"><Button aria-pressed={purpose === "pc_avatar"} onClick={() => setPurpose("pc_avatar")}>{strings.journey.pcAvatar}</Button><Button aria-pressed={purpose === "quest_avatar"} onClick={() => setPurpose("quest_avatar")}>{strings.journey.questAvatar}</Button></div>
      {unityVisited || detail === "unity2022" ? <DeploymentPanel key={purpose} zone="create" purpose={purpose} /> : null}
    </section>
    {detail && detail !== "unity2022" ? <section id="creator-editor-details" className="vua-environment-detail"><header className="vua-environment-heading"><h2>{detail === "unity6" ? strings.journey.unity6 : typeof detail === "string" ? name(detail) : `Unity ${detail.version}`}</h2><Button variant="subtle" data-back onClick={() => setDetail(null)}>{copy.closeDetails}</Button></header>
      {detail === "unity6" ? <><p>{strings.helpUi.developmentHint}</p>{unity6.map(editor => <p key={editor.path}><strong>Unity {editor.version}</strong><br /><code>{editor.path}</code></p>)}</> : typeof detail === "string" ? <><p>{copy.managerHint}</p>{detail !== "unity_hub" ? <p>{config(inventory?.[detail] ?? null)}</p> : null}{selectedApp?.path ? <><h3>{copy.paths}</h3><code>{selectedApp.path}</code></> : null}<Button onClick={() => void openExternalUrl(official(detail))}>{copy.official}</Button></> : <><p>{copy.otherEditor}</p><code>{detail.path}</code><Button onClick={() => setDetail("unity2022")}>{copy.choose2022}</Button></>}
    </section> : null}
    <section className="vua-environment-section" data-amf-setup><ModulesPage embedded activationSwitch onOpen={onOpenAmf} /></section>
  </div>;
}
