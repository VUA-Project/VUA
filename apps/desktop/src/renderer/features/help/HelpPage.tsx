import type { PageId } from "../../app/nav-model.ts";
import { useEffect, useState } from "react";
import { strings } from "../../i18n/index.ts";
import { RouteTile } from "../../components/RouteTile.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { GuideOverlayView, type GuideRequest } from "../overlay/GuideOverlayView.tsx";
import { OnboardingPage } from "../onboarding/OnboardingPage.tsx";
import "../overlay/overlay.css";
import "./help.css";
import { SiteBrowser } from "../../components/SiteBrowser.tsx";

export function HelpPage({ page, navigate, onAccounts, startTour, guideRequest, acknowledgeGuide }: {
  page: "help" | "help-wizard" | "help-tour" | "help-game-assistant" | "help-encyclopedia";
  navigate: (page: PageId) => void;
  onAccounts: () => void;
  startTour: () => void;
  guideRequest: GuideRequest | null;
  acknowledgeGuide: (nonce: number) => void;
}) {
  const copy = strings.journey;
  const [openFailed, setOpenFailed] = useState(false);
  const [wikiOpen, setWikiOpen] = useState(false);
  useEffect(() => { setWikiOpen(false); }, [guideRequest?.nonce]);
  const back = <Button variant="subtle" data-back data-nav-id="help-child-back" onClick={() => navigate("help")}>{copy.backToHelp}</Button>;
  if (page === "help-encyclopedia") return <div className="vua-page vua-knowledge" data-focus-scope>
    <header className="vua-page__hero vua-environment-heading">
      <h1 className="vua-title">{copy.guide}</h1>
      <Button data-nav-id="knowledge-wiki" onClick={() => setWikiOpen(true)}>{strings.browser.wiki}</Button>
      {back}
    </header>
    <div className="vua-overlay__body vua-knowledge__body">
      <GuideOverlayView embedded guideRequest={guideRequest} onGuideRequestApplied={acknowledgeGuide} />
    </div>
    {wikiOpen ? <SiteBrowser purpose="knowledge" onClose={() => setWikiOpen(false)} /> : null}
  </div>;
  if (page === "help-wizard") return <div className="vua-page vua-help-child" data-focus-scope>
    <header className="vua-page__hero vua-environment-heading"><h1 className="vua-title">{copy.wizard}</h1>{back}</header>
    <OnboardingPage embedded onAccounts={onAccounts} onComplete={result => navigate(result.page ?? "help")} />
  </div>;
  if (page === "help-tour" || page === "help-game-assistant") return <div className="vua-page vua-help-child" data-focus-scope>
    <header className="vua-page__hero vua-environment-heading"><h1 className="vua-title">{page === "help-tour" ? strings.tour.paletteEntry : copy.gameGuide}</h1>{back}</header>
    <section className="vua-environment-detail">
      <p>{page === "help-tour" ? strings.helpUi.tourHint : strings.helpUi.gameHint}</p>
      <div><Button variant="primary" data-nav-id={page === "help-tour" ? "help-start-tour" : "help-open-game"} onClick={() => {
        if (page === "help-tour") startTour();
        else {
          setOpenFailed(false);
          const request = window.vua?.window.showGameGuide();
          if (!request) setOpenFailed(true);
          else void request.catch(() => setOpenFailed(true));
        }
      }}>{page === "help-tour" ? strings.helpUi.startTour : strings.helpUi.openGame}</Button></div>
      {openFailed ? <p role="status">{strings.helpUi.openFailed}</p> : null}
    </section>
  </div>;
  return <div className="vua-page vua-help" data-focus-scope>
    <header className="vua-page__hero"><h1 className="vua-title">{copy.help}</h1></header>
    <div className="vua-route-grid">
      <RouteTile title={copy.wizard} icon="arrow-right" onClick={() => navigate("help-wizard")} id="help-wizard" />
      <RouteTile title={strings.tour.paletteEntry} icon="question" onClick={() => navigate("help-tour")} id="help-tour" />
      <RouteTile title={copy.guide} icon="folder" onClick={() => navigate("help-encyclopedia")} id="help-encyclopedia" />
      <RouteTile title={copy.gameGuide} icon="anim" onClick={() => navigate("help-game-assistant")} id="help-game-assistant" />
    </div>
  </div>;
}
