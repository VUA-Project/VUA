import { useEffect, useRef, useState } from "react";
import type { LibraryTargetV01, LibraryRemovalPreviewV01, LibraryRemovalSnapshotV01 } from "@vua/contracts";
import { libraryMaintenance } from "../../app/library-maintenance-instance.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { Skeleton } from "../../components/primitives/Skeleton.tsx";
import { registerTaskIdentity, LibraryMaintenanceError } from "../../gateway/index.ts";
import { format, strings, termLabel } from "../../i18n/index.ts";

const copy = strings.warehouse.removeFiles;
function removalError(code: string | null): string {
  const reasons: Readonly<Record<string,string>> = { file_changed: copy.fileChanged, file_unreadable: copy.fileUnreadable,
    file_remove_failed: copy.fileRemoveFailed, copy_changed: copy.copyChanged, outside_managed_root: copy.outsideRoot };
  return code === null ? copy.failed : reasons[code] ?? copy.failed;
}
export interface RemovalDialogTarget { readonly target: LibraryTargetV01; readonly title: string; readonly copyIds?: readonly string[] }

export function RemoveFilesDialog({ item, onClose, onChanged }: {
  item: RemovalDialogTarget; onClose: () => void; onChanged: () => void;
}) {
  const [inventory, setInventory] = useState<LibraryRemovalPreviewV01 | null>(null);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [preview, setPreview] = useState<LibraryRemovalPreviewV01 | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [intent, setIntent] = useState<{ readonly id: string; readonly preview: LibraryRemovalPreviewV01 } | null>(null);
  const [snapshot, setSnapshot] = useState<LibraryRemovalSnapshotV01 | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const currentIntent = useRef<string | null>(null);
  const changed = useRef(onChanged);
  const scope = item.copyIds?.join("|");
  useEffect(() => { changed.current = onChanged; }, [onChanged]);
  useEffect(() => {
    let active = true; setLoading(true); setFeedback(null); setInventory(null); setPreview(null);
    void libraryMaintenance.preview(item.target, item.copyIds).then((value) => {
      if (active) { setInventory(value); setSelection(new Set(value.files.map((file) => file.copyId))); }
    }).catch(() => { if (active) setFeedback(copy.loadFailed); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [item.target.kind, item.target.id, scope, refresh]);
  const selected = [...selection].sort().join("|");
  useEffect(() => {
    let active = true; setPreview(null);
    if (inventory === null || selection.size === 0 || intent !== null) { if (inventory !== null) setLoading(false); return; }
    setLoading(true);
    void libraryMaintenance.preview(item.target, [...selection]).then((value) => { if (active) setPreview(value); })
      .catch(() => { if (active) setFeedback(copy.loadFailed); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [inventory, selected, intent]);
  useEffect(() => {
    if (intent === null) return;
    let active = true; let busy = false; let revision = 0;
    const poll = async () => {
      if (!active || busy) return; busy = true;
      try {
        const value = await libraryMaintenance.status(intent.id);
        if (!active || currentIntent.current !== intent.id) return;
        if (value.target.kind !== item.target.kind || value.target.id !== item.target.id) throw new Error("wrong_target");
        setSnapshot(value); setFeedback(null);
        registerTaskIdentity(value.taskId, { title: `${copy.title} · ${item.title}`, originPage: "warehouse", notifyOnComplete: true });
        if (value.revision !== revision) { revision = value.revision; changed.current(); }
        if (value.state !== "running") window.clearInterval(timer);
      } catch { if (active && currentIntent.current === intent.id) setFeedback(copy.resultUnknown); }
      finally { busy = false; }
    };
    const timer = window.setInterval(() => void poll(), 2000); void poll();
    return () => { active = false; window.clearInterval(timer); };
  }, [intent]);
  const submit = async (request: NonNullable<typeof intent>) => {
    if (submitting) return;
    setSubmitting(true); setFeedback(null);
    try {
      // Keep the same authorized selection and identity when a receipt is lost.
      // The provider returns the accepted task before checking a fresh preview.
      const value = await libraryMaintenance.remove(request.id, request.preview); setSnapshot(value); setFeedback(null);
      registerTaskIdentity(value.taskId, { title: `${copy.title} · ${item.title}`, originPage: "warehouse", notifyOnComplete: true });
      changed.current();
    } catch (error) {
      const refused = error instanceof LibraryMaintenanceError && ["vua.library.preview_changed", "vua.library.file_busy", "vua.library.target_not_found", "vua.library.copy_not_found", "vua.library.reference_read_failed"].includes(error.code);
      if (refused) {
        currentIntent.current = null;
        setIntent(null); setPreview(null);
        setFeedback(error.code.endsWith("file_busy") ? copy.busy : error.code.endsWith("reference_read_failed") ? copy.loadFailed : copy.drift);
      } else setFeedback(copy.resultUnknown);
    } finally { setSubmitting(false); }
  };
  const remove = async () => {
    if (preview === null || intent !== null || submitting) return;
    const request = { id: `library-removal-${crypto.randomUUID()}`, preview };
    currentIntent.current = request.id;
    setIntent(request);
    await submit(request);
  };
  const counts = { removed: snapshot?.files.filter((f) => f.phase === "removed").length ?? 0,
    missing: snapshot?.files.filter((f) => f.phase === "already_missing").length ?? 0,
    failed: snapshot?.files.filter((f) => f.phase === "failed").length ?? 0, pending: snapshot?.files.filter((f) => f.phase === "pending").length ?? 0 };
  return <ContentDialog open title={`${copy.title} · ${item.title}`} closeLabel={strings.common.dialogClose} onClose={onClose}>
    <div className="vua-page__stack">
      <p>{format(copy.note, { recipe: termLabel("recipe") })}</p>
      {inventory === null && loading ? <><p role="status">{copy.loading}</p><Skeleton width="100%" height={80} /></> : null}
      {inventory !== null && intent === null ? <>
        <div className="vua-page__actions"><span>{format(copy.selected, { count: selection.size })}</span>
          <Button variant="subtle" disabled={loading} onClick={() => setSelection(new Set(inventory.files.map((file) => file.copyId)))}>{copy.selectAll}</Button>
          <Button variant="subtle" disabled={loading} onClick={() => setSelection(new Set())}>{copy.clear}</Button>
        </div>
        {inventory.files.length === 0 ? <p>{copy.empty}</p> : <ul className="vua-add-to-recipe__list">{inventory.files.map((file) => <li key={file.copyId}>
          <label><input type="checkbox" checked={selection.has(file.copyId)} onChange={(event) => setSelection((old) => { const next = new Set(old); if (event.target.checked) next.add(file.copyId); else next.delete(file.copyId); return next; })} /> {file.fileName}</label>
          <p className="vua-caption vua-text-secondary">{copy[file.role]} · {copy[file.presence]}{file.superseded ? ` · ${copy.oldVersion}` : ""} · {file.artifactSha256.slice(7, 19)}</p>
        </li>)}</ul>}
        {loading && selection.size > 0 ? <p role="status">{copy.loading}</p> : null}
        {preview !== null ? <section><h3>{format(copy.references, { recipe: termLabel("recipe") })}</h3>
          {preview.referenceCoverage === "drafts_only" ? <p>{format(copy.draftsOnly, { recipe: termLabel("recipe") })}</p> : null}
          {preview.unresolvedRecipeAssets > 0 ? <p>{format(copy.unresolvedReferences, { count: preview.unresolvedRecipeAssets, recipe: termLabel("recipe") })}</p> : null}
          {preview.references.length === 0 ? <p>{copy.noReferences}</p> : <ul>{preview.references.map((ref) => <li key={`${ref.kind}:${ref.id}`}>
            {format(copy.reference, { title: ref.title || ref.id, revision: ref.revision })}<p className="vua-caption">{ref.missingAfterRemoval ? copy.referenceMissing : copy.referenceRetained}</p>
          </li>)}</ul>}
        </section> : null}
        <Button variant="danger" disabled={loading || preview === null || preview.files.length === 0 || submitting} onClick={() => void remove()}>{copy.confirm}</Button>
      </> : null}
      {snapshot !== null ? <div role="status"><p>{format(copy.running, counts)}</p>{snapshot.state !== "running" ? <p>{snapshot.state === "failed" ? copy.failed : copy[snapshot.state]}</p> : null}
        <ul>{snapshot.files.map((file) => <li key={file.copyId}>{file.fileName} · {file.phase === "failed" ? copy.fileFailed : copy[file.phase]}
          {file.phase === "failed" ? <p className="vua-caption">{removalError(file.errorCode)}</p> : null}</li>)}</ul>
        {snapshot.state === "running" ? <Button disabled={snapshot.cancelRequested} onClick={() => void libraryMaintenance.cancel(snapshot.taskId, snapshot.revision).catch(() => setFeedback(copy.failed))}>{copy.cancel}</Button> : null}
      </div> : null}
      {feedback !== null ? <p role="alert">{feedback}</p> : null}
      {intent !== null && snapshot === null && feedback !== null ? <Button variant="default" disabled={submitting} onClick={() => void submit(intent)}>{copy.retryRequest}</Button> : null}
      {intent === null ? <Button variant="default" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>{copy.retry}</Button> : null}
    </div>
  </ContentDialog>;
}
