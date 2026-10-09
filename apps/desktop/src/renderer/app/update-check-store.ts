/**
 * 版本检测(2026-09-19 用户裁决:默认开启、设置可关;下载/应用更新属
 * Phase C 独立提案,本模块只承载只读探测的开关与结果缓存):
 * - 开关:localStorage 为事实来源,absent = 开(默认开启),"off" = 关;
 * - 缓存:最近一次 UpdateCheckResultV1 落 localStorage,供开屏角标与设置页
 *   冷启动呈现;形状非法 = 诚实缺席(null),不修复不猜测;
 * - 同窗口跨页同步走自定义事件,storage 事件兜底多窗口;
 * - 检测动作经 window.vua.system.checkUpdate(壳内 Main → GitHub latest
 *   release);preload 缺席(DEV 浏览器预览)时安静不动作。
 */
import { useEffect, useState } from "react";
import type { UpdateCheckResultV1 } from "@vua/contracts";
import { storageKeys } from "./storage-keys.ts";

const CHANGED_EVENT = "vua-update-check-changed";

export function loadUpdateCheckEnabled(): boolean {
  try {
    return localStorage.getItem(storageKeys.updateCheckEnabled) !== "off";
  } catch {
    return true;
  }
}

export function saveUpdateCheckEnabled(on: boolean): void {
  try {
    localStorage.setItem(storageKeys.updateCheckEnabled, on ? "on" : "off");
  } catch {
    /* 存储不可用时仅本次会话生效 */
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

/** 缓存形状守卫(词表外键/类型不符 = 缺席,不猜测) */
export function isUpdateCheckResultV1(value: unknown): value is UpdateCheckResultV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 6
    || keys[0] !== "checkedAt"
    || keys[1] !== "currentVersion"
    || keys[2] !== "latestVersion"
    || keys[3] !== "releaseUrl"
    || keys[4] !== "schemaVersion"
    || keys[5] !== "state") {
    return false;
  }
  if (record.schemaVersion !== 1) return false;
  if (record.state !== "newer-available" && record.state !== "up-to-date" && record.state !== "check-failed") {
    return false;
  }
  const nullableString = (v: unknown) => v === null || typeof v === "string";
  return typeof record.currentVersion === "string"
    && typeof record.checkedAt === "string"
    && nullableString(record.latestVersion)
    && nullableString(record.releaseUrl);
}

export function loadUpdateCheckCache(): UpdateCheckResultV1 | null {
  try {
    const raw = localStorage.getItem(storageKeys.updateCheckCache);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isUpdateCheckResultV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveUpdateCheckCache(result: UpdateCheckResultV1): void {
  try {
    localStorage.setItem(storageKeys.updateCheckCache, JSON.stringify(result));
  } catch {
    /* 存储不可用时仅本次会话生效 */
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

/**
 * 执行一次检测并落缓存:自动检测遵守开关,显式手动检查仍可执行;
 * checkUpdate 本身永不抛(失败 = check-failed),此处仍兜底拒 Promise
 * 以防御 preload 漂移。
 */
export async function runUpdateCheck({ manual = false }: { manual?: boolean } = {}): Promise<UpdateCheckResultV1 | null> {
  if (!manual && !loadUpdateCheckEnabled()) return null;
  const system = window.vua?.system;
  if (!system) return null;
  try {
    const result = await system.checkUpdate();
    if (!isUpdateCheckResultV1(result)) return null;
    saveUpdateCheckCache(result);
    return result;
  } catch {
    return null;
  }
}

export function useUpdateCheckEnabled(): boolean {
  const [on, setOn] = useState(loadUpdateCheckEnabled);
  useEffect(() => {
    const sync = () => setOn(loadUpdateCheckEnabled());
    window.addEventListener(CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return on;
}

export function useUpdateCheckCache(): UpdateCheckResultV1 | null {
  const [cache, setCache] = useState(loadUpdateCheckCache);
  useEffect(() => {
    const sync = () => setCache(loadUpdateCheckCache());
    window.addEventListener(CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return cache;
}
