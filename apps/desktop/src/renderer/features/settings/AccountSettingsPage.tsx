import { useEffect, useState } from "react";
import { Badge } from "../../components/primitives/Badge.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { Card } from "../../components/primitives/Card.tsx";
import { openLoginBrowser } from "../../app/login-browser-store.ts";
import { BOOTH_SIGN_IN_URL } from "../import/import-model.ts";
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
  const [authOk, setAuthOk] = useState<boolean | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const refreshAuth = () => {
    setAuthOk(null);
    void window.vua?.remoteContent
      ?.authProbe()
      .then((probe) => setAuthOk(probe.authOk))
      .catch(() => setAuthOk(false));
  };

  useEffect(() => {
    refreshAuth();
  }, []);

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

  return (
    <div className="vua-page">
      <section className="vua-page__hero">
        <h1 className="vua-title">{strings.nav.pages.settingsAccounts}</h1>
      </section>
      <div className="vua-page__stack">
        <Card>
          <div className="vua-settings-account">
            <div className="vua-settings-account__head">
              <h2 className="vua-title">{copy.boothTitle}</h2>
              {authOk === null ? (
                <Badge tone="neutral">{copy.statusUnknown}</Badge>
              ) : authOk ? (
                <Badge tone="success">{copy.statusSignedIn}</Badge>
              ) : (
                <Badge tone="neutral">{copy.statusSignedOut}</Badge>
              )}
            </div>
            <p className="vua-text-secondary">{copy.boothDescription}</p>
            <div className="vua-settings-account__actions">
              <Button
                variant="default"
                onClick={() => openLoginBrowser(BOOTH_SIGN_IN_URL)}
              >
                {copy.signIn}
              </Button>
              <Button variant="subtle" disabled={!authOk || signingOut} onClick={() => void signOut()}>
                {copy.signOut}
              </Button>
            </div>
          </div>
        </Card>
        {([
          { title: copy.steamTitle, description: copy.steamDescription },
          { title: copy.vrchatTitle, description: copy.vrchatDescription },
          { title: copy.unityTitle, description: copy.unityDescription },
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
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
