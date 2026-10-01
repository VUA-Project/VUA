import assert from "node:assert/strict";
import { test } from "vitest";
import {
  albumIndexFromOffset,
  catalogEmptyCard,
  emptyWarehouseQuery,
  hasActiveFilter,
  priceKind,
  toPortQuery,
} from "./warehouse-model.ts";

test("toPortQuery: 空表单不产生任何查询条件", () => {
  assert.deepEqual(toPortQuery(emptyWarehouseQuery), {});
});

test("toPortQuery: 文本去空白,空文本不下发", () => {
  assert.deepEqual(toPortQuery({ ...emptyWarehouseQuery, text: "   " }), {});
  assert.deepEqual(toPortQuery({ ...emptyWarehouseQuery, text: "  alpha " }), {
    text: "alpha",
  });
});

test("toPortQuery: 筛选条件逐项透传", () => {
  assert.deepEqual(
    toPortQuery({
      text: "x",
      availabilityStatus: "unavailable",
      entityType: "outfit",
      relationKind: "requires",
    }),
    {
      text: "x",
      availabilityStatus: "unavailable",
      entityType: "outfit",
      relationKind: "requires",
    },
  );
});

test("hasActiveFilter: 任一条件生效即为真(区分搜索空与未接入)", () => {
  assert.equal(hasActiveFilter(emptyWarehouseQuery), false);
  assert.equal(hasActiveFilter({ ...emptyWarehouseQuery, text: "a" }), true);
  assert.equal(
    hasActiveFilter({ ...emptyWarehouseQuery, availabilityStatus: "available" }),
    true,
  );
  assert.equal(hasActiveFilter({ ...emptyWarehouseQuery, entityType: "tool" }), true);
  assert.equal(hasActiveFilter({ ...emptyWarehouseQuery, relationKind: "addon_for" }), true);
});

test("priceKind: 0 为免费,缺价格为 none,其余按定价", () => {
  assert.equal(priceKind(null), "none");
  assert.equal(priceKind({ amount: "0", currency: "JPY" }), "free");
  assert.equal(priceKind({ amount: "500", currency: "JPY" }), "priced");
});

test("albumIndexFromOffset: 媒体区均分映射,边界 clamp", () => {
  // 5 张图:每段 20%,光标落入哪段显示哪张
  assert.equal(albumIndexFromOffset(0, 100, 5), 0);
  assert.equal(albumIndexFromOffset(19.9, 100, 5), 0);
  assert.equal(albumIndexFromOffset(20, 100, 5), 1);
  assert.equal(albumIndexFromOffset(99.9, 100, 5), 4);
  // 越界与退化输入 clamp,不抛错
  assert.equal(albumIndexFromOffset(-5, 100, 5), 0);
  assert.equal(albumIndexFromOffset(500, 100, 5), 4);
  assert.equal(albumIndexFromOffset(10, 0, 5), 0);
  assert.equal(albumIndexFromOffset(10, 100, 1), 0);
  assert.equal(albumIndexFromOffset(10, 100, 0), 0);
});

test("catalogEmptyCard: 无账户线索的空目录 → 登录引导卡", () => {
  assert.deepEqual(
    catalogEmptyCard({ remoteBrowser: true, signInHint: "none", filtered: false, catalogEmpty: true }),
    { kind: "sign-in" },
  );
});

test("catalogEmptyCard: stored/unknown/未探测 → 同步引导卡(探测失败不挡同步)", () => {
  for (const signInHint of ["stored", "unknown", null] as const) {
    assert.deepEqual(
      catalogEmptyCard({ remoteBrowser: true, signInHint, filtered: false, catalogEmpty: true }),
      { kind: "sync-available" },
    );
  }
});

test("catalogEmptyCard: 无远程浏览基座/筛选中/目录非空 → 保持通用空态", () => {
  assert.deepEqual(
    catalogEmptyCard({ remoteBrowser: false, signInHint: "none", filtered: false, catalogEmpty: true }),
    { kind: "hidden" },
  );
  assert.deepEqual(
    catalogEmptyCard({ remoteBrowser: true, signInHint: "none", filtered: true, catalogEmpty: true }),
    { kind: "hidden" },
  );
  assert.deepEqual(
    catalogEmptyCard({ remoteBrowser: true, signInHint: "none", filtered: false, catalogEmpty: false }),
    { kind: "hidden" },
  );
});
