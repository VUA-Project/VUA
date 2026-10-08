import { useSyncExternalStore } from "react";

/**
 * 窗口级登录浏览器(用户裁决 2026-10-05):BOOTH 登录不再借用素材导入弹窗
 * ——那是已决议废弃的过渡形态。本模块是开启意图的唯一入口;关闭回执经
 * 订阅派发(仓储页据此重探登录态,空态卡翻为同步引导)。
 *
 * 状态极小(开启意图一枚),远程视图的生命周期归 LoginBrowserOverlay
 * 组件(它订阅本 store 开视图、卸载即关视图,纪律同 EmbeddedBrowsePanel
 * 的 #25/#37);本 store 不持有任何 Electron 对象。
 */

export interface LoginBrowserRequest {
  readonly url: string;
}

let request: LoginBrowserRequest | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** 打开登录浏览器(仓储空态登录卡调用);已在开时重复调用为 no-op */
export function openLoginBrowser(url: string): void {
  if (request !== null) return;
  request = { url };
  notify();
}

/** 关闭登录浏览器(倒计时到点/用户 ×/组件卸载);已关时为 no-op */
export function closeLoginBrowser(): void {
  if (request === null) return;
  request = null;
  notify();
}

export function subscribeLoginBrowser(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): LoginBrowserRequest | null {
  return request;
}

export function useLoginBrowserRequest(): LoginBrowserRequest | null {
  return useSyncExternalStore(subscribeLoginBrowser, snapshot, snapshot);
}
