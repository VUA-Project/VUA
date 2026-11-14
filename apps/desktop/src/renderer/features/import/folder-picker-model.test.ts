import assert from "node:assert/strict";
import { test, vi } from "vitest";
import {
  createErrorCopyKey,
  isValidNewFolderName,
  listErrorCopyKey,
  loadLastFolder,
  mergeUniqueFolders,
  parentDirOf,
  saveLastFolder,
} from "./folder-picker-model.ts";
import { storageKeys } from "../../app/storage-keys.ts";

/**
 * 应用内文件夹选择器纯函数覆盖(2026-09-25 用户裁决,本地导入段):
 * 记忆存取的形状守卫与 try/catch、新建名校验闭集、合流去重、
 * 父目录推导(Windows 双分隔符/盘根)、契约错误 → 词面 key 映射。
 * localStorage 以桩替身注入(测试环境无 DOM 存储)。
 */

function stubStorage(initial: Record<string, string> = {}) {
  const backing = new Map<string, string>(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (backing.has(key) ? backing.get(key)! : null),
    setItem: (key: string, value: string) => {
      backing.set(key, String(value));
    },
    removeItem: (key: string) => {
      backing.delete(key);
    },
  });
  return backing;
}

test("loadLastFolder: 记忆命中原样返回;缺席/空串/非字符串一律 null(诚实缺席)", () => {
  const backing = stubStorage({ [storageKeys.importLastFolder]: "C:/Users/me/materials" });
  assert.equal(loadLastFolder(), "C:/Users/me/materials");
  backing.delete(storageKeys.importLastFolder);
  assert.equal(loadLastFolder(), null, "缺席 = null");
  backing.set(storageKeys.importLastFolder, "");
  assert.equal(loadLastFolder(), null, "空串 = null(回落主目录)");
  vi.unstubAllGlobals();
});

test("loadLastFolder/saveLastFolder: 存取往返;存储抛错时安静降级不炸裂", () => {
  const backing = stubStorage();
  saveLastFolder("D:/assets/pack");
  assert.equal(backing.get(storageKeys.importLastFolder), "D:/assets/pack");
  assert.equal(loadLastFolder(), "D:/assets/pack");
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  });
  assert.equal(loadLastFolder(), null, "读取抛错 = 诚实缺席");
  saveLastFolder("C:/x");
  vi.unstubAllGlobals();
});

test("isValidNewFolderName: 闭集与 Main 侧判据一致", () => {
  assert.equal(isValidNewFolderName("material-pack"), true);
  assert.equal(isValidNewFolderName("素材 2026"), true);
  assert.equal(isValidNewFolderName("a".repeat(100)), true, "边界 100 合法");
  assert.equal(isValidNewFolderName("a".repeat(101)), false);
  assert.equal(isValidNewFolderName(""), false);
  assert.equal(isValidNewFolderName("."), false);
  assert.equal(isValidNewFolderName(".."), false);
  assert.equal(isValidNewFolderName("a/b"), false);
  assert.equal(isValidNewFolderName("a\\b"), false);
  assert.equal(isValidNewFolderName("a\u0000b"), false);
  assert.equal(isValidNewFolderName("a\u001Fb"), false);
  assert.equal(isValidNewFolderName("a\u007Fb"), false);
  assert.equal(isValidNewFolderName("tab\tname"), false);
  assert.equal(isValidNewFolderName("pack "), false);
  assert.equal(isValidNewFolderName("pack."), false);
  assert.equal(isValidNewFolderName("a:b"), false);
  assert.equal(isValidNewFolderName("CON"), false);
  assert.equal(isValidNewFolderName("lpt9.dir"), false);
});

test("mergeUniqueFolders: 既有保持序 + 新增去重追加;空选取不改清单", () => {
  assert.deepEqual(mergeUniqueFolders(null, ["C:/a", "C:/b"]), ["C:/a", "C:/b"]);
  assert.deepEqual(
    mergeUniqueFolders(["C:/a"], ["C:/b", "C:/a", "C:/c"]),
    ["C:/a", "C:/b", "C:/c"],
    "重复项不二次入列,新项保持选取序",
  );
  assert.deepEqual(mergeUniqueFolders(["C:/a"], []), ["C:/a"], "空选取不改清单");
  // 返回新数组,不原地改既有(React 状态纪律)
  const existing = ["C:/a"] as const;
  const merged = mergeUniqueFolders(existing, ["C:/b"]);
  assert.deepEqual(existing, ["C:/a"]);
  assert.notEqual(merged, existing);
});

test("parentDirOf: Windows 双分隔符与盘根;无上可回 null", () => {
  assert.equal(parentDirOf("C:\\Users\\me\\packs"), "C:\\Users\\me");
  assert.equal(parentDirOf("C:/Users/me/packs"), "C:/Users/me");
  assert.equal(parentDirOf("C:/Users/me/"), "C:/Users");
  assert.equal(parentDirOf("C:\\"), null, "盘根无上");
  assert.equal(parentDirOf("C:"), null, "盘根无上");
  assert.equal(parentDirOf("packs"), null, "无分隔符无上");
});

test("listErrorCopyKey/createErrorCopyKey: 契约错误词表 → 呈现词面,不借用他面文案", () => {
  assert.equal(listErrorCopyKey("not_found"), "errorNotFound");
  assert.equal(listErrorCopyKey("not_a_directory"), "errorNotDirectory");
  assert.equal(listErrorCopyKey("access_denied"), "errorAccessDenied");
  assert.equal(listErrorCopyKey("failed"), "errorFailed");
  assert.equal(listErrorCopyKey("invalid_name"), "errorFailed", "词表外错误给通用词面");
  assert.equal(createErrorCopyKey("invalid_name"), "newFolderInvalid");
  assert.equal(createErrorCopyKey("already_exists"), "newFolderExists");
  assert.equal(createErrorCopyKey("not_found"), "errorNotFound", "建目录途中父目录被移走如实呈现");
  assert.equal(createErrorCopyKey("access_denied"), "errorAccessDenied");
  assert.equal(createErrorCopyKey("failed"), "errorFailed");
});
