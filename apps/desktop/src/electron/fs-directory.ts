import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  DesktopFsEntryV1,
  DesktopFsErrorV1,
  DesktopFsListV1,
  DesktopFsResultV1,
  DesktopFsNavigationV1,
} from "@vua/contracts";

const runFile = promisify(execFile);

/** Names only: avoids probing offline/removable/network drives for readiness. */
export async function listFsNavigation(known: Omit<DesktopFsNavigationV1, "drives">, readDrives?: () => Promise<readonly string[]>): Promise<DesktopFsResultV1<DesktopFsNavigationV1>> {
  try {
    let roots: string[];
    if (process.platform === "win32") {
      if (!readDrives) return { ok: false, error: "failed" };
      roots = [...await readDrives()];
      if (roots.some(root => !/^[A-Za-z]:\\$/.test(root))) return { ok: false, error: "failed" };
    } else roots = ["/"];
    return { ok: true, value: { ...known, drives: [...new Set(roots)].sort().map(root => ({ name: root, path: root, hidden: false })) } };
  } catch { return { ok: false, error: "failed" }; }
}
/** Fixed trusted host executable, with a read-only native mode. No shell/.NET
 * startup and no scans of removable or disconnected network volumes. */
export async function readNativeDriveRoots(executable: string): Promise<readonly string[]> {
  const { stdout } = await runFile(executable, ["--list-drives"], { windowsHide: true, timeout: 3000, maxBuffer: 16384 });
  const value: unknown = JSON.parse(stdout);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("invalid_native_drive_snapshot");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 2 || v.schemaVersion !== "0.1" || !Array.isArray(v.drives) || v.drives.length > 26 || v.drives.some(drive => typeof drive !== "string" || !/^[A-Z]:\\$/.test(drive))) throw Error("invalid_native_drive_snapshot");
  return v.drives as string[];
}

/**
 * 本地文件系统窄面的 Main 侧实现(2026-09-25 用户裁决:素材导入应用内
 * 文件夹选择器,DesktopFsApiV1 契约面):
 * - listDirectory:fs.promises.readdir withFileTypes,仅子目录进词表
 *  (素材包以文件夹为单位导入,文件不列);
 * - createDirectory:单层 mkdir(不 recursive)——已存在 = already_exists
 *  诚实呈现,不猜测不覆盖;
 * - 全部失败内收于结果信封(ENOENT→not_found / ENOTDIR→not_a_directory /
 *  EPERM·EACCES→access_denied / EEXIST→already_exists / 其余→failed),
 *  本面永不抛——渲染层按 error 词表如实呈现,不借异常通道。
 */

/** Node fs 错误码 → 契约错误词表(未知/无码一律 failed,不猜测) */
export function mapFsError(error: unknown): DesktopFsErrorV1 {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "ENOENT") return "not_found";
  if (code === "ENOTDIR") return "not_a_directory";
  if (code === "EPERM" || code === "EACCES") return "access_denied";
  if (code === "EEXIST") return "already_exists";
  return "failed";
}

const WINDOWS_RESERVED_DEVICE_STEM = /^(CON|PRN|AUX|NUL|(COM|LPT)[1-9\u00B9\u00B2\u00B3])$/i;

/** 新建目录名校验(契约面 invalid_name 判据,渲染层同款预判据在
 *  folder-picker-model):非空、非 "." ".."、不含 "/" "\" 及 Windows
 *  保留路径字符、不含控制字符(0x00–0x1F / 0x7F)、不以空格或句点结尾、
 *  非 Windows 保留设备名、长度 ≤ 100 */
export function isValidNewDirectoryName(name: string): boolean {
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

export async function listFsDirectory(
  target: string | null,
  options?: { readonly showHidden?: boolean },
): Promise<DesktopFsResultV1<DesktopFsListV1>> {
  try {
    const resolved = target === null ? os.homedir() : target;
    const dirents = await fs.promises.readdir(resolved, { withFileTypes: true });
    const showHidden = options?.showHidden === true;
    const entries: DesktopFsEntryV1[] = dirents
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => ({
        name: dirent.name,
        path: path.join(resolved, dirent.name),
        // 诚实注释:Windows 隐藏属性检测经 Node fs 不可得(dirent 无属性
        // 访问面),hidden 仅以点前缀为启发式判据——属性级精确的隐藏检测
        // 不可用,如实呈现启发式结果,不冒充精确判定
        hidden: dirent.name.startsWith("."),
      }))
      .filter((entry) => showHidden || !entry.hidden)
      .sort((a, b) => a.name.localeCompare(b.name));
    const parent = path.dirname(resolved);
    return {
      ok: true,
      value: {
        path: resolved,
        // 根目录的 dirname 等于自身:无上可回,parent 如实为 null
        parent: parent === resolved ? null : parent,
        entries,
      },
    };
  } catch (error) {
    return { ok: false, error: mapFsError(error) };
  }
}

export async function createFsDirectory(
  parentPath: string,
  name: string,
): Promise<DesktopFsResultV1<{ readonly path: string }>> {
  if (!isValidNewDirectoryName(name)) return { ok: false, error: "invalid_name" };
  const target = path.join(parentPath, name);
  try {
    await fs.promises.mkdir(target);
    return { ok: true, value: { path: target } };
  } catch (error) {
    return { ok: false, error: mapFsError(error) };
  }
}
