import type { PageId } from "../../app/nav-model.ts";
import { strings } from "../../i18n/index.ts";
import { RouteTile } from "../../components/RouteTile.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { GuideOverlayView, type GuideRequest } from "../overlay/GuideOverlayView.tsx";
import "../overlay/overlay.css";
import "./help.css";

export function HelpPage({ page, navigate, startWizard, startTour, guideRequest, acknowledgeGuide }: {
  page: "help" | "help-encyclopedia";
  navigate: (page: PageId) => void;
  startWizard: () => void;
  startTour: () => void;
  guideRequest: GuideRequest | null;
  acknowledgeGuide: (nonce: number) => void;
}) {
  const copy = strings.journey;
  if (page === "help-encyclopedia") return <div className="vua-page vua-knowledge" data-focus-scope>
    <header className="vua-page__hero vua-environment-heading">
      <h1 className="vua-title">{copy.guide}</h1>
      <Button variant="subtle" data-back data-nav-id="knowledge-back" onClick={() => navigate("help")}>{copy.backToHelp}</Button>
    </header>
    <div className="vua-overlay__body vua-knowledge__body">
      <GuideOverlayView embedded guideRequest={guideRequest} onGuideRequestApplied={acknowledgeGuide} />
    </div>
  </div>;
  return <div className="vua-page vua-help" data-focus-scope>
    <header className="vua-page__hero"><h1 className="vua-title">{copy.help}</h1></header>
    <div className="vua-route-grid">
      <RouteTile title={copy.wizard} icon="arrow-right" onClick={startWizard} id="help-wizard" />
      <RouteTile title={strings.tour.paletteEntry} icon="question" onClick={startTour} id="help-tour" />
      <RouteTile title={copy.guide} icon="folder" onClick={() => navigate("help-encyclopedia")} id="help-encyclopedia" />
      <RouteTile title={copy.gameGuide} icon="anim" onClick={() => void window.vua?.window.showGameGuide()} id="help-game-assistant" />
    </div>
  </div>;
}
