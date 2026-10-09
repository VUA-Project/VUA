import { useEffect, useState } from "react";
import { Badge } from "../../components/primitives/Badge.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { Skeleton } from "../../components/primitives/Skeleton.tsx";
import { useGateway, type DependenciesLookupView } from "../../gateway/index.ts";
import { format, strings } from "../../i18n/index.ts";

const copy = strings.warehouse.dependencyLookup;
const cluesCopy = strings.warehouse.compatibleDialog;
const PAGE_SIZE = 50;

/** Reverse lookup uses the frozen full-name matching rule, never product-title inference. */
export function DependencyLookupDialog({
  enabled,
  initialName,
  onClose,
  onSelectProduct,
}: {
  enabled: boolean;
  initialName: string;
  onClose: () => void;
  onSelectProduct: (productId: string) => void;
}) {
  const gateway = useGateway();
  const [name, setName] = useState(initialName);
  const [request, setRequest] = useState<{ name: string; offset: number } | null>(
    initialName.length === 0 ? null : { name: initialName, offset: 0 },
  );
  const [view, setView] = useState<DependenciesLookupView | "loading" | null>(null);
  useEffect(() => {
    if (!enabled || request === null) return;
    let active = true;
    setView("loading");
    void gateway.dependencies.lookup({ ...request, limit: PAGE_SIZE }).then((result) => {
      if (active) setView(result);
    }).catch(() => {
      if (active) setView({ kind: "absent" });
    });
    return () => { active = false; };
  }, [enabled, gateway, request]);

  const page = (offset: number) => {
    if (request === null) return;
    setView("loading");
    setRequest({ ...request, offset });
  };
  return <ContentDialog open={enabled} title={copy.title}
    closeLabel={strings.common.dialogClose} onClose={onClose}>
    <div className="vua-compatible-items vua-dependency-lookup">
      <p className="vua-caption vua-text-secondary" role="note">{copy.boundary}</p>
      <form className="vua-dependency-lookup__form" onSubmit={(event) => {
        event.preventDefault();
        if (!enabled || !/\S/u.test(name)) return;
        setView("loading");
        setRequest({ name, offset: 0 });
      }}>
        <label htmlFor="dependency-lookup-name">{copy.nameLabel}</label>
        <input id="dependency-lookup-name" className="vua-warehouse__search" value={name}
          onChange={(event) => setName(event.target.value)} />
        <Button type="submit" disabled={!/\S/u.test(name)}>{copy.search}</Button>
      </form>
      <div aria-live="polite">
        {view === null ? <p className="vua-caption vua-text-secondary">{copy.idle}</p>
          : view === "loading" ? <Skeleton width="100%" height={36} />
          : view.kind === "absent" ? <p className="vua-caption vua-text-secondary">{cluesCopy.absent}</p>
          : view.kind === "error" ? <p className="vua-caption vua-text-secondary">{strings.warehouse.states.loadFailedDescription}</p>
          : <>
            <p className="vua-caption vua-text-secondary">{format(copy.resultCount, { name: request?.name ?? "", count: view.total })}</p>
            {view.matches.length === 0 ? <p className="vua-caption vua-text-secondary">{copy.empty}</p>
              : <ul className="vua-compatible-items__list" role="list">
                {view.matches.map((match, index) => <li className="vua-compatible-items__row" key={`${match.productId}:${index}`}>
                  <div className="vua-compatible-items__main">
                    <span className="vua-compatible-items__name">{match.productTitle ?? match.productId}</span>
                    <Badge>{match.resolvedProductId === null ? cluesCopy.unconfirmed : cluesCopy.confirmedLink}</Badge>
                  </div>
                  <p className="vua-caption vua-text-secondary">{match.depName}{match.versionHint === null ? "" : ` · ${match.versionHint}`}</p>
                  <p className="vua-caption vua-text-secondary" title={match.rawQuote}>{match.rawQuote}</p>
                  <Button variant="subtle" onClick={() => onSelectProduct(match.productId)}>{copy.openProduct}</Button>
                </li>)}
              </ul>}
            <div className="vua-library-pagination">
              <Button variant="subtle" disabled={request === null || request.offset === 0}
                onClick={() => page(Math.max(0, (request?.offset ?? 0) - PAGE_SIZE))}>{strings.warehouse.libraryState.previousPage}</Button>
              <span className="vua-caption">{format(strings.warehouse.libraryState.page, {
                page: Math.floor((request?.offset ?? 0) / PAGE_SIZE) + 1, total: Math.max(1, Math.ceil(view.total / PAGE_SIZE)),
              })}</span>
              <Button variant="subtle" disabled={request === null || request.offset + PAGE_SIZE >= view.total}
                onClick={() => page((request?.offset ?? 0) + PAGE_SIZE)}>{strings.warehouse.libraryState.nextPage}</Button>
            </div>
          </>}
      </div>
    </div>
  </ContentDialog>;
}
