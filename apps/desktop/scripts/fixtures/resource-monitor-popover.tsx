// Actual DOM with a synthetic V2 resource host; not native hardware evidence.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ResourceMonitor } from "../../src/renderer/features/resource-monitor/ResourceMonitor.tsx";
import { strings } from "../../src/renderer/i18n/index.ts";
import type { SystemResourceUsageV2 } from "@vua/contracts";

const root = createRoot(document.getElementById("root")!);
const wait = (ms = 40) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const results: string[] = [];
function check(ok: unknown, name: string) {
  if (!ok) throw new Error(name);
  results.push(name);
}

/* ---- 合成 system 宿主:载荷由 mode 切换(full / ram-only / fail) ---- */
const GIB = 1024 ** 3;
type UsageMode = "full" | "ram-only" | "fail";
let usageMode: UsageMode = "full";
let pollFailures = 0;
function snapshot(): SystemResourceUsageV2 {
  return {
    schemaVersion: 2,
    cpuUsagePercent: usageMode === "ram-only" ? null : 20,
    gpuUsagePercent: usageMode === "ram-only" ? null : 80,
    gpuName: "Synthetic GPU",
    gpuKind: "discrete",
    ramUsedBytes: 24 * GIB,
    ramTotalBytes: 50 * GIB,
    vramUsedBytes: usageMode === "ram-only" ? null : 5.5 * GIB,
    vramTotalBytes: usageMode === "ram-only" ? null : 34 * GIB,
    sampledAt: new Date().toISOString(),
  };
}
function installSystemHost(): void {
  (window as any).vua = {
    system: {
      readResourceUsageV2: async () => {
        if (usageMode === "fail") {
          pollFailures += 1;
          throw new Error("synthetic transport failure");
        }
        return snapshot();
      },
    },
  };
}

/* ---- 宿主:key 变更强制重挂(轮询 effect 仅在挂载时读宿主) ---- */
function Harness() {
  const [gen, setGen] = useState(0);
  (window as any).__remount = () => setGen((g) => g + 1);
  return (
    <StrictMode>
      <ResourceMonitor key={gen} />
    </StrictMode>
  );
}

function toggle(): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(".vua-shell__usage");
  if (!found) throw new Error("usage indicator button missing");
  return found;
}
function indicatorAbsent(): boolean {
  return document.querySelector(".vua-shell__usage") === null;
}
function panel(): ParentNode | null {
  return document.querySelector(".vua-usage-panel");
}
async function key(value: string) {
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
  );
  await wait();
}
const copy = strings.resourceMonitor;


/* ---- ①无宿主诚实缺席:桩未装,轮询不挂,整条不出现 ---- */
async function hostAbsentHonestAbsence() {
  check(indicatorAbsent(), "无宿主时指示器整条缺席(不渲染占位假陈述)");
}

/* ---- ②宿主在场:余量按四项读数平均,弹层四项词面＋aria ---- */
async function indicatorAndPanelFullFace() {
  installSystemHost();
  (window as any).__remount();
  await wait();
  const button = toggle();
  check(button.textContent?.includes("59%"), "顶栏显示四项平均余量=59%");
  check(button.getAttribute("aria-expanded") === "false", "初始 aria-expanded=false");
  button.click();
  await wait();
  const layer = panel();
  check(layer !== null, "点击展开详情弹层(portal 至 body)");
  check(button.getAttribute("aria-expanded") === "true", "展开后 aria-expanded=true");
  const text = layer!.textContent ?? "";
  check(text.includes(copy.title), "弹层标题词面在场");
  check(text.includes(copy.ram), "RAM 行标签在场");
  check(text.includes(copy.vram), "VRAM 行标签在场");
  check(layer!.querySelectorAll('[role="meter"]').length === 4, "CPU/GPU/RAM/VRAM 四个 meter 在场");
  check(text.includes("24.0 / 50.0 GB"), "RAM 字节读数 GiB 口径");
  check(text.includes("5.5 / 34.0 GB"), "VRAM 字节读数 GiB 口径");
  check(text.includes("48%") && text.includes("16%"), "双行百分比读数在场");
  check(!layer!.querySelector("time"), "详情不显示采样时间");
  check(text.includes(copy.cpu) && text.includes(copy.gpu) && text.includes("80%") && text.includes("20%"), "CPU/GPU 行显示已测百分比");
}

/* ---- ③四条关闭路径 ---- */
async function closePaths() {
  // Esc
  await key("Escape");
  await wait();
  check(panel() === null, "Esc 关闭弹层");
  check(toggle().getAttribute("aria-expanded") === "false", "Esc 后 aria-expanded 复位");
  // 外击
  toggle().click();
  await wait();
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  await wait();
  check(panel() === null, "弹层外点击关闭");
  // × 按钮
  toggle().click();
  await wait();
  const close = document.querySelector<HTMLButtonElement>(".vua-usage-panel__close");
  check(close !== null, "× 关闭按钮在场");
  check(close!.getAttribute("aria-label") === copy.closeAria, "× 按钮具名(aria-label)");
  close!.click();
  await wait();
  check(panel() === null, "× 关闭弹层");
  // 失焦
  toggle().click();
  await wait();
  check(panel() !== null, "失焦场景前置:弹层已开");
  window.dispatchEvent(new Event("blur"));
  await wait();
  check(panel() === null, "窗口失焦关闭弹层");
}

/* ---- ④开合循环(无断言;真实注册数由跑具 CDP 断言) ---- */
async function lifecycleCycles() {
  for (let cycle = 0; cycle < 3; cycle += 1) {
    toggle().click();
    await wait();
    toggle().click();
    await wait();
  }
}

/* ---- ⑤VRAM 不可用诚实词面 ---- */
async function vramUnavailableHonestFace() {
  usageMode = "ram-only";
  (window as any).__remount();
  await wait();
  check(toggle().textContent?.includes("52%"), "仅 RAM 可用时按 RAM 计算余量，不把缺失读数当作零");
  toggle().click();
  await wait();
  const text = panel()?.textContent ?? "";
  check(text.includes(copy.unavailable), "VRAM 采集不可用如实呈现「不可用」词面");
  check(!text.includes("16%"), "不可用时不渲染 VRAM 百分比(不编造读数)");
  await key("Escape");
  await wait();
  check(panel() === null, "不可用场景收尾:弹层已关");
}

/* ---- ⑥a 单拍失败清除上一帧,不把历史读数作为当前状态 ---- */
async function singlePollFailureDropsFrame() {
  usageMode = "fail";
  await wait(2_300);
  check(pollFailures >= 1, "至少经历一拍合成失败");
  check(indicatorAbsent(), "IPC 失败时停止显示旧读数");
}

/* ---- ⑥b 首拍即败:重挂后无任何成功帧 → 诚实缺席 ---- */
async function firstPollFailureHonestAbsence() {
  (window as any).__remount();
  await wait();
  await wait(2_300);
  check(
    indicatorAbsent(),
    "首拍未回即诚实缺席(无宿主同形:整条不出现,不渲染假读数)",
  );
  usageMode = "full";
}

// base/failureFaces 各返回「本阶段新增」快照:results 系模块级累计数组,
// 直接返回同一引用会让跑具把 base 阶段断言双计(集成第 200 批勘误:
// 「50」系计数伪影,唯一断言 29=21 行为+1 CDP+7 失败面)。
window.resourceMonitorSmoke = {
  base: async () => {
    const start = results.length;
    root.render(<Harness />);
    await wait();
    await hostAbsentHonestAbsence();
    await indicatorAndPanelFullFace();
    await closePaths();
    return results.slice(start);
  },
  lifecycleCycles,
  failureFaces: async () => {
    const start = results.length;
    await vramUnavailableHonestFace();
    await singlePollFailureDropsFrame();
    await firstPollFailureHonestAbsence();
    return results.slice(start);
  },
  run: async () => {
    const base = await window.resourceMonitorSmoke.base();
    await lifecycleCycles();
    const faces = await window.resourceMonitorSmoke.failureFaces();
    return [...base, ...faces];
  },
};
