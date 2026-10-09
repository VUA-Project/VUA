import { useAmfModule } from "../../gateway/index.ts";
import { useEffect, useState } from "react";
import { Badge } from "../../components/primitives/Badge.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { Card } from "../../components/primitives/Card.tsx";
import { openLoginBrowser } from "../../app/login-browser-store.ts";
import { BOOTH_SIGN_IN_URL } from "../import/import-model.ts";
import { openExternalUrl } from "../../app/open-external.ts";
import { AccountGuide } from "./AccountGuide.tsx";
import { useRouteFocus } from "../../app/use-route-focus.ts";
import { strings } from "../../i18n/index.ts";

const copy = strings.settings.accounts;

/**
 * 账号管理(用户裁决 2026-10-05):四家账号卡片——Steam / VRChat /
 * Booth・pixiv / Unity。本批只接线 Booth/Pixiv:登录走窗口级登录浏览器,
 * 登出清空分区别会话存储(Cookie/本地存储/认证缓存)并关闭打开中的远程
 * 视图;登录态显示用真实判据(authProbe = 此刻会话能否读到账号库,
 * cookie 线索会被半登录会话误报)。其余三家仅占位 UI,诚实「尚未接入」,
 * 按钮禁用不猜状态。
 */
export function AccountSettingsPage() {
  const amf = useAmfModule();
  const [auth, setAuth] = useState<
    { authOk: boolean; accountName: string | null } | null
  >(null);
  const [guide, setGuide] = useState<"steam" | "vrchat" | "unity" | "booth" | "linking" | null>(null);
  const focus = useRouteFocus(guide ?? "accounts");
  const [signingOut, setSigningOut] = useState(false);

  const refreshAuth = () => {
    setAuth(null);
    void window.vua?.remoteContent
      ?.authProbe()
      .then((probe) => setAuth({ authOk: probe.authOk, accountName: probe.accountName }))
      .catch(() => setAuth({ authOk: false, accountName: null }));
  };

  useEffect(() => {
    if (amf.state === "ready") refreshAuth();
    else setAuth(null);
  }, [amf.state]);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await window.vua?.remoteContent?.signOut();
    } catch {
      /* 登出失败:如实回到检测态,不猜结果 */
    } finally {
      setSigningOut(false);
      refreshAuth();
    }
  };

  const signedIn = auth?.authOk === true;

  return (
    <div className="vua-page" ref={focus.root} onClickCapture={focus.remember}>
      <section className="vua-page__hero">
        <h1 className="vua-title">{strings.nav.pages.settingsAccounts}</h1>
      </section>
      {guide ? <AccountGuide account={guide} onBack={() => setGuide(null)} /> : null}
      <div className="vua-account-grid" hidden={guide !== null}>
        {amf.installed ? <Card>
          <div className="vua-settings-account">
            <div className="vua-settings-account__head">
              <h2 className="vua-title">{copy.boothTitle}</h2>
              {auth === null ? (
                <Badge tone="neutral">{copy.statusUnknown}</Badge>
              ) : signedIn ? (
                <Badge tone="success">
                  {copy.statusSignedIn}
                  {auth.accountName !== null ? ` · ${auth.accountName}` : ""}
                </Badge>
              ) : (
                <Badge tone="neutral">{copy.statusSignedOut}</Badge>
              )}
            </div>
            <p className="vua-text-secondary">{copy.boothDescription}</p>
            <div className="vua-settings-account__actions">
              {/* 已登录不渲染登录钮(用户裁决 2026-10-05):残留可点的
                  登录入口只会把已登录会话带进库页 */}
              {signedIn ? null : (
                <Button
                  variant="default"
                  disabled={amf.state !== "ready"}
                  onClick={() => openLoginBrowser(BOOTH_SIGN_IN_URL)}
                >
                  {copy.signIn}
                </Button>
              )}
              <Button data-nav-id="register-booth" onClick={() => setGuide("booth")}>{strings.journey.registration}</Button>
              <Button variant="subtle" disabled={!signedIn || signingOut} onClick={() => void signOut()}>
                {copy.signOut}
              </Button>
            </div>
          </div>
        </Card> : null}
        {([
          { id: "steam", title: copy.steamTitle, description: copy.steamDescription },
          { id: "vrchat", title: copy.vrchatTitle, description: copy.vrchatDescription },
          { id: "unity", title: copy.unityTitle, description: copy.unityDescription },
        ] as const).map((placeholder) => (
          <Card key={placeholder.title}>
            <div className="vua-settings-account">
              <div className="vua-settings-account__head">
                <h2 className="vua-title">{placeholder.title}</h2>
                <Badge tone="neutral">{copy.notWired}</Badge>
              </div>
              <p className="vua-text-secondary">{placeholder.description}</p>
              <div className="vua-settings-account__actions">
                <Button variant="default" disabled>
                  {copy.signIn}
                </Button>
                <Button data-nav-id={`register-${placeholder.id}`} onClick={() => setGuide(placeholder.id)}>{strings.journey.registration}</Button>
                {placeholder.id === "vrchat" ? <Button data-nav-id="register-linking" onClick={() => setGuide("linking")}>{strings.journey.linking}</Button> : null}
                {placeholder.id === "steam" ? <Button onClick={() => void openExternalUrl("steam://nav/games/details/438100")}>{strings.journey.openSteam}</Button> : null}

              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
