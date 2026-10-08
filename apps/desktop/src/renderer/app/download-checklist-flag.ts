/**
 * 「下载前弹清单」偏好(N5 静默下载,用户裁决 2026-10-05):localStorage 为
 * 事实来源,自定义事件做同窗口跨页同步(仓储页右键与设置页开关注同值)。
 * 缺省 off = Steam 式直下全部文件;on = 下载前弹文件勾选清单(默认全选)。
 */
import { useEffect, useState } from "react";
import { storageKeys } from "./storage-keys.ts";

const CHANGED_EVENT = "vua-download-checklist-changed";

export function loadDownloadChecklist(): boolean {
  try {
    return localStorage.getItem(storageKeys.downloadChecklist) === "on";
  } catch {
    return false;
  }
}

export function saveDownloadChecklist(on: boolean): void {
  try {
    localStorage.setItem(storageKeys.downloadChecklist, on ? "on" : "off");
  } catch {
    /* 存储不可用时仅本次会话生效 */
  }
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
}

export function useDownloadChecklist(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(loadDownloadChecklist);
  useEffect(() => {
    const sync = () => setOn(loadDownloadChecklist());
    window.addEventListener(CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return [on, saveDownloadChecklist];
}
