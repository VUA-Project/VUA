import { useEffect, useRef } from "react";
import { useAmfModule, useAcquireView, useGateway } from "../gateway/index.ts";
import { newlyGeneratedEntryIds } from "../features/warehouse/acquire-model.ts";
import { useDeleteOriginalsAfterGenerate } from "./delete-originals-flag.ts";

/**
 * 008 路径 a 桌面接线(W19,proposal 008 仲裁):「生成后删除原始素材文件」
 * 偏好开启时,检测到条目新完成生成(条目事实:两次快照间出现 generated_vpm
 * 工件——任务面快照不携带条目身份,条目读面是域内可得的等价信号)即对 该
 * 条目调用既有条目级 deleteOriginals。
 *
 * 不变式遵守(008 仲裁):每次删除是独立审计任务(服务端守卫与审计照常);
 * 桌面只握发起时机;触发是一次性的(快照差分),失败不重试(失败任务在任务
 * 中心如实呈现,可手动补发起);开关关闭时只维护快照不触发。
 */
export function useAutoDeleteOriginals(): void {
  const amf = useAmfModule();
  const acquire = useAcquireView();
  const gateway = useGateway();
  const [deleteFlag] = useDeleteOriginalsAfterGenerate();
  const previousIds = useRef<ReadonlySet<string> | null>(null);

  useEffect(() => {
    if (amf.state !== "ready") { previousIds.current = null; return; }
    if (acquire.kind !== "entries") return;
    const fresh = deleteFlag && previousIds.current !== null ? newlyGeneratedEntryIds(previousIds.current, acquire.entries) : [];
    previousIds.current = new Set(acquire.entries.filter(
      (entry) => entry.artifacts.some((artifact) => artifact.role === "generated_vpm"),
    ).map((entry) => entry.warehouseItemId));
    for (const warehouseItemId of fresh) {
      void gateway.warehouseCommands.deleteOriginals(warehouseItemId).then(() => {
        /* 受理/拒绝都进任务面(独立审计);此处不重试、不建第二事实源 */
      });
    }
  }, [acquire, deleteFlag, gateway, amf.state]);
}
