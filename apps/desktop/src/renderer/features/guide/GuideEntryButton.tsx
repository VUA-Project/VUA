/**
 * 「查看操作指南」入口按钮(首玩 B 切片):部署页检查项 / 部署计划步骤 /
 * 网络面板按标识给出定位映射时出现。纪律:
 * - 指南是静态内容,入口不经检测 capability 门控,也不伪造检测结果或
 *   完成状态;
 * - 无映射(null)不渲染——不伪造指向;
 * - 无 preload 宿主(浏览器直开)点击幂等无动作。
 */
import { Button } from "../../components/primitives/Button.tsx";
import type { GuideTarget } from "./guide-target.ts";

export function GuideEntryButton({
  target,
  label,
}: {
  target: GuideTarget | null;
  label: string;
}) {
  if (target === null) return null;
  return (
    <Button
      variant="subtle"
      data-guide-entry={target.section ?? target.topic}
      onClick={() => void window.vua?.window.showGuide?.(target)}
    >
      {label}
    </Button>
  );
}
