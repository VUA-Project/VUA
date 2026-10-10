import { useState } from "react";
import { EnvironmentCard } from "../home/EnvironmentCard.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { strings } from "../../i18n/index.ts";
import { VrcftCard } from "./VrcftCard.tsx";

/** VRCFT is connected; the other accepted tools retain their roadmap entrances. */
const groups = [
  { key: "toolTracking", icon: "avatar", tools: [{ id: "vrcft", title: "VRCFaceTracking" }, { id: "space", title: "OpenVR Space Calibrator" }] },
  { key: "toolTranslation", icon: "question", tools: [{ id: "vrcs", title: "VRCS" }, { id: "translator", title: "OVR Overlay Translator" }] },
  { key: "toolUtilities", icon: "flask", tools: [{ id: "advanced", title: "OVR Advanced Settings" }, { id: "toolkit", title: "OVR Toolkit" }, { id: "oyasumi", title: "OyasumiVR" }] },
  { key: "toolCapture", icon: "anim", tools: [{ id: "liv", title: "LIV" }] },
] as const;

export function ToolsHub({ onPrepareSteam }: { onPrepareSteam(): void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const copy = strings.journey;
  return <div className="vua-page vua-route-page vua-tools-hub vua-compact-environments" data-focus-scope>
    <header className="vua-page__hero"><h1 className="vua-title">{copy.tools}</h1></header>
    {groups.map(group => <section className="vua-environment-section" key={group.key}>
      <h2>{copy[group.key]}</h2>
      <div className="vua-environment-grid">{group.tools.map(tool => <div className="vua-card-entry" data-card-entry={`tool-${tool.id}`} key={tool.id}>
        {tool.id === "vrcft" ? <VrcftCard selected={selected === tool.id} onDetails={() => setSelected(current => current === tool.id ? null : tool.id)} onReveal={() => setSelected(tool.id)} onPrepareSteam={onPrepareSteam} /> : <>
        <EnvironmentCard title={tool.title} icon={group.icon} id={`tool-${tool.id}`} action="unknown" status="" developing selected={selected === tool.id} onDetails={() => setSelected(current => current === tool.id ? null : tool.id)} />
        <section id={`tool-${tool.id}-details`} className="vua-environment-detail" hidden={selected !== tool.id} aria-label={tool.title}>
      <header className="vua-environment-heading"><h2>{tool.title}</h2><Button variant="subtle" data-back onClick={() => setSelected(null)}>{strings.environmentCards.closeDetails}</Button></header>
      <p>{strings.helpUi[tool.id]}</p><p className="vua-text-secondary">{strings.helpUi.developmentHint}</p>
      </section></> }</div>)}</div>
    </section>)}
  </div>;
}
