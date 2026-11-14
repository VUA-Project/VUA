import type { DesktopFsErrorV1 } from "@vua/contracts";
import { storageKeys } from "../../app/storage-keys.ts";

/**
 * 应用内文件夹选择器的呈现纯函数(2026-09-25 用户裁决,本地导入段):
 * - 上次浏览目录记忆(storageKeys.importLastFolder,裸路径字符串;
 *   缺失/非字符串 = 诚实缺席,回落用户主目录,不猜测不修复);
 * - 新建目录名校验(与 Main 侧 fs-directory.isValidNewDirectoryName
 *   同款判据,渲染层先做 UX 预检,权威判定仍在 Main);
 * - 选取合流(重复拾取去重累加,语义见 ImportPage 本地段);
 * - 父目录推导(Windows "/" "\" 双分隔符,盘根无上 null);
 * - 契约错误 → 词面 key 映射(失败如实呈现,不借用其它面文案)。
 */

/** 上次浏览目录:localStorage 缺席/不可用/值非字符串一律 null(诚实缺席) */
export function loadLastFolder(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(storageKeys.importLastFolder);
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/** 记忆浏览目录:存储不可用时仅本次会话失效(不抛) */
export function saveLastFolder(folder: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(storageKeys.importLastFolder, folder);
  } catch {
    /* 存储不可用时仅本次会话失效 */
  }
}

const WINDOWS_RESERVED_DEVICE_STEM = /^(CON|PRN|AUX|NUL|(COM|LPT)[1-9\u00B9\u00B2\u00B3])$/i;

/** 新建目录名校验闭集(与 Main 侧同款):非空、≤100、非 "." ".."、
 *  不含 "/" "\" 及 Windows 保留字符、不含控制字符(0x00–0x1F / 0x7F)、
 *  不以空格或句点结尾、非 Windows 保留设备名 */
export function isValidNewFolderName(name: string): boolean {
  if (name.length === 0 || name.length > 100) return false;
  if (name === "." || name === "..") return false;
  if (name.endsWith(" ") || name.endsWith(".")) return false;
  if (/[<>:"/\\|?*]/.test(name)) return false;
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return false;
  }
  const stem = (name.split(".")[0] ?? "").trim();
  if (WINDOWS_RESERVED_DEVICE_STEM.test(stem)) return false;
  return true;
}

/** 选取合流:既有保持序,新选取追加,去重(大小写敏感,路径事实
 *  原样比较);既有 null(尚无待确认清单)= 新选取副本 */
export function mergeUniqueFolders(
  existing: readonly string[] | null,
  picked: readonly string[],
): readonly string[] {
  const merged = existing === null ? [...picked] : [...existing];
  for (const folder of picked) {
    if (!merged.includes(folder)) merged.push(folder);
  }
  return merged;
}

/** 父目录推导:双分隔符、尾分隔符剥除;无分隔符或盘根(C:)无上可回 null */
export function parentDirOf(target: string): string | null {
  const trimmed = target.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index < 0) return null;
  const parent = trimmed.slice(0, index);
  if (parent === "" || /^[A-Za-z]:$/.test(parent)) return null;
  return parent;
}

/** 列目录失败 → 词面 key(列表面不会返回 invalid_name/already_exists,
 *  词表外错误如实给通用 failed) */
export function listErrorCopyKey(
  error: DesktopFsErrorV1,
): "errorNotFound" | "errorNotDirectory" | "errorAccessDenied" | "errorFailed" {
  if (error === "not_found") return "errorNotFound";
  if (error === "not_a_directory") return "errorNotDirectory";
  if (error === "access_denied") return "errorAccessDenied";
  return "errorFailed";
}

/** 新建失败 → 词面 key(名字问题给名字文案,环境问题给通用文案) */
export function createErrorCopyKey(
  error: DesktopFsErrorV1,
):
  | "newFolderInvalid"
  | "newFolderExists"
  | "errorNotFound"
  | "errorNotDirectory"
  | "errorAccessDenied"
  | "errorFailed" {
  if (error === "invalid_name") return "newFolderInvalid";
  if (error === "already_exists") return "newFolderExists";
  if (error === "not_found") return "errorNotFound";
  if (error === "not_a_directory") return "errorNotDirectory";
  if (error === "access_denied") return "errorAccessDenied";
  return "errorFailed";
}
