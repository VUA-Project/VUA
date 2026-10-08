import type { PageId } from "../../app/nav-model.ts";
import { strings } from "../../i18n/index.ts";
import { RouteTile } from "../../components/RouteTile.tsx";
const copy = strings.journey;
export const directory = {
  env: [{ id: "env-play", title: copy.play, icon: "anim" }, { id: "env-create", title: copy.create, icon: "flask" }, { id: "software", title: copy.software, icon: "gauge" }],
  production: [{ id: "warehouse", title: copy.library, icon: "folder" }, { id: "recipe", title: copy.recipes, icon: "outfit" }, { id: "workshop", title: copy.production, icon: "avatar" }, { id: "inspection", title: strings.terms.inspection, icon: "check" }],
} as const;
export function HomePage({ page, bigscreen, navigate, startWizard, startTour }: {
  page: "home" | "environment-hub" | "avatar-hub" | "help"; bigscreen: boolean;
  navigate: (page: PageId) => void; startWizard: () => void; startTour: () => void;
}) {
  const global = <div className="vua-route-grid vua-home__global">
    <RouteTile title={copy.tasks} icon="clock" onClick={() => void window.vua?.window.showOverlay("status")} id="home-tasks" />
    <RouteTile title={copy.help} icon="question" onClick={() => navigate("help")} id="home-help" />
    <RouteTile title={strings.nav.tabs.settings} icon="edit" onClick={() => navigate("settings-theme")} id="home-settings" />
  </div>;
  return <div className="vua-page vua-home" data-focus-scope>
    <header className="vua-page__hero"><h1 className="vua-display">{page === "home" ? "VUA" : page === "environment-hub" ? copy.environment : page === "avatar-hub" ? copy.avatar : copy.help}</h1></header>
    {page === "help" ? <div className="vua-route-grid">
      <RouteTile title={copy.wizard} icon="arrow-right" onClick={startWizard} id="help-wizard" />
      <RouteTile title={strings.tour.paletteEntry} icon="question" onClick={startTour} />
      <RouteTile title={copy.guide} icon="folder" onClick={() => void window.vua?.window.showReader()} />
      <RouteTile title={copy.gameGuide} icon="anim" onClick={() => void window.vua?.window.showGameGuide()} />
    </div> : <>
      {page === "home" && bigscreen ? <div className="vua-route-grid vua-home__groups">
        <RouteTile title={copy.environment} icon="flask" onClick={() => navigate("environment-hub")} id="home-environment" />
        <RouteTile title={copy.avatar} icon="avatar" onClick={() => navigate("avatar-hub")} id="home-avatar" />
      </div> : (["env", "production"] as const).filter(group => page === "home" || (page === "environment-hub" ? group === "env" : group === "production")).map(group => <section key={group} className="vua-home__section" data-module={group}>
        <h2>{group === "env" ? copy.environment : copy.avatar}</h2><div className="vua-route-grid">
          {directory[group].map(item => <RouteTile key={item.id} title={item.title} icon={item.icon} onClick={() => navigate(item.id)} id={`home-${item.id}`} />)}
        </div>
      </section>)}
      {page === "avatar-hub" ? <div className="vua-route-grid">
        <RouteTile title={strings.nav.pages.packages} icon="folder" onClick={() => navigate("packages")} />
        <RouteTile title={strings.terms.release} icon="anim" onClick={() => navigate("release")} />
      </div> : null}
      {page === "home" ? global : null}
    </>}
  </div>;
}
