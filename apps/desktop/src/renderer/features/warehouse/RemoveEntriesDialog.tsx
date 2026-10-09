import { useRef, useState } from "react";
import { Button } from "../../components/primitives/Button.tsx";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { createLibraryMetadataPort } from "../../gateway/index.ts";
import { strings } from "../../i18n/index.ts";
const copy = strings.warehouse.removeEntries;
const port = createLibraryMetadataPort();
export function RemoveEntriesDialog({ entries, onClose, onChanged }: {
  entries: readonly { readonly entryId: string; readonly displayName: string }[];
  onClose: () => void; onChanged: () => void;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(entries.map((entry) => entry.entryId)));
  const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false);
  const pending = useRef<{ fingerprint: string; commandId: string } | null>(null);
  const submitting = useRef(false);
  const remove = async () => {
    if (submitting.current || selected.size === 0) return;
    const ids = [...selected].sort();
    const fingerprint = JSON.stringify(ids);
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, commandId: crypto.randomUUID() };
    submitting.current = true; setBusy(true); setFailed(false);
    try { await port.removeEntries(ids, pending.current.commandId); onChanged(); onClose(); }
    catch { setFailed(true); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <ContentDialog open title={copy.title} closeLabel={strings.common.dialogClose} onClose={onClose}>
    <div className="vua-page__stack">
      <p>{copy.description}</p>
      <p className="vua-caption vua-text-secondary">{copy.wholeImport}</p>
      {entries.map((entry) => <label key={entry.entryId}>
        <input type="checkbox" checked={selected.has(entry.entryId)} disabled={busy} onChange={(event) => setSelected((prior) => {
          const next = new Set(prior); if (event.target.checked) next.add(entry.entryId); else next.delete(entry.entryId); return next;
        })} /> {entry.displayName}
      </label>)}
      {failed ? <p role="status">{copy.failed}</p> : null}
      <div className="vua-page__actions">
        <Button onClick={onClose}>{copy.cancel}</Button>
        <Button variant="danger" disabled={busy || selected.size === 0} onClick={() => void remove()}>{busy ? copy.working : copy.confirm}</Button>
      </div>
    </div>
  </ContentDialog>;
}
