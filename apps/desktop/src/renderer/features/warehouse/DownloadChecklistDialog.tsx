import { useEffect, useState } from "react";
import { Button } from "../../components/primitives/Button.tsx";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { Skeleton } from "../../components/primitives/Skeleton.tsx";
import { libraryBrowser } from "../../app/library-browser-instance.ts";
import type { LibraryFileInventory } from "../../gateway/index.ts";
import { format, strings } from "../../i18n/index.ts";

const copy = strings.warehouse.downloadChecklist;

/**
 * 静默下载文件清单(N5,设置「下载前弹清单」开启时):列出 BDL 捕获的
 * 逐文件条目(文件名 + 稳定 id),默认全选;确认即按所选 id 入静默队列。
 * 空清单 = 该商品尚无捕获(先同步库),如实呈现不猜。
 */
export function DownloadChecklistDialog({
  product,
  onClose,
  onStart,
}: {
  product: { readonly productId: string; readonly title: string } | null;
  onClose: () => void;
  onStart: (productId: string, downloadableIds: readonly number[], targets: readonly { downloadableId: number; copyId: string }[]) => void;
}) {
  const [view, setView] = useState<LibraryFileInventory | "loading" | "error">("loading");
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set());
  const [targets, setTargets] = useState<ReadonlyMap<number, string>>(new Map());

  useEffect(() => {
    if (product === null) return;
    let active = true;
    setView("loading");
    setChecked(new Set());
    setTargets(new Map());
    void libraryBrowser
      .productFiles(product.productId)
      .then((result) => {
        if (!active) return;
        setView(result);
        setChecked(new Set(result.items.slice(0, 200).map((item) => item.downloadableId)));
      })
      .catch(() => {
        if (active) setView("error");
      });
    return () => {
      active = false;
    };
  }, [product]);

  const files = typeof view === "string" ? null : view.items;
  const selectedIds = files === null ? [] : files.filter((f) => checked.has(f.downloadableId)).map((f) => f.downloadableId);
  const ambiguous = files?.some((file) => checked.has(file.downloadableId) && file.managedCopyId === null && file.copies.length > 1 && !targets.has(file.downloadableId)) ?? false;
  const selectedTargets = files?.filter((file) => checked.has(file.downloadableId) && targets.has(file.downloadableId)).map((file) => ({ downloadableId: file.downloadableId, copyId: targets.get(file.downloadableId)! })) ?? [];
  const replaces = files?.some((file) => checked.has(file.downloadableId) && file.copies.length > 0) ?? false;

  return (
    <ContentDialog
      open={product !== null}
      title={format(copy.title, { name: product?.title ?? "" })}
      closeLabel={strings.common.dialogClose}
      onClose={onClose}
    >
      <div className="vua-download-checklist">
        {view === "loading" ? (
          <div>
            <Skeleton width="100%" height={36} />
            <Skeleton width="100%" height={36} />
          </div>
        ) : view === "error" ? (
          <p className="vua-caption vua-text-secondary">{copy.absent}</p>
        ) : files !== null && files.length === 0 ? (
          <p className="vua-caption vua-text-secondary">{copy.empty}</p>
        ) : files !== null ? (
          <>
            <ul className="vua-download-checklist__list" role="list">
              {files.map((file) => (
                <li key={file.downloadableId} className="vua-download-checklist__row">
                  <label className="vua-download-checklist__label">
                    <input
                      type="checkbox"
                      checked={checked.has(file.downloadableId)}
                      disabled={!checked.has(file.downloadableId) && checked.size >= 200}
                      onChange={(event) => {
                        setChecked((prev) => {
                          const next = new Set(prev);
                          if (event.target.checked) next.add(file.downloadableId);
                          else next.delete(file.downloadableId);
                          return next;
                        });
                      }}
                    />
                    <span className="vua-download-checklist__name">
                      {file.fileName !== "" ? file.fileName : format(copy.unnamedFile, { id: file.downloadableId })}
                    </span>
                  </label>
                  {file.copies.length > 0 ? <span className="vua-caption vua-text-secondary">
                    {Array.from(new Set(file.copies.map((item) => strings.warehouse.libraryState[item.presence]))).join(" · ")}
                  </span> : null}
                  {file.managedCopyId === null && file.copies.length > 1 ? <label>
                    <span className="vua-caption">{strings.warehouse.libraryState.chooseReplacement}</span>
                    <select value={targets.get(file.downloadableId) ?? ""} onChange={(event) => setTargets((previous) => {
                      const next = new Map(previous);
                      if (event.target.value === "") next.delete(file.downloadableId); else next.set(file.downloadableId, event.target.value);
                      return next;
                    })}>
                      <option value="">{strings.warehouse.libraryState.chooseReplacement}</option>
                      {file.copies.map((item, index) => <option key={item.copyId} value={item.copyId}>
                        {format(strings.warehouse.libraryState.copyOption, { index: index + 1, name: item.fileName, state: strings.warehouse.libraryState[item.presence] })}
                      </option>)}
                    </select>
                  </label> : null}
                </li>
              ))}
            </ul>
            <div className="vua-download-checklist__actions">
              <Button variant="default" onClick={onClose}>
                {copy.cancel}
              </Button>
              <Button
                variant="primary"
                disabled={selectedIds.length === 0 || ambiguous}
                onClick={() => {
                  if (product !== null) onStart(product.productId, selectedIds, selectedTargets);
                }}
              >
                {format(replaces ? strings.warehouse.libraryState.replaceCta : copy.startCta, { count: selectedIds.length })}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </ContentDialog>
  );
}
