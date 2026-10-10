import { useState } from "react";
import { SiteBrowser } from "../../components/SiteBrowser.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { strings } from "../../i18n/index.ts";

export function AssetBrowserPage() {
  const [open, setOpen] = useState(true);
  return <div className="vua-page" data-focus-scope>
    <header className="vua-page__hero"><h1 className="vua-title">{strings.browser.assets}</h1></header>
    {open ? <SiteBrowser purpose="assets" onClose={() => setOpen(false)} />
      : <Button variant="primary" onClick={() => setOpen(true)}>{strings.browser.reopen}</Button>}
  </div>;
}
