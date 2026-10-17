import type { PageId } from "../../app/nav-model.ts";
import { strings, TERMS } from "../../i18n/index.ts";
import { RouteTile } from "../../components/RouteTile.tsx";
const copy = strings.journey;
export const directory = {
  env: [{ id: "env-play", title: copy.play, icon: "anim" }, { id: "tools-discover", title: copy.tools, icon: "outfit" }, { id: "env-create", title: copy.create, icon: "flask" }],
  // The factory rooms (2026-10-17 author ruling): each room holds the pages listed in pages. The control
  // center comes first, right under AMF (author ruling 2026-10-18).
  production: [{ id: "recipe", title: strings.factory.rooms.control.name, icon: "edit", pages: ["recipe", "packages"] }, { id: "warehouse", title: strings.factory.rooms.materials.name, icon: "folder", pages: ["warehouse", "asset-browser"] }, { id: "workshop", title: strings.factory.rooms.workshop.name, icon: "avatar", pages: ["workshop", "inspection"] }, { id: "release", title: strings.factory.rooms.release.name, icon: "anim", pages: ["release"] }],
} as const;
export function HomePage({ page, navigate, amfInstalled = false }: {
  page: "home" | "environment-hub" | "avatar-hub";
  navigate: (page: PageId) => void; amfInstalled?: boolean;
}) {
  const global = <div className="vua-route-grid vua-home__global">
    <RouteTile title={strings.amfModule.title} icon="folder" onClick={() => navigate("settings-modules")} id="home-modules" />
    <RouteTile title={copy.help} icon="question" onClick={() => navigate("help")} id="home-help" />
    <RouteTile title={strings.nav.tabs.settings} icon="edit" onClick={() => navigate("settings-theme")} id="home-settings" />
  </div>;
  return <div className="vua-page vua-home" data-focus-scope>
    <header className="vua-page__hero"><h1 className="vua-display">{page === "home" ? "VUA" : page === "environment-hub" ? copy.environment : copy.avatar}</h1></header>
    <>
      {(["env", "production"] as const).filter(group => (group !== "production" || amfInstalled) && (page === "home" || (page === "environment-hub" ? group === "env" : group === "production"))).map(group => <section key={group} className="vua-home__section" data-module={group}>
        <h2>{group === "env" ? copy.environment : TERMS.amf}</h2><div className="vua-route-grid">
          {directory[group].map(item => <RouteTile key={item.id} title={item.title} icon={item.icon} onClick={() => navigate(item.id)} id={`home-${item.id}`} />)}
        </div>
      </section>)}
      {page === "home" ? global : null}
    </>
  </div>;
}
