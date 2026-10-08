import { useEffect, useMemo, useRef, useState } from "react";
import {
  useGateway,
  useTaskCenter,
  type CapabilityReport,
  type FixtureTaskPort,
  type TaskItem,
} from "../../gateway/index.ts";
import {
  activeTaskCount,
  canDismiss,
  isTerminalStatus,
  loadDismissedIds,
  saveDismissedId,
  visibleNotifications,
} from "./notification-model.ts";

/**
 * 通知中心共享状态(顶栏铃铛;底部任务条已退出主壳):
 * 任务事实来自 Gateway 快照,本 hook 只做呈现层投影(可见通知/进行中计数)
 * 与意图转发(取消/重试/清除),拒绝结果如实回传行内。
 */
export function useNotificationCenter() {
  const gateway = useGateway();
  const view = useTaskCenter();
  const [capability, setCapability] = useState<CapabilityReport | null>(null);
  const [rejectedId, setRejectedId] = useState<string | null>(null);
  // 通知中心(proposal 007 路径 b):已清除终态通知(持久化)与「显示已完成」视图开关;
  // 任务权威快照不动,清除只影响通知呈现,事实仍可经任务列表/详情面查询
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => loadDismissedIds());
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    let active = true;
    void gateway.task.capability().then((report) => {
      if (active) setCapability(report);
    });
    return () => {
      active = false;
    };
  }, [gateway]);

  // 通知投影:活动任务恒显;终态任务需「显示已完成」开启且未被清除
  const notifications = useMemo(
    () => visibleNotifications(view.tasks, dismissed, showCompleted),
    [view.tasks, dismissed, showCompleted],
  );

  const activeCount = useMemo(() => activeTaskCount(view.tasks), [view.tasks]);

  async function cancel(taskId: string) {
    const result = await gateway.task.cancel(taskId);
    setRejectedId(result.kind === "rejected" ? taskId : null);
  }

  // 重试 = 任务级动作:AMF 以冻结重试策略裁决,拒绝原因如实呈现
  async function retry(taskId: string) {
    const result = await gateway.task.retry(taskId);
    setRejectedId(result.kind === "rejected" ? taskId : null);
  }

  function dismiss(taskId: string) {
    setDismissed(saveDismissedId(taskId));
  }

  function dismissible(task: TaskItem): (() => void) | undefined {
    return isTerminalStatus(task.status) && canDismiss(task)
      ? () => dismiss(task.id)
      : undefined;
  }

  // DEV 演示回放:仅 fixture 任务端口实现该可选方法时才出现
  const replay =
    import.meta.env.DEV && "replayDemoEvents" in gateway.task
      ? () => (gateway.task as FixtureTaskPort).replayDemoEvents?.()
      : null;

  return {
    capability,
    tasks: view.tasks,
    notifications,
    activeCount,
    rejectedId,
    showCompleted,
    setShowCompleted,
    cancel,
    retry,
    dismissible,
    replay,
  };
}
