/**
 * Overlay 端口实例:Overlay 表面唯一的端口装配点。
 *
 * 017 表面批 1 消费接线后生产装配 = live 端口(经 Desktop Gateway,见
 * overlay-port-live.ts)。无 preload 宿主(浏览器预览)时 GatewayClient
 * 全部 invoke 返回 unavailable → 快照诚实缺席空态,不再需要 inactive
 * 占位实现。仅显式 overlayPreview=1 的 DEV 预览装配演示端口,
 * 加载守卫与 main.tsx 的 PreviewLabPage 同模式:import.meta.env.DEV 折叠 +
 * 动态 import——生产构建中该分支是死代码,demo chunk 不产出,check-leak
 * 以 fixture 文案指纹把守(mock 不出 DEV)。
 *
 * 端口是同步取值语义(表面渲染前同步拿到端口对象,与 create.ts 的装配惯例
 * 一致):先返回 live 实例;demo 模块就绪后切换内层端口,并向全部订阅者
 * 重发最新快照——从 live 事实过渡到演示快照经既有订阅路径生效,无第二套
 * 通知机制。
 */
import type { OverlaySurfacePort, Unsubscribe } from "./overlay-port.ts";
import { createHostOverlayPort, createLiveOverlayPort } from "./overlay-port-live.ts";
import { createGatewayClient } from "../../gateway/index.ts";
import type { OverlaySnapshot } from "./overlay-contract.ts";

let inner: OverlaySurfacePort = window.vua?.amfModule
  ? createHostOverlayPort(createGatewayClient(window.vua), window.vua.amfModule)
  : createLiveOverlayPort(createGatewayClient(window.vua));
let innerUnsubscribe: Unsubscribe | null = null;
const listeners = new Set<(snapshot: OverlaySnapshot) => void>();

const fanOut = (snapshot: OverlaySnapshot) => {
  for (const listener of listeners) listener(snapshot);
};

/** 内层订阅随订阅者有无而建立/断开(无订阅者时事件重取不空转) */
function bindInner() {
  innerUnsubscribe?.();
  innerUnsubscribe = listeners.size > 0 ? inner.subscribe(fanOut) : null;
}

function activateInner(next: OverlaySurfacePort) {
  inner = next;
  bindInner();
  void inner.snapshot().then(fanOut);
}

export const overlayPort: OverlaySurfacePort = {
  snapshot: () => inner.snapshot(),
  subscribe: (callback) => {
    listeners.add(callback);
    if (innerUnsubscribe === null) bindInner();
    return () => {
      listeners.delete(callback);
      if (listeners.size === 0) {
        innerUnsubscribe?.();
        innerUnsubscribe = null;
      }
    };
  },
  dispatch: (action, payload) => inner.dispatch(action, payload),
};

export const overlayPreviewEnabled = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get("overlayPreview") === "1";

if (overlayPreviewEnabled) {
  void import("./demo/overlay-demo-port.ts").then((module) => {
    activateInner(module.createDemoOverlayPort());
  });
}
