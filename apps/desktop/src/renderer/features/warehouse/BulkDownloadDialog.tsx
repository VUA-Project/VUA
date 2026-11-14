import { useEffect, useRef, useState } from "react";
import { libraryBrowser } from "../../app/library-browser-instance.ts";
import { registerTaskIdentity, type LibraryFileInventory } from "../../gateway/index.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { format, strings } from "../../i18n/index.ts";
import { downloadableFiles, type BulkDownloadMode, type BulkProduct } from "./bulk-file-model.ts";

const copy = strings.warehouse.bulkFiles;
interface DownloadChoice { readonly product: BulkProduct; readonly inventory: LibraryFileInventory | null }
export function BulkDownloadDialog({ products, mode, skippedLocal, onClose, onChanged }: {
  products: readonly BulkProduct[]; mode: BulkDownloadMode; skippedLocal: number; onClose: () => void; onChanged: () => void;
}) {
  const [choices, setChoices] = useState<readonly DownloadChoice[] | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [targets, setTargets] = useState<ReadonlyMap<number, string>>(new Map());
  const [receipts, setReceipts] = useState<ReadonlyMap<string, string>>(new Map());
  const [refresh, setRefresh] = useState(0);
  const [started, setStarted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitted = useRef(false);
  useEffect(() => {
    let active = true; setChoices(null); setSelected(new Set()); setTargets(new Map());
    void Promise.all(products.map(async product => ({ product, inventory: await libraryBrowser.productFiles(product.productId).catch(() => null) }))).then(values => {
      if (!active) return;
      setChoices(values);
      setSelected(new Set(values.flatMap(value => value.inventory === null ? [] : downloadableFiles(value.inventory, mode).slice(0, 200).map(file => file.downloadableId))));
    });
    return () => { active = false; };
  }, [products, mode, refresh]);
  const selectedProducts = choices?.filter(choice => choice.inventory?.items.some(file => selected.has(file.downloadableId))) ?? [];
  const ambiguous = selectedProducts.some(choice => choice.inventory!.items.some(file => selected.has(file.downloadableId) && file.managedCopyId === null && file.copies.length > 1 && !targets.has(file.downloadableId)));
  const start = async () => {
    if (submitted.current || window.vua?.silentDownload === undefined) return;
    submitted.current = true;
    setStarted(true); setSubmitting(true);
    for (const choice of selectedProducts) {
      const files = choice.inventory!.items.filter(file => selected.has(file.downloadableId));
      let message = copy.failed;
      try {
        const replacements = files.filter(file => targets.has(file.downloadableId)).map(file => ({ downloadableId: file.downloadableId, copyId: targets.get(file.downloadableId)! }));
        const outcome = await window.vua.silentDownload.start(choice.product.productId, files.map(file => file.downloadableId), replacements);
        if ("blocked" in outcome) message = copy.blocked;
        else if ("errorCode" in outcome) message = outcome.errorCode === "vua.library.file_busy" ? strings.warehouse.cardMenu.downloadBusyHint : outcome.errorCode === "vua.library.replacement_ambiguous" ? strings.warehouse.cardMenu.downloadAmbiguousHint : copy.failed;
        else {
          message = copy.queued;
          registerTaskIdentity(outcome.taskId, { title: `${strings.taskCenter.downloadTask} · ${choice.product.title}`, originPage: "warehouse", notifyOnComplete: true, notifyFamily: "library:download" });
          onChanged();
        }
      } catch { /* Transport failure does not prove that an accepted download failed. */ message = copy.downloadUnknown; }
      setReceipts(previous => new Map(previous).set(choice.product.productId, message));
    }
    setSubmitting(false);
  };
  return <ContentDialog open title={mode === "download" ? copy.titleDownload : copy.titleRedownload} closeLabel={strings.common.dialogClose} onClose={onClose}>
    <div className="vua-page__stack vua-bulk-files">
      <p>{copy.downloadNote}</p>
      {skippedLocal > 0 ? <p role="status">{format(copy.skipLocal, { count: skippedLocal })}</p> : null}
      {choices === null ? <p role="status">{strings.warehouse.removeFiles.loading}</p> : choices.map(choice => {
        const files = choice.inventory === null ? null : downloadableFiles(choice.inventory, mode);
        const count = files?.filter(file => selected.has(file.downloadableId)).length ?? 0;
        return <section key={choice.product.productId} className="vua-bulk-files__product">
          <h3>{choice.product.title}</h3>
          {files === null ? <p role="alert">{copy.loadFailed}</p> : files.length === 0 ? <p className="vua-text-secondary">{copy.empty}</p> : <ul className="vua-download-checklist__list">
            {files.map(file => <li key={file.downloadableId} className="vua-download-checklist__row">
              <label className="vua-download-checklist__label"><input type="checkbox" checked={selected.has(file.downloadableId)} disabled={started || !selected.has(file.downloadableId) && count >= 200} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(file.downloadableId); else next.delete(file.downloadableId); return next; })} />
                <span className="vua-download-checklist__name">{file.fileName || format(strings.warehouse.downloadChecklist.unnamedFile, { id: file.downloadableId })}</span>
              </label>
              {file.managedCopyId === null && file.copies.length > 1 ? <label>{strings.warehouse.libraryState.chooseReplacement}
                <select disabled={started} value={targets.get(file.downloadableId) ?? ""} onChange={event => setTargets(previous => { const next = new Map(previous); if (event.target.value === "") next.delete(file.downloadableId); else next.set(file.downloadableId, event.target.value); return next; })}>
                  <option value="">{strings.warehouse.libraryState.chooseReplacement}</option>
                  {file.copies.map((candidate, index) => <option key={candidate.copyId} value={candidate.copyId}>{format(strings.warehouse.libraryState.copyOption, { index: index + 1, name: candidate.fileName, state: strings.warehouse.libraryState[candidate.presence] })}</option>)}
                </select></label> : null}
            </li>)}
          </ul>}
          {receipts.has(choice.product.productId) ? <p role="status">{receipts.get(choice.product.productId)}</p> : null}
        </section>;
      })}
      {!started ? <><p>{format(copy.scope, { count: selectedProducts.length, files: selected.size })}</p>
        <Button variant="primary" disabled={choices === null || choices.some(choice => choice.inventory === null) || selected.size === 0 || ambiguous || submitting} onClick={() => void start()}>{format(mode === "download" ? copy.confirmDownload : copy.confirmRedownload, { count: selectedProducts.length })}</Button>
        {choices?.some(choice => choice.inventory === null) ? <Button onClick={() => setRefresh(value => value + 1)}>{strings.warehouse.removeFiles.retry}</Button> : null}</> : null}
    </div>
  </ContentDialog>;
}
