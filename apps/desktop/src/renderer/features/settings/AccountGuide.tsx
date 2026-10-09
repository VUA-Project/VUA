import { useState } from "react";
import { ACCOUNT_GUIDE_URLS, type AccountGuideIdV1 } from "@vua/contracts";
import { strings } from "../../i18n/index.ts";
import { Button } from "../../components/primitives/Button.tsx";
const copy = strings.journey;
export function AccountGuide({ account, onBack }: { account: AccountGuideIdV1; onBack: () => void }) {
  const [openFailed, setOpenFailed] = useState(false);
  const title = account === "linking" ? copy.linking : `${({ steam: "Steam", vrchat: "VRChat", unity: "Unity", booth: "BOOTH / pixiv" })[account]} · ${copy.registration}`;
  const paragraphs = account === "steam" ? strings.guide.pages.start.sections.find(s => s.id === "steam-account")?.paragraphs
    : account === "linking" ? [strings.guide.pages.start.sections.find(s => s.id === "first-launch")?.paragraphs.at(-1) ?? copy.linkingHint]
    : copy.registrationSteps;
  const open = async () => {
    setOpenFailed(false);
    try {
      const port = window.vua?.remoteContent?.openAccountGuideInBrowser;
      if (port) await port(account);
      else if (window.vua || window.open(ACCOUNT_GUIDE_URLS[account], "_blank") === null) setOpenFailed(true);
    } catch { setOpenFailed(true); }
  };
  return <section className="vua-journey-actions" data-focus-scope>
    <Button variant="subtle" data-back onClick={onBack}>{copy.back}</Button><h2>{title}</h2>
    <ol>{paragraphs?.map((text, index) => <li key={index}><p>{text}</p></li>)}</ol>
    <Button variant="primary" onClick={() => { void open(); }}>{copy.official}</Button>
    <p>{copy.registrationHint}</p>{openFailed ? <p role="status">{copy.linkFailed}</p> : null}
  </section>;
}
