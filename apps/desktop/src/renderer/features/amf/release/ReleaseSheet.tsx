/** The right album page: what the Avatar is, its checks, and its upload to VRChat. */
import { useState, type ReactNode } from "react";
import { toast } from "../../../components/primitives/toast-store.ts";
import { Icon } from "@vua/design-system";
import { AMF_LOCAL_TEST_STAGES, AMF_UPLOAD_STAGES, type AmfLocalTest, type AmfProductionRun, type AmfReleaseState, type AmfSdkIssue, type AmfUpload, type VrchatAvatarCheck } from "../../../gateway/index.ts";
import { format, formatDateTime, strings } from "../../../i18n/index.ts";
import { UploadEligibilityNote } from "../../help/UploadEligibilityNote.tsx";
import { sdkMessageKey } from "./sdk-messages.ts";
import { UploadGuide, scrollToUploadGuide } from "./UploadGuide.tsx";
import { outfitLines, releaseChecks, runningLocalTest, runningUpload, sdkReviewView, uploadedAvatarId, type CheckLine } from "./release-model.ts";

const copy = strings.releaseRoom;
const vrchatCopy = strings.vrchat.release;
const sdkCopy = strings.sdkReview;
const time = (iso: string | null | undefined) => (iso && !Number.isNaN(Date.parse(iso)) ? formatDateTime(iso) : "");

/** This Avatar's work waiting behind the running job. */
export interface QueuedWork {
  readonly operation: string;
  /** Unity tasks ahead of this one. */
  readonly ahead: number;
  readonly onRemove: () => void;
}

export interface SheetActions {
  /** This Avatar's own work runs or waits. */
  readonly busy: boolean;
  /** An upload of this Avatar runs or waits; another upload would repeat it. */
  readonly uploadBlocked?: boolean;
  /** A local test build of this Avatar runs or waits. */
  readonly localTestBlocked?: boolean;
  /** Another line's work runs; what this page starts now waits for it. */
  readonly otherWork?: boolean;
  readonly queued?: QueuedWork | null;
  readonly onUpload: () => void;
  readonly onLocalTest?: () => void;
  /** The work project is gone: the Avatar can be built again from its materials or saved Recipe. */
  readonly onNewLine?: () => void;
  readonly onRebuildRecipe?: () => void;
  readonly onStop: () => void;
  readonly onCheckAgain: () => void;
  /** Runs the SDK's own Auto Fix for the chosen items. */
  readonly onSdkFix?: (fixes: readonly string[]) => void;
}

/** Work of this Avatar that waits for the running job, with its remove action. */
function QueuedNotice({ queued }: { queued: QueuedWork }) {
  const work = copy.queue.work[queued.operation.replace(/^amf\.production\./u, "") as keyof typeof copy.queue.work] ?? copy.queue.work.other;
  return <div className="vua-release-upload__queued" role="status">
    <span><Icon name="clock" size={16} />{format(copy.queue.waiting, { work, count: queued.ahead })}</span>
    <button type="button" className="vua-release-upload__link" onClick={queued.onRemove} data-nav-id="release-queue-remove">{copy.queue.remove}</button>
  </div>;
}

/** How this upload's SDK sign-in happened, as one plain line; unknown stays unsaid. */
function SdkSignInLine({ sdkSignIn }: { sdkSignIn: "vua_session" | "panel" | null | undefined }) {
  if (sdkSignIn == null) return null;
  return <small className="vua-text-secondary">{vrchatCopy.sdkSignIn[sdkSignIn]}</small>;
}

/** The uploaded Avatar as VRChat lists it: found, waiting to appear, or unreadable. */
function AvatarCheckBlock({ check, onRefresh, busy }: { check: VrchatAvatarCheck | null; onRefresh?: () => void; busy: boolean }) {
  const fields = vrchatCopy.fields;
  return <div className="vua-vrchat-check" data-state={check?.state ?? "waiting"} role="status">
    <span className="vua-vrchat-check__title"><Icon name="cloud" size={16} />{vrchatCopy.onVrchat}</span>
    {check === null ? <span className="vua-text-secondary">{vrchatCopy.checking}</span> : check.state === "found" && check.avatar ? <>
      <strong>{vrchatCopy.found}</strong>
      <dl>
        <div><dt>{fields.name}</dt><dd>{check.avatar.name}</dd></div>
        <div><dt>{fields.releaseStatus}</dt><dd>{vrchatCopy.releaseStatus[check.avatar.releaseStatus as keyof typeof vrchatCopy.releaseStatus] ?? check.avatar.releaseStatus}</dd></div>
        {check.avatar.platforms.length > 0 ? <div><dt>{fields.platforms}</dt>
          <dd>{check.avatar.platforms.map(platform => vrchatCopy.platform[platform as keyof typeof vrchatCopy.platform] ?? platform).join(" · ")}</dd></div> : null}
        <div><dt>{fields.updatedAt}</dt><dd>{time(check.avatar.updatedAt)}</dd></div>
        <div><dt>{fields.checkedAt}</dt><dd>{time(check.checkedAt)}</dd></div>
      </dl>
    </> : check.state === "not_found" ? <span className="vua-text-secondary">{vrchatCopy.notFound}</span>
      : check.state === "signed_out" ? <span className="vua-text-secondary">{vrchatCopy.signedOut}</span>
        : <span className="vua-text-secondary">{vrchatCopy.checkError}</span>}
    {onRefresh && <button type="button" className="vua-release-upload__link" onClick={onRefresh} disabled={busy}>{vrchatCopy.refresh}</button>}
  </div>;
}

/** SDK items in plain words where VUA knows the message, with the SDK's own sentence one click away. */
function SdkIssues({ issues, icon }: { issues: readonly AmfSdkIssue[]; icon: "error-circle" | "warning" | "question" }) {
  return <ul className="vua-album__checks">{issues.map(issue => {
    const plain = sdkMessageKey(issue.text);
    return <li key={issue.text} data-state={icon === "question" ? "info" : "attention"}>
      <Icon name={icon} size={16} /><span><span>{plain ? sdkCopy.messages[plain] : <span lang="en">{issue.text}</span>}
        {issue.canFix && <small className="vua-sdk-review__fix">{sdkCopy.sdkFix}</small>}</span>
        {plain && <details className="vua-sdk-review__original"><summary>{sdkCopy.original}</summary><span lang="en">{issue.text}</span></details>}</span></li>;
  })}</ul>;
}

/** The SDK's Auto Fix for the items it offers one for, after the player reads what happens. */
function SdkFix({ items, busy, onFix }: { items: readonly AmfSdkIssue[]; busy: boolean; onFix: (fixes: readonly string[]) => void }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  if (!open) return <button type="button" className="vua-sdk-review__fix-button" disabled={busy} onClick={() => setOpen(true)} data-nav-id="release-sdk-fix">
    <Icon name="edit" size={16} />{format(sdkCopy.fixButton, { count: String(items.length) })}</button>;
  return <div className="vua-sdk-review__fix-confirm" role="group" aria-label={sdkCopy.fixTitle}>
    <strong>{sdkCopy.fixTitle}</strong>
    <p className="vua-caption">{sdkCopy.fixBody}</p>
    <ul>{items.map(item => <li key={item.text} lang="en">{item.text}</li>)}</ul>
    <div className="vua-sdk-review__fix-actions">
      <button type="button" className="vua-sdk-review__fix-button" disabled={busy} onClick={() => { setOpen(false); onFix(items.map(item => item.text)); }}>{sdkCopy.fixConfirm}</button>
      <button type="button" className="vua-release-upload__link" onClick={() => setOpen(false)}>{sdkCopy.fixCancel}</button>
    </div>
  </div>;
}

/** The SDK panel's own checks and performance rank, grouped by what the player does next. */
function SdkReviewBlock({ run, busy, onFix, onCheckAgain }: { run: AmfProductionRun; busy: boolean; onFix?: (fixes: readonly string[]) => void; onCheckAgain?: () => void }) {
  const view = sdkReviewView(run);
  const again = onCheckAgain && <button type="button" className="vua-release-upload__link" disabled={busy} onClick={onCheckAgain} data-nav-id="release-sdk-recheck">{sdkCopy.checkAgain}</button>;
  // An Avatar checked before the SDK checks existed reads them at its next check.
  if (!view) return run.result?.facts ? <section className="vua-album__block vua-sdk-review">
    <h3>{sdkCopy.title}</h3><p className="vua-caption vua-text-secondary">{sdkCopy.notRun}</p>{again}</section> : null;
  const clear = view.mustFix.length === 0 && view.reminders.length === 0;
  const hasItems = view.mustFix.length + view.reminders.length + view.rankItems.length + view.notes.length > 0;
  const fixable = [...view.mustFix, ...view.reminders].filter(issue => issue.canFix);
  const applied = run.result?.facts?.sdkFixesApplied?.length ?? 0;
  return <section className="vua-album__block vua-sdk-review">
    <h3>{sdkCopy.title}</h3>
    {view.state === "not_run" ? <p className="vua-caption vua-text-secondary">{sdkCopy.notRun}</p> : <>
      {view.overall && <div className="vua-sdk-review__rank" data-rating={view.overall}>
        <Icon name="gauge" size={20} />
        <span><strong>{format(sdkCopy.rank, { platform: sdkCopy.platforms[view.platform], rating: sdkCopy.ratings[view.overall] })}</strong>
          <small>{sdkCopy.rankMeaning[view.overall]}</small></span>
      </div>}
      {view.state === "unavailable" ? <p className="vua-caption vua-text-secondary">{sdkCopy.unavailable}</p> : <>
        {view.mustFix.length > 0 && <div className="vua-sdk-review__group" data-group="must-fix">
          <h4>{sdkCopy.mustFix}</h4>
          <SdkIssues issues={view.mustFix} icon="error-circle" /></div>}
        {view.reminders.length > 0 && <div className="vua-sdk-review__group" data-group="reminders">
          <h4>{sdkCopy.reminders}</h4><p className="vua-caption vua-text-secondary">{sdkCopy.remindersHint}</p>
          <SdkIssues issues={view.reminders} icon="warning" /></div>}
        {clear && <p className="vua-sdk-review__clear"><Icon name="check" size={16} />{sdkCopy.allClear}</p>}
        {applied > 0 && <p className="vua-caption vua-text-secondary">{format(sdkCopy.fixApplied, { count: String(applied) })}</p>}
        {onFix && <SdkFix items={fixable} busy={busy} onFix={onFix} />}
        {view.state === "partial" && <p className="vua-caption vua-text-secondary">{sdkCopy.partial}</p>}
      </>}
      {view.rankItems.length > 0 && <div className="vua-sdk-review__group" data-group="rank">
        <h4>{sdkCopy.rankItems}</h4>
        <ul className="vua-album__checks">{view.rankItems.map(stat => <li key={stat.category} data-state="attention" data-rating={stat.rating}>
          <Icon name="gauge" size={16} /><span><strong>{sdkCopy.categories[stat.category] ?? stat.category}</strong> · {sdkCopy.ratings[stat.rating]}
            {stat.text && <small lang="en">{stat.text}</small>}</span></li>)}</ul>
      </div>}
      {view.notes.length > 0 && <details className="vua-sdk-review__notes"><summary>{sdkCopy.notes}</summary>
        <SdkIssues issues={view.notes} icon="question" /></details>}
    </>}
    {again}
    {hasItems && <button type="button" className="vua-release-upload__link" onClick={() => scrollToUploadGuide(3)}>{copy.uploadGuide.jumpTo}</button>}
  </section>;
}

function checkText(check: CheckLine): string {
  const c = copy.checks;
  switch (check.key) {
    case "descriptor": return check.state === "ok" ? c.descriptor : c.descriptorMissing;
    case "bindings": return check.state === "ok" ? c.bindings : c.bindingsOpen;
    case "menus": return check.state === "ok" ? c.menus : c.menusOpen;
    case "references": return check.state === "ok" ? c.references : format(c.referencesMissing, { count: check.count ?? 0 });
    case "scripts": return check.state === "ok" ? c.scripts : c.scriptsMissing;
    case "shaders": return check.state === "ok" ? c.shaders : format(c.shadersMissing, { count: check.count ?? 0 });
    case "signIn": return check.signIn === "yes" ? c.signedIn : check.signIn === "no" ? c.signedOut : c.signInUnknown;
  }
}

/** The SDK panel's sign-in in three steps, with a simple drawing of its sign-in screen (its labels are the SDK's own). */
function SignInGuide() {
  const guide = copy.signInGuide;
  return <div className="vua-release-guide">
    <strong>{guide.title}</strong>
    <div className="vua-release-guide__body">
      <ol>{[guide.step1, guide.step2, guide.step3].map(step => <li key={step}>{step}</li>)}</ol>
      <div className="vua-release-guide__panel" aria-hidden="true">
        <span className="vua-release-guide__bar">VRChat SDK</span>
        <span className="vua-release-guide__field">{guide.panel.user}</span>
        <span className="vua-release-guide__field">{guide.panel.password}</span>
        <span className="vua-release-guide__button">{guide.panel.signIn}</span>
        <span className="vua-release-guide__field vua-release-guide__field--code">{guide.panel.code}</span>
      </div>
    </div>
    <p className="vua-release-upload__hint">{guide.after}</p>
  </div>;
}

function UploadProgress({ upload, onStop }: { upload: AmfUpload; onStop?: () => void }) {
  const stages = AMF_UPLOAD_STAGES.filter(stage => stage !== "finishing");
  const at = Math.min(AMF_UPLOAD_STAGES.indexOf(upload.stage), stages.length - 1);
  return <div className="vua-release-upload__progress" role="status">
    <div className="vua-release-upload__now"><strong>{copy.stages[upload.stage]}</strong><span>{format(copy.pageOf, { page: at + 1, total: stages.length })}</span></div>
    <ol className="vua-release-upload__stages" aria-hidden="true">
      {stages.map((stage, index) => <li key={stage} title={copy.stages[stage]} data-state={index < at ? "done" : index === at ? "current" : "todo"} />)}
    </ol>
    {upload.stage === "sign_in" ? <SignInGuide/> : <p className="vua-release-upload__hint">{copy.stageHints[upload.stage]}</p>}
    {upload.stage === "uploading" && upload.progress !== null && <span className="vua-release-upload__bar" role="progressbar"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(upload.progress * 100)}><span style={{ width: `${Math.round(upload.progress * 100)}%` }} /></span>}
    {upload.status && <small className="vua-text-secondary">{upload.status}</small>}
    {onStop && <button type="button" className="vua-release-upload__stop" onClick={onStop}><Icon name="close" size={16} />{copy.upload.stop}</button>}
  </div>;
}

function LocalTestProgress({ test, onStop }: { test: AmfLocalTest; onStop?: () => void }) {
  const stages = AMF_LOCAL_TEST_STAGES.filter(stage => stage !== "finishing");
  const at = Math.min(AMF_LOCAL_TEST_STAGES.indexOf(test.stage), stages.length - 1);
  return <div className="vua-release-upload__progress" role="status">
    <div className="vua-release-upload__now"><strong>{copy.stages[test.stage]}</strong><span>{format(copy.pageOf, { page: at + 1, total: stages.length })}</span></div>
    <ol className="vua-release-upload__stages" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }} aria-hidden="true">
      {stages.map((stage, index) => <li key={stage} title={copy.stages[stage]} data-state={index < at ? "done" : index === at ? "current" : "todo"} />)}
    </ol>
    {test.stage === "sign_in" ? <SignInGuide/> : <p className="vua-release-upload__hint">{copy.stageHints[test.stage]}</p>}
    {test.status && <small className="vua-text-secondary">{test.status}</small>}
    {onStop && <button type="button" className="vua-release-upload__stop" onClick={onStop}><Icon name="close" size={16} />{copy.localTest.stop}</button>}
  </div>;
}

function LocalTestResult({ test, onCheckAgain }: { test: AmfLocalTest; onCheckAgain?: () => void }) {
  if (test.state === "succeeded") {
    return <div className="vua-release-upload__result" data-tone="success" role="status">
      <strong><Icon name="check" size={16} />{copy.localTest.succeeded}</strong>
      <span className="vua-text-secondary">{time(test.endedAt)}</span>
      <p>{copy.localTest.succeededHint}</p>
      <SdkSignInLine sdkSignIn={test.sdkSignIn} />
      {test.detail && <small className="vua-text-secondary">{test.detail}</small>}
    </div>;
  }
  const reason = test.reason ?? "unknown";
  const reasonText = reason === "platform_unsupported" || reason === "bridge_outdated"
    ? copy.localTest.reasons[reason]
    : copy.reasons[reason];
  return <div className="vua-release-upload__result" data-tone={test.state === "cancelled" ? "neutral" : "attention"} role="status">
    <strong><Icon name={test.state === "cancelled" ? "pause" : "warning"} size={16} />{test.state === "cancelled" ? copy.localTest.cancelled : copy.localTest.failed}</strong>
    <p>{reasonText}</p>
    {test.errors.length > 0 && <ul className="vua-release-upload__errors">{test.errors.map((error, index) => <li key={index}>{error}</li>)}</ul>}
    {test.detail && <details><summary>{copy.upload.details}</summary><p>{test.detail}</p></details>}
    {onCheckAgain && (reason === "avatar_missing" || reason === "bridge_outdated") && <button type="button" className="vua-release-upload__link" onClick={onCheckAgain}>{copy.upload.checkAgain}</button>}
  </div>;
}

function CopyId({ id }: { id: string }) {
  return <button type="button" className="vua-release-upload__copy" onClick={() => {
    void navigator.clipboard?.writeText(id).then(() => toast(copy.upload.copied, "success"), () => {});
  }}>{copy.upload.copyId}</button>;
}

function UploadResult({ upload, onCheckAgain, check, onRefreshCheck, onOpenOnVrchat, busy }: {
  upload: AmfUpload; onCheckAgain?: () => void; check: VrchatAvatarCheck | null; onRefreshCheck?: () => void;
  onOpenOnVrchat?: (avatarId: string) => void; busy: boolean;
}) {
  if (upload.state === "succeeded" && upload.blueprintId) {
    return <div className="vua-release-upload__result" data-tone="success" role="status">
      <strong><Icon name="check" size={16} />{copy.upload.uploaded}</strong>
      <span className="vua-text-secondary">{time(upload.endedAt)}</span>
      <span className="vua-release-upload__id"><span>{copy.upload.avatarId}</span><code>{upload.blueprintId}</code><CopyId id={upload.blueprintId} />
        {onOpenOnVrchat && <button type="button" className="vua-release-upload__copy" onClick={() => onOpenOnVrchat(upload.blueprintId!)}>{vrchatCopy.openPage}</button>}</span>
      <SdkSignInLine sdkSignIn={upload.sdkSignIn} />
      {upload.detail && <small className="vua-text-secondary">{upload.detail}</small>}
      {check !== null || onRefreshCheck !== undefined ? <AvatarCheckBlock check={check} {...(onRefreshCheck !== undefined ? { onRefresh: onRefreshCheck } : {})} busy={busy} /> : null}
    </div>;
  }
  const reason = upload.reason ?? "unknown";
  return <div className="vua-release-upload__result" data-tone={upload.state === "cancelled" ? "neutral" : "attention"} role="status">
    <strong><Icon name={upload.state === "cancelled" ? "pause" : "warning"} size={16} />{upload.state === "cancelled" ? copy.upload.cancelled : copy.upload.failed}</strong>
    <p>{copy.reasons[reason]}</p>
    {upload.errors.length > 0 && <ul className="vua-release-upload__errors">{upload.errors.map((error, index) => <li key={index}>{error}</li>)}</ul>}
    {upload.detail && <details><summary>{copy.upload.details}</summary><p>{upload.detail}</p></details>}
    {onCheckAgain && (reason === "avatar_missing" || reason === "thumbnail_missing") && <button type="button" className="vua-release-upload__link" onClick={onCheckAgain}>{copy.upload.checkAgain}</button>}
    {reason === "avatar_missing" && <button type="button" className="vua-release-upload__link" onClick={() => scrollToUploadGuide(1)}>{copy.uploadGuide.jumpTo}</button>}
    {reason === "thumbnail_missing" && <button type="button" className="vua-release-upload__link" onClick={() => scrollToUploadGuide(2)}>{copy.uploadGuide.jumpTo}</button>}
  </div>;
}

/** The right page. A turning page shows the same content without its controls. */
export function ReleaseSheet({ run, title, state, number, live, actions, notice, credits, terms, avatarCheck, onRefreshAvatarCheck, onOpenOnVrchat }: {
  run: AmfProductionRun; title: string; state: AmfReleaseState | null; number: number; live: boolean; actions?: SheetActions; notice?: ReactNode;
  /** Creator attribution and BOOTH links for the line's materials. */
  credits?: ReactNode;
  /** The terms check of the line's materials, shown before the upload. */
  terms?: ReactNode;
  avatarCheck?: VrchatAvatarCheck | null; onRefreshAvatarCheck?: () => void;
  /** Opens a finished upload's page on VRChat's site. */
  onOpenOnVrchat?: (avatarId: string) => void;
}) {
  const outfits = outfitLines(run);
  const checks = releaseChecks(run);
  const running = runningUpload(state);
  const runningTest = runningLocalTest(state);
  const latest = state?.uploads[0] ?? null;
  const latestTest = state?.localTests?.[0] ?? null;
  const earlier = (state?.uploads ?? []).filter(upload => upload !== latest && upload.state !== "running").slice(0, 3);
  const uploaded = uploadedAvatarId(state) !== null;
  const tested = (state?.localTests ?? []).some(test => test.state === "succeeded");
  const uploadQueued = actions?.queued?.operation === "amf.production.upload";
  const localTestQueued = actions?.queued?.operation === "amf.production.localTest";
  const noPublishPermission = state?.uploadEligibility?.canPublish === false;
  return <div className="vua-album__sheet">
    <header className="vua-album__heading">
      <span className="vua-album__number">{format(copy.number, { number: String(number).padStart(2, "0") })}</span>
      <h2>{title}</h2>
      {run.completedAt && <p className="vua-caption vua-text-secondary">{format(copy.finishedAt, { time: time(run.completedAt) })}</p>}
    </header>
    {notice}
    {/* A queued upload is the notice alone; other queued work keeps the button, disabled. */}
    {live && actions?.onNewLine ? <section className="vua-release-upload" data-nav-id="release-project-gone">
      <p>{copy.projectGone.title}</p>
      {actions.onRebuildRecipe ? <>
        <button type="button" className="vua-release-upload__button" onClick={actions.onRebuildRecipe} data-nav-id="release-rebuild-recipe"><Icon name="refresh" size={20} />{copy.projectGone.rebuildRecipe}</button>
        <div className="vua-release-upload__secondary-row"><button type="button" className="vua-release-upload__link" onClick={actions.onNewLine} data-nav-id="release-new-line">{copy.projectGone.newLine}</button></div>
      </> : <button type="button" className="vua-release-upload__button" onClick={actions.onNewLine} data-nav-id="release-new-line"><Icon name="refresh" size={20} />{copy.projectGone.newLine}</button>}
      {latest && latest.state !== "running" && <UploadResult upload={latest} check={avatarCheck ?? null} busy={false}
        {...(onRefreshAvatarCheck ? { onRefreshCheck: onRefreshAvatarCheck } : {})} {...(onOpenOnVrchat ? { onOpenOnVrchat } : {})} />}
    </section> : <section className="vua-release-upload" aria-label={noPublishPermission ? copy.localTest.button : copy.upload.button}>
      {live && actions?.queued && <QueuedNotice queued={actions.queued} />}
      {noPublishPermission && <>
        <UploadEligibilityNote />
        <p className="vua-caption vua-text-secondary">{copy.localTest.visitorPrimaryHint}</p>
      </>}
      {running ? <UploadProgress upload={running} {...(live && actions ? { onStop: actions.onStop } : {})} />
        : runningTest ? <LocalTestProgress test={runningTest}
            {...(live && actions && (runningTest.stage === "sdk_panel" || runningTest.stage === "sign_in") ? { onStop: actions.onStop } : {})} />
        : <>
          {noPublishPermission ? <>
            {actions?.onLocalTest && !(live && localTestQueued) && <button type="button" className="vua-release-upload__button"
              disabled={live && (!actions || (actions.localTestBlocked ?? actions.busy))} tabIndex={live ? 0 : -1}
              onClick={actions?.onLocalTest} data-nav-id="release-local-test"><Icon name="flask" size={20} />{tested ? copy.localTest.again : copy.localTest.button}</button>}
            {!(live && uploadQueued) && <div className="vua-release-upload__secondary-row">
              <button type="button" className="vua-album__bake" disabled={live && (!actions || (actions.uploadBlocked ?? actions.busy))} tabIndex={live ? 0 : -1}
                onClick={actions?.onUpload} data-nav-id="release-upload"><Icon name="arrow-up" size={16} /> {uploaded ? copy.upload.again : copy.upload.button}</button>
            </div>}
          </> : <>
            {!(live && uploadQueued) && <>
              <button type="button" className="vua-release-upload__button" disabled={live && (!actions || (actions.uploadBlocked ?? actions.busy))} tabIndex={live ? 0 : -1}
                onClick={actions?.onUpload} data-nav-id="release-upload"><Icon name="arrow-up" size={20} />{uploaded ? copy.upload.again : copy.upload.button}</button>
              {!(live && actions?.queued) && (actions?.busy || actions?.otherWork || state?.editorOpen) && <small className="vua-text-secondary">{actions?.busy ? copy.upload.lineBusy
                : actions?.otherWork ? copy.upload.busy : copy.upload.unityOpen}</small>}
            </>}
            {actions?.onLocalTest && !(live && localTestQueued) && <div className="vua-release-upload__secondary-row">
              <button type="button" className="vua-album__bake" disabled={live && (actions.localTestBlocked ?? actions.busy)} tabIndex={live ? 0 : -1}
                onClick={actions.onLocalTest} data-nav-id="release-local-test">{tested ? copy.localTest.again : copy.localTest.button}</button>
              <small className="vua-text-secondary">{copy.localTest.hint}</small>
            </div>}
          </>}
          {latestTest && latestTest.state !== "running" && <LocalTestResult test={latestTest} {...(live && actions ? { onCheckAgain: actions.onCheckAgain } : {})} />}
          {latest && latest.state !== "running" && <UploadResult upload={latest} check={avatarCheck ?? null}
            {...(live && onRefreshAvatarCheck ? { onRefreshCheck: onRefreshAvatarCheck } : {})}
            {...(live && onOpenOnVrchat ? { onOpenOnVrchat } : {})}
            busy={live && actions ? actions.busy : false}
            {...(live && actions ? { onCheckAgain: actions.onCheckAgain } : {})} />}
        </>}
      {earlier.length > 0 && <details className="vua-release-upload__history"><summary>{copy.upload.history}</summary>
        <ul>{earlier.map(upload => <li key={upload.uploadId}>{format(copy.upload.historyLine, { time: time(upload.endedAt ?? upload.startedAt), result: copy.upload.results[upload.state] })}
          {upload.blueprintId && <code>{upload.blueprintId}</code>}</li>)}</ul></details>}
    </section>}
    <section className="vua-album__block">
      <h3>{copy.outfits}</h3>
      {outfits.length === 0 ? <p className="vua-text-secondary">{copy.noOutfits}</p> : <ul className="vua-album__outfits">
        {outfits.map((outfit, index) => <li key={index}><Icon name="outfit" size={16} /><span>{outfit.name}</span>
          <small>{outfit.toggle ? `${format(copy.outfitSwitch, { name: outfit.toggle })} · ${outfit.active ? copy.onAtStart : copy.offAtStart}` : copy.alwaysWorn}</small></li>)}
      </ul>}
    </section>
    {checks.length > 0 && <section className="vua-album__block">
      <h3>{copy.checks.title}</h3>
      <ul className="vua-album__checks">{checks.map(check => <li key={check.key} data-state={check.state}>
        <Icon name={check.state === "ok" ? "check" : check.state === "attention" ? "warning" : "question"} size={16} />{checkText(check)}</li>)}</ul>
    </section>}
    {!actions?.onNewLine && <SdkReviewBlock run={run} busy={!live || !actions || actions.busy} {...(live && actions ? { onCheckAgain: actions.onCheckAgain } : {})} {...(live && actions?.onSdkFix ? { onFix: actions.onSdkFix } : {})} />}
    {credits}
    {terms}
    {!actions?.onNewLine && <UploadGuide />}
  </div>;
}
