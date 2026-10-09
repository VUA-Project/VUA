import { RouteTile } from "../../components/RouteTile.tsx";
import { strings } from "../../i18n/index.ts";

/** Accepted inventory is a roadmap, not detected software or executable plugins. */
const groups = [
  { key: "toolTracking", icon: "avatar", tools: ["VRCFaceTracking", "OpenVR Space Calibrator"] },
  { key: "toolTranslation", icon: "question", tools: ["VRCS", "OVR Overlay Translator"] },
  { key: "toolUtilities", icon: "flask", tools: ["OVR Advanced Settings", "OVR Toolkit", "OyasumiVR"] },
  { key: "toolCapture", icon: "anim", tools: ["LIV"] },
] as const;

export function ToolsHub() {
  const copy = strings.journey;
  return <div className="vua-page vua-tools-hub" data-focus-scope>
    <header className="vua-page__hero"><h1 className="vua-title">{copy.tools}</h1><p className="vua-text-secondary">{copy.toolsComingSoon}</p></header>
    {groups.map(group => <section className="vua-environment-section" key={group.key}>
      <h2>{copy[group.key]}</h2>
      <div className="vua-route-grid">{group.tools.map(tool => <RouteTile key={tool} title={tool} icon={group.icon} disabled />)}</div>
    </section>)}
  </div>;
}
