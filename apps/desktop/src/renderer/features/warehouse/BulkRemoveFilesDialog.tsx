import { useEffect, useRef, useState } from "react";
import type { LibraryRemovalPreviewV01, LibraryRemovalSnapshotV01 } from "@vua/contracts";
import { libraryMaintenance } from "../../app/library-maintenance-instance.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { registerTaskIdentity, LibraryMaintenanceError } from "../../gateway/index.ts";
import { format, strings, termLabel } from "../../i18n/index.ts";
import type { RemovalDialogTarget } from "./RemoveFilesDialog.tsx";
import { removalProductCount, removalScopes } from "./bulk-file-model.ts";

const copy = strings.warehouse.bulkFiles;
const removal = strings.warehouse.removeFiles;
interface PreparedRemoval { readonly item: RemovalDialogTarget; readonly preview: LibraryRemovalPreviewV01; readonly interrupted: boolean }
interface RemovalIntent extends PreparedRemoval { readonly id: string }
type Receipt = { readonly snapshot: LibraryRemovalSnapshotV01 } | { readonly error: "unknown" | "refused" };

export function BulkRemoveFilesDialog({ items, onClose, onChanged, onInspect }: {
  items: readonly RemovalDialogTarget[]; onClose: () => void; onChanged: () => void; onInspect: (item: RemovalDialogTarget) => void;
}) {
  const [prepared, setPrepared] = useState<readonly PreparedRemoval[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [intents, setIntents] = useState<readonly RemovalIntent[] | null>(null);
  const [receipts, setReceipts] = useState<ReadonlyMap<string, Receipt>>(new Map());
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {
    let active = true; setPrepared(null); setFailed(false);
    void Promise.all(removalScopes(items).map(async item => {
      const [preview, interrupted] = await Promise.all([libraryMaintenance.preview(item.target, item.copyIds), libraryMaintenance.pending(item.target)]);
      return { item, preview, interrupted: interrupted.length > 0 };
    })).then(values => { if (active) setPrepared(values.filter(value => value.preview.files.length > 0)); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [items, refresh]);
  const record = (intent: RemovalIntent, snapshot: LibraryRemovalSnapshotV01) => {
    registerTaskIdentity(snapshot.taskId, { title: `${removal.title} · ${intent.item.title}`, originPage: "warehouse", notifyOnComplete: true, notifyFamily: "library:removeFiles" });
    setReceipts(previous => new Map(previous).set(intent.id, { snapshot })); onChanged();
  };
  const submit = async (requests: readonly RemovalIntent[]) => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true);
    for (const intent of requests) {
      try { record(intent, await libraryMaintenance.remove(intent.id, intent.preview)); }
      catch (error) {
        const refused = error instanceof LibraryMaintenanceError && ["vua.library.preview_changed", "vua.library.file_busy", "vua.library.target_not_found", "vua.library.copy_not_found", "vua.library.reference_read_failed"].includes(error.code);
        setReceipts(previous => new Map(previous).set(intent.id, { error: refused ? "refused" : "unknown" }));
      }
    }
    submitting.current = false; setBusy(false);
  };
  // Every request retains its authorized preview and identity if its receipt is lost.
  useEffect(() => {
    if (intents === null) return;
    let active = true; let polling = false;
    const poll = async () => {
      if (polling) return; polling = true;
      for (const intent of intents) {
        const receipt = receipts.get(intent.id);
        if (receipt === undefined || "error" in receipt || receipt.snapshot.state !== "running") continue;
        try {
          const snapshot = await libraryMaintenance.status(intent.id);
          if (active && snapshot.revision !== receipt.snapshot.revision) record(intent, snapshot);
        } catch { /* Keep the last confirmed receipt on a temporary disconnect. */ }
      }
      polling = false;
    };
    const timer = window.setInterval(() => void poll(), 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [intents, receipts]);
  const count = removalProductCount(prepared?.map(value => value.item) ?? items);
  const fileCount = prepared?.reduce((sum, value) => sum + value.preview.files.length, 0) ?? 0;
  return <ContentDialog open title={format(copy.titleRemove, { count })} closeLabel={strings.common.dialogClose} onClose={onClose}>
    <div className="vua-page__stack vua-bulk-files">
      <p>{copy.removeNote}</p>
      {failed ? <p role="alert">{copy.loadFailed}</p> : prepared === null ? <p role="status">{removal.loading}</p> : prepared.length === 0 ? <p>{copy.empty}</p> : prepared.map((value, index) => {
        const intent = intents?.[index];
        const receipt = intent === undefined ? undefined : receipts.get(intent.id);
        return <section className="vua-bulk-files__product" key={`${value.item.target.kind}:${value.item.target.id}:${index}`}>
          <h3>{value.item.title}</h3>
          <ul>{value.preview.files.map(file => <li key={file.copyId}>{file.fileName} <span className="vua-caption vua-text-secondary">· {removal[file.presence]}{file.superseded ? ` · ${removal.oldVersion}` : ""}</span></li>)}</ul>
          {value.preview.referenceCoverage === "drafts_only" ? <p>{format(removal.draftsOnly, { recipe: termLabel("recipe") })}</p> : null}
          {value.preview.unresolvedRecipeAssets > 0 ? <p>{format(removal.unresolvedReferences, { count: value.preview.unresolvedRecipeAssets, recipe: termLabel("recipe") })}</p> : null}
          {value.preview.references.length > 0 ? <><h4>{format(removal.references, { recipe: termLabel("recipe") })}</h4><ul>{value.preview.references.map(ref => <li key={`${ref.kind}:${ref.id}`}>{ref.title || ref.id}</li>)}</ul></> : null}
          {value.interrupted && intents === null ? <><p>{copy.pending}</p><Button onClick={() => onInspect(value.item)}>{copy.inspect}</Button></> : null}
          {receipt === undefined ? null : "error" in receipt ? <p role="alert">{receipt.error === "refused" ? copy.previewChanged : copy.unknown}</p> : <div role="status">
            <p>{receipt.snapshot.state === "running" ? copy.running : removal[receipt.snapshot.state]}</p>
            <ul>{receipt.snapshot.files.map(file => <li key={file.copyId}>{file.fileName} · {file.phase === "failed" ? removal.fileFailed : removal[file.phase]}</li>)}</ul>
            {receipt.snapshot.state === "running" ? <Button disabled={receipt.snapshot.cancelRequested} onClick={() => void libraryMaintenance.cancel(receipt.snapshot.taskId, receipt.snapshot.revision).catch(() => setFailed(true))}>{removal.cancel}</Button> : null}
            {receipt.snapshot.state === "unconfirmed" ? <Button onClick={() => onInspect(value.item)}>{copy.inspect}</Button> : null}
          </div>}
        </section>;
      })}
      {intents === null ? <>
        <p>{format(copy.scope, { count, files: fileCount })}</p>
        <Button variant="danger" disabled={prepared === null || prepared.length === 0 || prepared.some(value => value.interrupted) || busy} onClick={() => {
          if (prepared === null || submitting.current) return;
          const requests = prepared.map(value => ({ ...value, id: `library-removal-${crypto.randomUUID()}` }));
          setIntents(requests); void submit(requests);
        }}>{format(copy.confirmRemove, { count })}</Button>
        <Button disabled={busy} onClick={() => setRefresh(value => value + 1)}>{removal.retry}</Button>
      </> : <>
        {intents.some(intent => { const receipt = receipts.get(intent.id); return receipt !== undefined && "error" in receipt && receipt.error === "unknown"; }) ? <Button disabled={busy} onClick={() => void submit(intents.filter(intent => { const receipt = receipts.get(intent.id); return receipt !== undefined && "error" in receipt && receipt.error === "unknown"; }))}>{copy.retryUnknown}</Button> : null}
        {intents.some(intent => { const receipt = receipts.get(intent.id); return receipt !== undefined && "error" in receipt && receipt.error === "refused"; }) && !busy && intents.every(intent => { const receipt = receipts.get(intent.id); return receipt !== undefined && ("error" in receipt ? receipt.error === "refused" : receipt.snapshot.state !== "running"); }) ? <Button onClick={() => { setIntents(null); setReceipts(new Map()); setRefresh(value => value + 1); }}>{removal.newSelection}</Button> : null}
      </>}
    </div>
  </ContentDialog>;
}
