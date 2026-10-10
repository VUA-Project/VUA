import type { PageId } from "../../app/nav-model.ts";
import { strings, TERMS } from "../../i18n/index.ts";
import { RouteTile } from "../../components/RouteTile.tsx";
const copy = strings.journey;
export const directory = {
  env: [{ id: "env-play", title: copy.play, icon: "anim" }, { id: "tools-discover", title: copy.tools, icon: "outfit" }, { id: "env-create", title: copy.create, icon: "flask" }, { id: "help", title: copy.help, icon: "question" }],
  production: [{ id: "warehouse", title: copy.library, icon: "folder" }, { id: "recipe", title: copy.recipes, icon: "outfit" }, { id: "workshop", title: copy.production, icon: "avatar" }, { id: "release", title: strings.nav.pages.release, icon: "anim" }, { id: "packages", title: strings.nav.pages.packages, icon: "folder" }],
} as const;
export function HomePage({ page, navigate, amfInstalled = false }: {
  page: "home" | "environment-hub" | "avatar-hub";
  navigate: (page: PageId) => void; amfInstalled?: boolean;
}) {
  const global = <div className="vua-route-grid vua-home__global">
    <RouteTile title={copy.tasks} icon="clock" onClick={() => void window.vua?.window.showOverlay("status")} id="home-tasks" />
    <RouteTile title={strings.amfModule.title} icon="folder" onClick={() => navigate("settings-modules")} id="home-modules" />
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
