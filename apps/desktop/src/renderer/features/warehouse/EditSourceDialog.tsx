import { useEffect, useRef, useState } from "react";
import { isLocalThumbnailRefV01, type LibraryEntryMetadataV01 } from "@vua/contracts";
import { catalogBrowser } from "../../app/catalog-browser-instance.ts";
import { catalogImageUrl } from "../../app/catalog-image.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { createLibraryMetadataPort, LibraryMetadataError } from "../../gateway/index.ts";
import { strings } from "../../i18n/index.ts";
import { boothSourceId } from "./booth-source.ts";
import "./edit-source-dialog.css";

const copy = strings.warehouse.editSource;
const metadataPort = createLibraryMetadataPort();
export function EditSourceDialog({ entries, onClose, onChanged }: {
  entries: readonly { readonly entryId: string; readonly displayName: string }[];
  onClose: () => void; onChanged: () => void;
}) {
  const [entryId, setEntryId] = useState(entries[0]!.entryId);
  const [record, setRecord] = useState<LibraryEntryMetadataV01 | null>(null);
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [booth, setBooth] = useState("");
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [officialImage, setOfficialImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const lifetime = useRef(0);
  const pending = useRef<{ fingerprint: string; commandId: string } | null>(null);
  const busyRef = useRef(false);
  // An entry switch invalidates the previous form before the effect starts its read.
  const currentRecord = record?.entryId === entryId ? record : null;
  useEffect(() => {
    const generation = ++lifetime.current;
    setRecord(null); setNotice(null); setOfficialImage(null); setNameEdited(false);
    void metadataPort.read(entryId).then(async (value) => {
      if (lifetime.current !== generation) return;
      setRecord(value); setName(value.displayName); setBooth(value.productId?.slice(6) ?? "");
      setResolvedId(value.productId); setThumbnail(value.thumbnailRef);
      if (value.productId !== null) {
        const detail = await catalogBrowser.detail(value.productId);
        if (lifetime.current === generation && detail.kind === "detail") setOfficialImage(detail.product.imageUrl);
      }
    }).catch(() => { if (lifetime.current === generation) setNotice(copy.readFailed); });
    return () => { lifetime.current++; };
  }, [entryId]);

  const official = async (id: string) => {
    const outcome = await window.vua?.catalogSync?.fetchProduct(id);
    if (outcome?.ok !== true) throw new Error("source_unavailable");
    const view = await catalogBrowser.detail(id);
    if (view.kind !== "detail") throw new Error("source_unavailable");
    return view.product;
  };
  const readOfficial = async () => {
    const id = boothSourceId(booth);
    if (id === null) { setNotice(copy.invalidId); return; }
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice(null);
    const generation = lifetime.current;
    try {
      const product = await official(id);
      if (lifetime.current !== generation) return;
      setResolvedId(id); setOfficialImage(product.imageUrl);
      if (!nameEdited && product.title !== null) setName(product.title);
      setNotice(copy.officialRead);
    } catch { if (lifetime.current === generation) setNotice(copy.officialFailed); }
    finally { busyRef.current = false; if (lifetime.current === generation) setBusy(false); }
  };
  const save = async () => {
    if (currentRecord === null || busyRef.current || name.trim() === "") return;
    const id = booth.trim() === "" ? null : boothSourceId(booth);
    if (booth.trim() !== "" && id === null) { setNotice(copy.invalidId); return; }
    busyRef.current = true; setBusy(true); setNotice(null);
    const generation = lifetime.current;
    let displayName = name.trim();
    try {
      if (id !== null && id !== resolvedId) {
        const product = await official(id);
        if (lifetime.current !== generation) return;
        if (!nameEdited && product.title !== null) displayName = product.title;
        setResolvedId(id); setName(displayName); setOfficialImage(product.imageUrl);
      }
      const params = { schemaVersion: "0.1" as const, entryId: currentRecord.entryId, expectedRevision: currentRecord.revision,
        displayName, productId: id, thumbnailRef: thumbnail };
      const fingerprint = JSON.stringify(params);
      if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, commandId: crypto.randomUUID() };
      await metadataPort.update(params, pending.current.commandId);
      onChanged();
      if (lifetime.current === generation) onClose();
    } catch (error) {
      if (lifetime.current === generation) setNotice(error instanceof LibraryMetadataError && error.code === "vua.library.metadata_conflict" ? copy.conflict
        : error instanceof Error && error.message === "source_unavailable" ? copy.officialFailed : copy.saveFailed);
    } finally { busyRef.current = false; if (lifetime.current === generation) setBusy(false); }
  };
  const pickThumbnail = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    const generation = lifetime.current;
    try {
      const ref = await window.vua?.dialog.pickLibraryThumbnail?.();
      if (ref != null && !isLocalThumbnailRefV01(ref)) throw new Error("thumbnail_invalid");
      if (ref != null && lifetime.current === generation) setThumbnail(ref);
    } catch { if (lifetime.current === generation) setNotice(copy.imageFailed); }
    finally { busyRef.current = false; if (lifetime.current === generation) setBusy(false); }
  };
  const image = thumbnail ?? officialImage;
  return <ContentDialog open title={copy.title} closeLabel={strings.common.dialogClose} onClose={onClose}>
    <form className="vua-edit-source" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {entries.length > 1 ? <label>{copy.localEntry}<select value={entryId} disabled={busy} onChange={(event) => setEntryId(event.target.value)}>
        {entries.map((entry) => <option key={entry.entryId} value={entry.entryId}>{entry.displayName}</option>)}
      </select></label> : null}
      <p className="vua-caption vua-text-secondary">{copy.description}</p>
      {currentRecord === null ? <p role="status">{notice ?? copy.loading}</p> : <>
        <label>{copy.boothId}<input value={booth} disabled={busy} placeholder={copy.boothPlaceholder} onChange={(event) => setBooth(event.target.value)} /></label>
        <div className="vua-edit-source__actions">
          <Button disabled={busy || booth.trim() === ""} onClick={() => void readOfficial()}>{copy.readOfficial}</Button>
          <Button variant="subtle" disabled={busy || booth.trim() === ""} onClick={() => { setBooth(""); setResolvedId(null); setOfficialImage(null); }}>{copy.clearSource}</Button>
        </div>
        <label>{copy.name}<input value={name} disabled={busy} maxLength={500} required onChange={(event) => { setName(event.target.value); setNameEdited(true); }} /></label>
        <div className="vua-edit-source__image">{image === null ? <span className="vua-caption">{copy.noImage}</span> : <img src={catalogImageUrl(image)} alt={name} />}</div>
        <div className="vua-edit-source__actions">
          <Button disabled={busy || window.vua?.dialog.pickLibraryThumbnail === undefined} onClick={() => void pickThumbnail()}>{copy.pickImage}</Button>
          <Button variant="subtle" disabled={busy || thumbnail === null} onClick={() => setThumbnail(null)}>{copy.clearImage}</Button>
        </div>
        {notice === null ? null : <p role="status" className="vua-caption">{notice}</p>}
      </>}
      <div className="vua-edit-source__actions">
        <Button onClick={onClose}>{copy.cancel}</Button>
        <Button type="submit" variant="primary" disabled={busy || currentRecord === null || name.trim() === ""}>{busy ? copy.working : copy.save}</Button>
      </div>
    </form>
  </ContentDialog>;
}
