/** 实验性 VRChat 登录(vrchat-session v0.1):设置 → 实验性里的独立卡片。
 * 第一次打开先讲清风险,由玩家接受或保持关闭;登录、验证码、账号卡片都在
 * 这里完成。机密只在表单与主进程之间流动,本组件只见登录态与展示事实。 */
import { useEffect, useState } from "react";
import { Badge } from "../../components/primitives/Badge.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { ConfirmDialog } from "../../components/primitives/ConfirmDialog.tsx";
import { Toggle } from "../../components/primitives/Toggle.tsx";
import { useGateway, type VrchatSignInOutcome, type VrchatStatus, type VrchatTwoFactorMethod } from "../../gateway/index.ts";
import { format, strings } from "../../i18n/index.ts";

const copy = strings.vrchat.settings;

type Feedback = { readonly key: keyof typeof copy.outcomes } | { readonly resent: true } | null;

const isOutcomeKey = (value: string): value is keyof typeof copy.outcomes => value in copy.outcomes;

/** 登录结局落成一句界面话;two_factor_required 与 signed_in 由视图切换承接。 */
function feedbackOf(outcome: VrchatSignInOutcome): Feedback {
  if (outcome.outcome === "signed_in" || outcome.outcome === "two_factor_required") return null;
  if (outcome.outcome === "sent") return { resent: true };
  return isOutcomeKey(outcome.outcome) ? { key: outcome.outcome } : { key: "network" };
}

export function VrchatSignInSection() {
  const gateway = useGateway();
  const vrchat = gateway.vrchat;
  const [status, setStatus] = useState<VrchatStatus | null>(null);
  const [riskOpen, setRiskOpen] = useState(false);
  const [forgetOpen, setForgetOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [code, setCode] = useState("");
  const [methodChoice, setMethodChoice] = useState<VrchatTwoFactorMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    if (vrchat === undefined) return;
    let active = true;
    void vrchat.status().then(value => { if (active) setStatus(value); }, () => { if (active) setStatus(null); });
    return () => { active = false; };
  }, [vrchat]);

  const refresh = async () => {
    try { setStatus(await vrchat?.status() ?? null); } catch { /* keep the last known state */ }
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setFeedback(null);
    try { await work(); } finally { setBusy(false); }
  };

  if (vrchat === undefined) return null;

  const enabled = status?.enabled === true;
  const state = status?.state ?? "signed_out";
  const pending = status?.pendingMethods ?? [];
  const method = methodChoice !== null && pending.includes(methodChoice) ? methodChoice : pending[0] ?? "emailotp";

  return <section className="vua-vrchat" data-state={enabled ? state : "off"}>
    <header className="vua-vrchat__head">
      <div>
        <h2 className="vua-title">{copy.title}</h2>
        <p className="vua-caption vua-text-secondary">{copy.subtitle}</p>
      </div>
      <Toggle on={enabled} disabled={busy} label={copy.title} onToggle={() => {
        if (enabled) {
          void run(async () => { setStatus(await vrchat.setExperimental(false)); setFormOpen(false); });
          return;
        }
        setRiskOpen(true);
      }} />
    </header>

    {enabled ? <>
      {state === "signed_in" && status?.account ? <AccountCard
        busy={busy}
        status={status}
        onForget={() => setForgetOpen(true)}
        onSignOut={() => void run(async () => { setStatus(await vrchat.signOut()); })}
      /> : null}

      {state === "needs_code" ? <div className="vua-vrchat__panel">
        <strong>{method === "emailotp" ? copy.code.emailTitle : method === "totp" ? copy.code.totpTitle : copy.code.otpTitle}</strong>
        {pending.length > 1 ? <p className="vua-vrchat__methods">
          {pending.map(item => <button key={item} type="button" className="vua-vrchat__method" data-active={item === method}
            onClick={() => { setMethodChoice(item); setCode(""); }}>{item === "emailotp" ? copy.code.emailTitle : item === "totp" ? copy.code.totpTitle : copy.code.otpTitle}</button>)}
        </p> : null}
        <form className="vua-vrchat__code" onSubmit={event => {
          event.preventDefault();
          if (code.trim().length === 0 || busy) return;
          void run(async () => {
            const outcome = await vrchat.verifyCode(method, code.trim());
            setFeedback(feedbackOf(outcome));
            if (outcome.outcome === "signed_in") { setCode(""); setMethodChoice(null); }
            await refresh();
          });
        }}>
          <label>
            <span>{copy.code.codeLabel}</span>
            <input value={code} onChange={event => setCode(event.target.value)} inputMode={method === "otp" ? "text" : "numeric"}
              autoComplete="one-time-code" data-nav-id="vrchat-code" />
          </label>
          <Button type="submit" disabled={busy || code.trim().length === 0}>{busy ? copy.code.waiting : copy.code.verify}</Button>
          {method === "emailotp" ? <Button variant="subtle" type="button" disabled={busy} onClick={() => void run(async () => {
            setFeedback(feedbackOf(await vrchat.resendEmailCode()));
          })}>{copy.code.resend}</Button> : null}
          <Button variant="subtle" type="button" disabled={busy} onClick={() => { setCode(""); setFormOpen(true); }}>{copy.cancel}</Button>
        </form>
      </div> : null}

      {state === "signed_out" || (state === "needs_code" && formOpen) ? <div className="vua-vrchat__panel">
        {status?.rememberPassword === true && !formOpen ? <div className="vua-vrchat__relogin">
          <p className="vua-text-secondary">{copy.sessionEnded}</p>
          <div className="vua-vrchat__actions">
            <Button disabled={busy} data-nav-id="vrchat-relogin" onClick={() => void run(async () => {
              setFeedback(feedbackOf(await vrchat.relogin()));
              await refresh();
            })}>{copy.relogin}</Button>
            <Button variant="subtle" disabled={busy} onClick={() => setFormOpen(true)}>{copy.form.submit}</Button>
          </div>
        </div> : <form className="vua-vrchat__form" onSubmit={event => {
          event.preventDefault();
          if (username.trim().length === 0 || password.length === 0 || busy) return;
          void run(async () => {
            const outcome = await vrchat.signIn(username.trim(), password, remember);
            setFeedback(feedbackOf(outcome));
            if (outcome.outcome === "signed_in") { setUsername(""); setPassword(""); setFormOpen(false); }
            await refresh();
          });
        }}>
          <label>
            <span>{copy.form.userLabel}</span>
            <input value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" data-nav-id="vrchat-user" />
          </label>
          <label>
            <span>{copy.form.passwordLabel}</span>
            <input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" data-nav-id="vrchat-password" />
          </label>
          <label className="vua-vrchat__remember">
            <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />
            <span>{copy.form.remember}</span>
          </label>
          <p className="vua-caption vua-text-secondary">{copy.form.rememberHint}</p>
          <div className="vua-vrchat__actions">
            <Button type="submit" disabled={busy || username.trim().length === 0 || password.length === 0} data-nav-id="vrchat-sign-in">
              {busy ? copy.form.working : copy.form.submit}
            </Button>
            {formOpen ? <Button variant="subtle" type="button" disabled={busy} onClick={() => setFormOpen(false)}>{copy.cancel}</Button> : null}
          </div>
        </form>}
      </div> : null}
    </> : null}

    {feedback !== null ? (
      "resent" in feedback
        ? <p className="vua-caption vua-text-secondary" role="status">{copy.code.resent}</p>
        : <p className="vua-caption vua-text-secondary" role="alert">{copy.outcomes[feedback.key]}</p>
    ) : null}

    <ConfirmDialog open={riskOpen} danger title={copy.riskTitle} cancelLabel={copy.riskDecline} confirmLabel={copy.riskAccept}
      onCancel={() => setRiskOpen(false)}
      onConfirm={() => {
        setRiskOpen(false);
        void run(async () => { setStatus(await vrchat.setExperimental(true)); });
      }}>
      <p>{copy.riskBody}</p>
      <p className="vua-text-secondary">{copy.riskKeep}</p>
    </ConfirmDialog>

    <ConfirmDialog open={forgetOpen} danger title={copy.forgetTitle} cancelLabel={copy.cancel} confirmLabel={copy.forgetConfirm}
      onCancel={() => setForgetOpen(false)}
      onConfirm={() => {
        setForgetOpen(false);
        void run(async () => { setStatus(await vrchat.forget()); setFormOpen(false); });
      }}>
      <p>{copy.forgetBody}</p>
    </ConfirmDialog>
  </section>;
}

function AccountCard({ status, busy, onSignOut, onForget }: {
  readonly status: VrchatStatus;
  readonly busy: boolean;
  readonly onSignOut: () => void;
  readonly onForget: () => void;
}) {
  const account = status.account;
  return <div className="vua-vrchat__account">
    {account?.thumbnail ? <img className="vua-vrchat__thumb" src={account.thumbnail} alt="" /> : <span className="vua-vrchat__thumb vua-vrchat__thumb--empty" aria-hidden="true" />}
    <div className="vua-vrchat__who">
      <span>{format(copy.displayName, { name: account?.displayName ?? "" })}</span>
      <Badge tone={status.state === "signed_in" ? "success" : "neutral"}>
        {status.state === "signed_in" ? copy.signedIn : status.state === "needs_code" ? copy.needsCode : copy.signedOut}
      </Badge>
    </div>
    <div className="vua-vrchat__actions">
      <Button variant="subtle" disabled={busy} data-nav-id="vrchat-sign-out" onClick={onSignOut}>{copy.signOut}</Button>
      <Button variant="subtle" disabled={busy} data-nav-id="vrchat-forget" onClick={onForget}>{copy.forget}</Button>
    </div>
  </div>;
}
