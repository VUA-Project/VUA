import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "../../components/primitives/Badge.tsx";
import { ConfirmDialog } from "../../components/primitives/ConfirmDialog.tsx";
import { Toggle } from "../../components/primitives/Toggle.tsx";
import {
  useAcquireView,
  useGateway,
  type WarehouseArtifactMode,
  type WarehouseCommandOutcome,
} from "../../gateway/index.ts";
import { strings } from "../../i18n/index.ts";
import { useDeleteOriginalsAfterGenerate, shouldResetDeleteFlag } from "../../app/delete-originals-flag.ts";
import { useDownloadChecklist } from "../../app/download-checklist-flag.ts";
import { commandErrorText, inferGlobalDefaultMode, type GlobalDefaultInference } from "../warehouse/acquire-model.ts";

/**
 * 设置-实验性页(W15 重做形态,用户走查示意图 A/B):
 * - 卡片 = 标题「实验性功能」+ 副题 + 黄色警示条 + 两行开关;
 * - 行 1「生成 VPM 包替代」= 全局开关,写已冻结的 warehouse.setGlobalDefaultMode
 *   (bdl-commands v0.2 全局层);初值由条目读面推断(无覆盖条目的生效模式即
 *   composed 全局默认),推断不出时如实标注 unknown;写回执为服务端持久事实,
 *   直接更新开关态(推断仅是初值);
 * - 行 2「生成后删除原始素材文件」= 危险开关,主开关关闭时置灰,且主开关
 *   写回非 generate_vpm 时自动复位为关(裁决 11,A4 行 2 自动取消;清持久
 *   偏好,不溯已受理删除任务);开启必经危险确认对话框(示意图 B)。008 路径
 *   a 已接线(app 层 delete-originals-auto:生成完成→逐条目独立删除任务,
 *   守卫与审计在服务端);DEV/fixture 面保留「本原型不会真正删除任何文件」
 *   注记(mock/fixture 不出 DEV 纪律);
 * - 走查不通过重做:原 per-entry 条目选择器整组移除;007 的「生成 VPM 模式
 *   入口」偏好开关被全局开关语义取代(变更随 proposal 008 复核)。
 */

const copy = strings.settings.experimental;
const acquireCopy = strings.warehouse.acquire;

function commandErrorsTable(): Record<string, string> {
  return acquireCopy.commandErrors as Record<string, string>;
}

export function ExperimentalCommands() {
  const gateway = useGateway();
  const acquire = useAcquireView();
  const [deleteFlag, setDeleteFlag] = useDeleteOriginalsAfterGenerate();
  const [checklist, setChecklist] = useDownloadChecklist();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  /** 写回执的持久事实(优先于条目推断);null = 尚未写入 */
  const [persisted, setPersisted] = useState<GlobalDefaultInference | null>(null);

  const entries = acquire.kind === "entries" ? acquire.entries : null;
  const effective: GlobalDefaultInference =
    persisted ?? (entries === null ? { kind: "unknown" } : inferGlobalDefaultMode(entries));
  const generateOn = effective.kind === "known" && effective.mode === "generate_vpm";

  // 未连接/空仓库的诚实空态由调用方(页面)分层;此处 entries===null 时仅渲染开关区,
  // 推断为 unknown 并标注——写面仍可尝试(服务可用而读面空是合法组合)
  useEffect(() => {
    setFeedback(null);
  }, [entries]);

  function writeGlobalMode(mode: WarehouseArtifactMode): void {
    setBusy(true);
    setFeedback(null);
    void gateway.warehouseCommands.setGlobalDefaultMode(mode).then((outcome: WarehouseCommandOutcome) => {
      setBusy(false);
      if (outcome.ok && "global" in outcome) {
        setPersisted({ kind: "known", mode: outcome.global.globalDefaultMode });
        // 裁决 11(A4 行 2 自动取消):主开关关闭(写回非 generate_vpm)时,
        // 行 2 偏好自动复位为关(清持久偏好;已受理删除任务不溯——服务端
        // 独立审计,偏好只影响桌面发起时机)
        if (shouldResetDeleteFlag(outcome.global.globalDefaultMode)) {
          setDeleteFlag(false);
        }
      } else if (!outcome.ok) {
        setFeedback(commandErrorText(outcome.error, commandErrorsTable()));
      }
    });
  }

  return (
    <div className="vua-page__stack vua-exp-card">
      <header className="vua-exp-card__header">
        <div>
          <h2 className="vua-title">{copy.title}</h2>
          <p className="vua-caption vua-text-secondary">{copy.subtitle}</p>
        </div>
      </header>

      <div className="vua-exp-card__warning" role="note">
        ⚠ {copy.warning}
      </div>

      {/* 行 1:生成 VPM 包替代(全局默认模式写面;bdl-commands v0.2) */}
      <section className="vua-exp-card__row">
        <div className="vua-exp-card__text">
          <strong>{copy.generateTitle}</strong>
          <p className="vua-caption vua-text-secondary">{copy.generateDesc}</p>
          {effective.kind === "unknown" ? (
            <p className="vua-caption vua-text-secondary">{copy.globalReadUnknown}</p>
          ) : null}
          {feedback !== null ? (
            <p className="vua-caption vua-text-secondary" role="status">
              {feedback}
            </p>
          ) : null}
        </div>
        <Toggle
          on={generateOn}
          disabled={busy}
          label={copy.generateTitle}
          onToggle={() => writeGlobalMode(generateOn ? "use_original_unitypackage" : "generate_vpm")}
        />
      </section>

      {/* 行 3:下载前弹清单(N5 静默下载,2026-10-05 用户裁决):off = Steam
          式直下全部;on = 下载前弹文件勾选清单(默认全选) */}
      <section className="vua-exp-card__row">
        <div className="vua-exp-card__text">
          <strong>{copy.downloadChecklistTitle}</strong>
          <p className="vua-caption vua-text-secondary">{copy.downloadChecklistDesc}</p>
        </div>
        <Toggle
          on={checklist}
          label={copy.downloadChecklistTitle}
          onToggle={() => setChecklist(!checklist)}
        />
      </section>

      {/* 行 2:生成后删除原始素材文件(危险;未接线偏好,proposal 008 未决) */}
      <section className="vua-exp-card__row">
        <div className="vua-exp-card__text">
          <p className="vua-exp-card__row-title">
            <strong>{copy.deleteTitle}</strong>{" "}
            <Badge tone="error">{copy.deleteBadge}</Badge>
          </p>
          <p className="vua-caption vua-text-secondary">{copy.deleteDesc}</p>
        </div>
        <Toggle
          on={deleteFlag}
          disabled={busy || !generateOn}
          variant="danger"
          label={copy.deleteTitle}
          onToggle={() => {
            if (deleteFlag) {
              setDeleteFlag(false);
              return;
            }
            // 关闭无危险;开启必经危险确认对话框(示意图 B)
            setConfirmOpen(true);
          }}
        />
      </section>

      <ConfirmDialog
        open={confirmOpen}
        danger
        title={copy.dialogTitle}
        cancelLabel={copy.dialogCancel}
        confirmLabel={copy.dialogConfirm}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          setDeleteFlag(true);
        }}
      >
        <p className="vua-confirm-dialog__lede">
          {copy.dialogBodyA}
          <strong>{copy.dialogBodyEmphasis}</strong>
          {copy.dialogBodyB}
        </p>
        <div className="vua-confirm-dialog__warning">
          <p>{copy.dialogWarning}</p>
          {import.meta.env.DEV ? <p>{copy.devPrototypeNote}</p> : null}
        </div>
      </ConfirmDialog>
    </div>
  );
}
