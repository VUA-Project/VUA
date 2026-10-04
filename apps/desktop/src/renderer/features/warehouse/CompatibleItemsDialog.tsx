import { useEffect, useState } from "react";
import { Button } from "../../components/primitives/Button.tsx";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { Skeleton } from "../../components/primitives/Skeleton.tsx";
import { useGateway } from "../../gateway/GatewayProvider.tsx";
import type {
  DependenciesObservationsView,
  DependencyKindV05,
} from "../../gateway/dependencies-port.ts";
import { format, strings } from "../../i18n/index.ts";

const copy = strings.warehouse.compatibleDialog;

/**
 * 适配依赖小窗(N5 收口,卡片右键「显示适配商品」):
 * - 数据面 = dependencies.listByProduct 未过滤观察面(bdl-queries v0.5):
 *   逐条呈现页面声明的依赖名义(零归一化 depName + 逐字 rawQuote 证据),
 *   confirmed:false 的线索也如实列出——「线索非结论」律的呈现落点;
 * - 已消解(resolution 携 booth 商品身份)的行给「打开」动作,点击回卡片墙
 *   打开该商品详情抽屉;未消解 = 无动作,只有证据原文;
 * - 缺席(absent)/未入库(not-found)/空集各有诚实文案,绝不虚构线索。
 */
export function CompatibleItemsDialog({
  query,
  onClose,
  onSelectProduct,
}: {
  /** null = 关闭;否则为要反查的商品身份与展示名 */
  query: { readonly productId: string; readonly title: string } | null;
  onClose: () => void;
  /** 已消解行的打开动作:回到卡片墙打开该商品详情 */
  onSelectProduct: (productId: string) => void;
}) {
  const gateway = useGateway();
  const [view, setView] = useState<DependenciesObservationsView | "loading">("loading");

  useEffect(() => {
    if (query === null) return;
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
  }, [query, gateway]);

  return (
    <ContentDialog
      open={query !== null}
      title={format(copy.title, { name: query?.title ?? "" })}
      closeLabel={strings.common.dialogClose}
      onClose={onClose}
    >
      <div className="vua-compatible-items">
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
                </div>
                {/* 证据体:页面逐字引文(title 悬浮全文,行内截断) */}
                <p className="vua-caption vua-text-secondary" title={obs.rawQuote}>
                  {obs.rawQuote}
                </p>
                {resolved !== null ? (
                  <Button
                    variant="subtle"
                    onClick={() => onSelectProduct(resolved.productId)}
                  >
                    {copy.resolvedCta}
                  </Button>
                ) : null}
              </li>
              );
            })}
          </ul>
        )}
      </div>
    </ContentDialog>
  );
}
