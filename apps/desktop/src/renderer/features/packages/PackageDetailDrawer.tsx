import { useState } from "react";
import { Badge } from "../../components/primitives/Badge.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { CopyableText } from "../../components/primitives/CopyableText.tsx";
import { openExternalUrl } from "../../app/open-external.ts";
import { strings } from "../../i18n/index.ts";
import type { PackageRow } from "../../gateway/index.ts";
import { rowStatus } from "./packages-model.ts";

const copy = strings.packages;

/**
 * 包详情抽屉(S-XVI):右侧内嵌抽屉,不遮挡列表操作;Esc 关闭。
 * 只呈现端口事实(描述/版本/来源/changelog 链接),无编辑能力;
 * changelog 走系统浏览器,调用失败显式提示(不静默吞掉)。
 */
export function PackageDetailDrawer({
  row,
  onClose,
}: {
  row: PackageRow;
  onClose: () => void;
}) {
  const [openFailed, setOpenFailed] = useState(false);
  const status = rowStatus(row);
  return (
    <aside
      className="vua-packages__drawer"
      aria-label={copy.drawer.aria}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="vua-packages__drawer-header">
        <h2 className="vua-packages__drawer-title" title={row.displayName}>
          {row.displayName}
        </h2>
        {/* autoFocus:焦点进抽屉,Esc 立即可用 */}
        <Button variant="subtle" autoFocus aria-label={copy.drawer.closeAria} onClick={onClose}>
          {copy.drawer.close}
        </Button>
      </div>
      <div className="vua-packages__drawer-body">
        <div>
          <Badge tone="neutral">{copy.sources[row.source]}</Badge>{" "}
          <Badge tone={status === "updateAvailable" ? "brand" : "neutral"}>
            {copy.states[status]}
          </Badge>
        </div>
        {row.description ? (
          <section>
            <h3 className="vua-packages__drawer-section-title">
              {copy.drawer.descriptionHeading}
            </h3>
            <p className="vua-caption vua-text-secondary">{row.description}</p>
          </section>
        ) : null}
        <section>
          <h3 className="vua-packages__drawer-section-title">{copy.drawer.factsHeading}</h3>
          <dl className="vua-packages__facts">
            <div className="vua-packages__facts-row">
              <dt>{copy.drawer.installedLabel}</dt>
              <dd>{row.installedVersion ?? copy.states.notInstalled}</dd>
            </div>
            <div className="vua-packages__facts-row">
              <dt>{copy.drawer.latestLabel}</dt>
              <dd>{row.latestVersion ?? "—"}</dd>
            </div>
            <div className="vua-packages__facts-row">
              <dt>{copy.drawer.sourceLabel}</dt>
              <dd>{copy.sources[row.source]}</dd>
            </div>
            <div className="vua-packages__facts-row">
              <dt>{copy.drawer.idLabel}</dt>
              <dd>
                <CopyableText
                  value={row.id}
                  copyLabel={copy.drawer.idLabel}
                  copiedLabel={strings.aiTools.copied}
                />
              </dd>
            </div>
          </dl>
        </section>
        {row.changelogUrl ? (
          <section>
            <div>
              <Button
                variant="default"
                onClick={() => {
                  setOpenFailed(false);
                  const url = row.changelogUrl;
                  if (!url) return;
                  void openExternalUrl(url).then((ok) => {
                    if (!ok) setOpenFailed(true);
                  });
                }}
              >
                {copy.drawer.changelogCta}
              </Button>
            </div>
            {openFailed ? (
              <p className="vua-caption vua-text-secondary">{copy.drawer.changelogFailed}</p>
            ) : null}
          </section>
        ) : null}
      </div>
    </aside>
  );
}

