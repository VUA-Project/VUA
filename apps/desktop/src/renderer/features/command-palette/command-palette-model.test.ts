import assert from "node:assert/strict";
import { test } from "vitest";
import {
  filterCommands,
  moveCursor,
  type CommandItem,
} from "./command-palette-model.ts";

function cmd(id: string, label: string, keywords?: string): CommandItem {
  return { id, group: "pages", label, ...(keywords !== undefined ? { keywords } : {}), run: () => {} };
}

const commands = [cmd("warehouse", "仓库", "warehouse"), cmd("recipe", "配方", "recipe graph"), cmd("release", "出厂", "release")];

test("空查询返回全部命令,保持注册序", () => {
  assert.deepEqual(filterCommands(commands, "").map((c) => c.id), ["warehouse", "recipe", "release"]);
  assert.deepEqual(filterCommands(commands, "   ").map((c) => c.id), ["warehouse", "recipe", "release"]);
});

test("大小写不敏感;中文与关键词均可匹配", () => {
  assert.deepEqual(filterCommands(commands, "RECIPE").map((c) => c.id), ["recipe"]);
  assert.deepEqual(filterCommands(commands, "配").map((c) => c.id), ["recipe"]);
  assert.deepEqual(filterCommands(commands, "graph").map((c) => c.id), ["recipe"]);
});

test("前缀命中排在中间命中之前", () => {
  const list = [cmd("a", "出厂设置"), cmd("b", "设置")];
  assert.deepEqual(filterCommands(list, "设置").map((c) => c.id), ["b", "a"]);
});

test("无匹配返回空列表", () => {
  assert.deepEqual(filterCommands(commands, "不存在"), []);
});

test("光标循环:到头回卷,空列表恒 0,越界收敛末项", () => {
  assert.equal(moveCursor(0, -1, 3), 2);
  assert.equal(moveCursor(2, 1, 3), 0);
  assert.equal(moveCursor(5, 0, 3), 2);
  assert.equal(moveCursor(0, 1, 0), 0);
});

test("supports multi-token and full-width NFKC queries across label, hint, and keywords", () => {
  const rich: CommandItem[] = [
    { id: "pink", group: "guide", label: "Pink / broken materials", hint: "Avatars", keywords: "变粉 shader magenta", run: () => {} },
    { id: "vrcft", group: "pages", label: "VRCFaceTracking", hint: "Tools", keywords: "face tracking 面捕", run: () => {} },
  ];
  assert.deepEqual(filterCommands(rich, "pink shader").map((c) => c.id), ["pink"]);
  assert.deepEqual(filterCommands(rich, "变粉 avatars").map((c) => c.id), ["pink"]);
  assert.deepEqual(filterCommands(rich, "ＶＲＣＦＴ　面捕").map((c) => c.id), ["vrcft"]);
});
