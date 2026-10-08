import { useEffect, useState } from "react";
import { Badge } from "../../components/primitives/Badge.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { Skeleton } from "../../components/primitives/Skeleton.tsx";
import { useGateway } from "../../gateway/index.ts";
import type {
  DependenciesObservationsView,
  DependencyKindV05,
} from "../../gateway/index.ts";
import { format, strings } from "../../i18n/index.ts";

const copy = strings.warehouse.compatibleDialog;

/** Read-only observations. A known link target does not establish compatibility. */
export function CompatibleItemsDialog({
  enabled,
  query,
  onClose,
  onSelectProduct,
  onLookupName,
}: {
  enabled: boolean;
  /** null = closed; otherwise the declaring product. */
  query: { readonly productId: string; readonly title: string } | null;
  onClose: () => void;
  onSelectProduct: (productId: string) => void;
  onLookupName: (name: string) => void;
}) {
  const gateway = useGateway();
  const [view, setView] = useState<DependenciesObservationsView | "loading">("loading");

  useEffect(() => {
    if (!enabled || query === null) return;
    let active = true;
    setView("loading");
    gateway.dependencies
      .listByProduct(query.productId)
      .then((result) => {
        if (active) setView(result);
      })
      .catch(() => {
        /* 传输异常同缺席臂:live 端口已按三路缺席收窄,此处只兜未预期拒绝 */
        if (active) setView({ kind: "absent" });
      });
    return () => {
      active = false;
    };
  }, [enabled, query, gateway]);

  return (
    <ContentDialog
      open={enabled && query !== null}
      title={format(copy.title, { name: query?.title ?? "" })}
      closeLabel={strings.common.dialogClose}
      onClose={onClose}
    >
      <div className="vua-compatible-items">
        <p className="vua-caption vua-text-secondary" role="note">{copy.boundary}</p>
        {view === "loading" ? (
          <div>
            <Skeleton width="100%" height={36} />
            <Skeleton width="100%" height={36} />
          </div>
        ) : view.kind === "absent" ? (
          <p className="vua-caption vua-text-secondary">{copy.absent}</p>
        ) : view.kind === "error" ? (
          <p className="vua-caption vua-text-secondary">{strings.warehouse.states.loadFailedDescription}</p>
        ) : view.kind === "not-found" ? (
          <p className="vua-caption vua-text-secondary">{copy.notFound}</p>
        ) : view.observations.length === 0 ? (
          <p className="vua-caption vua-text-secondary">{copy.empty}</p>
        ) : (
          <>
          {view.productStatus === "missing" ? <p className="vua-caption vua-text-secondary">{copy.sourceMissing}</p> : null}
          <ul className="vua-compatible-items__list" role="list">
            {view.observations.map((obs, index) => {
              const resolved = obs.resolution;
              return (
              <li key={`${obs.depName}-${index}`} className="vua-compatible-items__row">
                <div className="vua-compatible-items__main">
                  <span className="vua-compatible-items__name">{obs.depName}</span>
                  {obs.versionHint !== null ? (
                    <span className="vua-caption vua-text-secondary">{obs.versionHint}</span>
                  ) : null}
                  <span className="vua-compatible-items__kind">{copy.kind[obs.depKind as DependencyKindV05]}</span>
                  <Badge>{resolved?.confirmed === true ? copy.confirmedLink : copy.unconfirmed}</Badge>
                </div>
                {/* 证据体:页面逐字引文(title 悬浮全文,行内截断) */}
                <p className="vua-caption vua-text-secondary" title={obs.rawQuote}>
                  {obs.rawQuote}
                </p>
                <div className="vua-compatible-items__actions">
                {resolved !== null ? (
                  <Button
                    variant="subtle"
                    onClick={() => onSelectProduct(resolved.productId)}
                  >
                    {copy.resolvedCta}
                  </Button>
                ) : null}
                <Button variant="subtle" onClick={() => onLookupName(obs.depName)}>{copy.lookupName}</Button>
                </div>
              </li>
              );
            })}
          </ul>
          </>
        )}
      </div>
    </ContentDialog>
  );
}
