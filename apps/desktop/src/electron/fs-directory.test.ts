import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import {
  createFsDirectory,
  isValidNewDirectoryName,
  listFsDirectory,
  mapFsError,
  listFsNavigation,
} from "./fs-directory.ts";

test("native navigation preserves supplied known folders and enumerates drive names without volume readiness checks", async () => {
  const known = { desktop: "D:\\Redirected\\Desktop", documents: "E:\\Documents", downloads: "F:\\Downloads" };
  const result = await listFsNavigation(known, async () => ["D:\\", "E:\\", "F:\\"]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual({ desktop: result.value.desktop, documents: result.value.documents, downloads: result.value.downloads }, known);
  assert.equal(result.value.drives.length > 0, true);
  assert.equal(result.value.drives.every(entry => entry.name === entry.path && !entry.hidden && (process.platform !== "win32" || /^[A-Za-z]:\\$/.test(entry.path))), true);
});

/**
 * 文件系统窄面(DesktopFsApiV1 的 Main 侧实现)纯行为覆盖:
 * 真实临时目录读写(零真实用户数据),错误码 → 契约错误词表映射、
 * 新建目录名校验闭集、仅子目录进词表、点前缀隐藏启发式、
 * parent 如实(根目录 null)。失败恒收信不抛。
 */

test("mapFsError: Node 错误码 → 契约六值词表,未知一律 failed 不猜测", () => {
  assert.equal(mapFsError(Object.assign(new Error("x"), { code: "ENOENT" })), "not_found");
  assert.equal(mapFsError(Object.assign(new Error("x"), { code: "ENOTDIR" })), "not_a_directory");
  assert.equal(mapFsError(Object.assign(new Error("x"), { code: "EACCES" })), "access_denied");
  assert.equal(mapFsError(Object.assign(new Error("x"), { code: "EPERM" })), "access_denied");
  assert.equal(mapFsError(Object.assign(new Error("x"), { code: "EEXIST" })), "already_exists");
  assert.equal(mapFsError(Object.assign(new Error("x"), { code: "EBUSY" })), "failed");
  assert.equal(mapFsError(new Error("no code")), "failed");
  assert.equal(mapFsError(null), "failed");
  assert.equal(mapFsError("str"), "failed");
});

test("isValidNewDirectoryName: 闭集校验——空/点/分隔符/控制字符/超长一律 invalid", () => {
  assert.equal(isValidNewDirectoryName("material-pack"), true);
  assert.equal(isValidNewDirectoryName("素材 2026"), true);
  assert.equal(isValidNewDirectoryName("a".repeat(100)), true, "边界 100 合法");
  assert.equal(isValidNewDirectoryName("a".repeat(101)), false, "超长 101 非法");
  assert.equal(isValidNewDirectoryName(""), false);
  assert.equal(isValidNewDirectoryName("."), false);
  assert.equal(isValidNewDirectoryName(".."), false);
  assert.equal(isValidNewDirectoryName("a/b"), false);
  assert.equal(isValidNewDirectoryName("a\\b"), false);
  assert.equal(isValidNewDirectoryName("a\u0000b"), false, "控制字符非法");
  assert.equal(isValidNewDirectoryName("a\u001Fb"), false, "0x1F 控制字符非法");
  assert.equal(isValidNewDirectoryName("a\u007Fb"), false, "0x7F DEL 控制字符非法");
  assert.equal(isValidNewDirectoryName("a\tb"), false, "TAB 属控制字符非法");
  assert.equal(isValidNewDirectoryName("trailing "), false, "Windows 尾部空格会被静默剥除");
  assert.equal(isValidNewDirectoryName("trailing."), false, "Windows 尾部句点会被静默剥除");
  assert.equal(isValidNewDirectoryName("bad:stream"), false, "NTFS ADS 冒号非法");
  assert.equal(isValidNewDirectoryName("bad*glob"), false, "通配符非法");
  assert.equal(isValidNewDirectoryName("CON"), false, "Windows 保留设备名非法");
  assert.equal(isValidNewDirectoryName("nul.pack"), false, "带扩展名的保留设备名非法");
  assert.equal(isValidNewDirectoryName("COM1"), false, "COM 端口保留名非法");
});

test("listFsDirectory: 仅子目录进词表(文件不列),字母序,parent 如实", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vua-fs-"));
  try {
    fs.mkdirSync(path.join(root, "zeta"));
    fs.mkdirSync(path.join(root, "alpha"));
    fs.mkdirSync(path.join(root, ".hidden-dir"));
    fs.writeFileSync(path.join(root, "file.txt"), "x");
    const listed = await listFsDirectory(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(listed.value.path, root);
    assert.equal(listed.value.parent, path.dirname(root));
    // 点前缀启发式:默认列表不含隐藏目录
    assert.deepEqual(
      listed.value.entries.map((entry) => entry.name),
      ["alpha", "zeta"],
    );
    assert.equal(listed.value.entries.every((entry) => entry.hidden === false), true);
    assert.equal(
      listed.value.entries.every((entry) => entry.path === path.join(root, entry.name)),
      true,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("listFsDirectory: showHidden 重列含隐藏目录且 hidden 标记如实", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vua-fs-"));
  try {
    fs.mkdirSync(path.join(root, ".hidden-dir"));
    fs.mkdirSync(path.join(root, "plain"));
    const listed = await listFsDirectory(root, { showHidden: true });
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    const hidden = listed.value.entries.find((entry) => entry.name === ".hidden-dir");
    const plain = listed.value.entries.find((entry) => entry.name === "plain");
    assert.equal(hidden?.hidden, true);
    assert.equal(plain?.hidden, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("listFsDirectory: 缺失路径 not_found;文件路径 not_a_directory;均收信不抛", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vua-fs-"));
  try {
    const missing = await listFsDirectory(path.join(root, "nope"));
    assert.deepEqual(missing, { ok: false, error: "not_found" });
    const filePath = path.join(root, "a-file");
    fs.writeFileSync(filePath, "x");
    const notDir = await listFsDirectory(filePath);
    assert.deepEqual(notDir, { ok: false, error: "not_a_directory" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("listFsDirectory: 卷根目录 parent 如实为 null(无上可回)", async () => {
  const root = path.parse(process.cwd()).root;
  const listed = await listFsDirectory(root);
  assert.equal(listed.ok, true);
  if (!listed.ok) return;
  assert.equal(listed.value.path, root);
  assert.equal(listed.value.parent, null);
});

test("createFsDirectory: 单层新建成功回路径;已存在 already_exists;父缺 not_found", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vua-fs-"));
  try {
    const created = await createFsDirectory(root, "new-pack");
    assert.equal(created.ok, true);
    if (created.ok) {
      assert.equal(created.value.path, path.join(root, "new-pack"));
      assert.equal(fs.statSync(created.value.path).isDirectory(), true);
    }
    const again = await createFsDirectory(root, "new-pack");
    assert.deepEqual(again, { ok: false, error: "already_exists" }, "不递归不覆盖,已存在如实呈现");
    const nested = await createFsDirectory(path.join(root, "missing-parent"), "child");
    assert.deepEqual(nested, { ok: false, error: "not_found" }, "父目录缺席 = ENOENT 如实呈现");
    const invalid = await createFsDirectory(root, "bad/name");
    assert.deepEqual(invalid, { ok: false, error: "invalid_name" }, "名字非法在进 fs 前拒绝");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
