import { strings, format, termLabel } from "../../i18n/index.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { openExternalUrl } from "../../app/open-external.ts";
import { ACCOUNT_GUIDE_URLS } from "@vua/contracts";
const copy = strings.unityLicense;
const text = (value: string) => format(value, { amf: termLabel("amf") });
export function UnityLicenseGuide() {
  return <div className="vua-unity-license-guide">
    <p>{copy.intro}</p>
    <ol>{[copy.register, copy.hub, copy.activate, copy.locate, copy.resume].map((paragraph, i) => <li key={i}><p>{text(paragraph)}</p></li>)}</ol>
    <p>{text(copy.expected)}</p>
    <div className="vua-ai-tools__controls">
      <Button onClick={() => void openExternalUrl(ACCOUNT_GUIDE_URLS.unity)}>{copy.account}</Button>
      <Button onClick={() => void openExternalUrl("https://unity.com/download")}>{copy.download}</Button>
      <Button variant="subtle" onClick={() => void openExternalUrl("https://unity.com/pages/license-compliance")}>{copy.policy}</Button>
      <Button variant="subtle" onClick={() => void openExternalUrl("https://docs.unity3d.com/2022.3/Documentation/Manual/LicenseActivationMethods.html")}>{copy.official}</Button>
    </div>
    <p className="vua-caption">{copy.noBypass}</p>
  </div>;
}
