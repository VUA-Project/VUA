import { useEffect, useState } from "react";
import { Button } from "../../components/primitives/Button.tsx";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { Skeleton } from "../../components/primitives/Skeleton.tsx";
import { catalogBrowser } from "../../app/catalog-browser-instance.ts";
import type { ProductDownloadablesView } from "../../gateway/catalog-browser-port.ts";
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
  onStart: (productId: string, downloadableIds: readonly number[]) => void;
}) {
  const [view, setView] = useState<ProductDownloadablesView | "loading">("loading");
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    if (product === null) return;
    let active = true;
    setView("loading");
    setChecked(new Set());
    void catalogBrowser
      .productDownloadables(product.productId)
      .then((result) => {
        if (!active) return;
        setView(result);
        if (result.kind === "files") {
          setChecked(new Set(result.items.map((item) => item.downloadableId)));
        }
      })
      .catch(() => {
        if (active) setView({ kind: "absent" });
      });
    return () => {
      active = false;
    };
  }, [product]);

  const files = view !== "loading" && view.kind === "files" ? view.items : null;
  const selectedIds = files === null ? [] : files.filter((f) => checked.has(f.downloadableId)).map((f) => f.downloadableId);

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
        ) : view.kind === "absent" ? (
          <p className="vua-caption vua-text-secondary">{copy.absent}</p>
        ) : view.kind === "not-found" ? (
          <p className="vua-caption vua-text-secondary">{copy.notFound}</p>
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
                </li>
              ))}
            </ul>
            <div className="vua-download-checklist__actions">
              <Button variant="default" onClick={onClose}>
                {copy.cancel}
              </Button>
              <Button
                variant="primary"
                disabled={selectedIds.length === 0}
                onClick={() => {
                  if (product !== null) onStart(product.productId, selectedIds);
                }}
              >
                {format(copy.startCta, { count: selectedIds.length })}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </ContentDialog>
  );
}
