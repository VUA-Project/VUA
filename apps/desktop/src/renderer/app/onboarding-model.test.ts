import assert from "node:assert/strict";
import { test } from "vitest";
import {
  envGoalEnabled,
  goalEnabled,
  migratePageId,
  parseStoredGoals,
  resolveEntry,
  sanitizeGoals,
  serializeGoals,
  type StoredGoalsV1,
} from "./onboarding-model.ts";

const completedAll: StoredGoalsV1 = {
  version: 1,
  onboarding: "completed",
  goals: ["env", "production"],
  environments: ["play", "create"],
};

test("parse: invalid JSON, unknown version and missing fields are treated as not-onboarded", () => {
  assert.equal(parseStoredGoals(null), null);
  assert.equal(parseStoredGoals("not json{"), null);
  assert.equal(parseStoredGoals('"completed"'), null);
  assert.equal(parseStoredGoals(JSON.stringify({ version: 2, onboarding: "completed" })), null);
  assert.equal(parseStoredGoals(JSON.stringify({ version: 1, onboarding: "done" })), null);
  assert.equal(parseStoredGoals(JSON.stringify({ version: 1, onboarding: "completed" })), null);
  assert.equal(
    parseStoredGoals(JSON.stringify({ version: 1, onboarding: "completed", goals: [] })),
    null,
  );
});

test("parse: valid payload round-trips and unknown goal ids are dropped", () => {
  const parsed = parseStoredGoals(
    JSON.stringify({
      version: 1,
      onboarding: "skipped",
      goals: ["env", "bogus", "env"],
      environments: ["play", "bogus"],
    }),
  );
  assert.deepEqual(parsed, {
    version: 1,
    onboarding: "skipped",
    goals: ["env"],
    environments: ["play"],
  });
});

test("sanitize: unselecting env clears stale environment sub-goals", () => {
  // 勾选环境部署后又取消:旧子目标不得继续生效
  assert.deepEqual(sanitizeGoals(["production"], ["play", "create"]), {
    goals: ["production"],
    environments: [],
  });
  assert.deepEqual(sanitizeGoals(["env", "production"], ["create"]), {
    goals: ["env", "production"],
    environments: ["create"],
  });
});

test("serialize always writes a clean, parseable payload", () => {
  const raw = serializeGoals("completed", ["env", "production"], ["play"]);
  assert.deepEqual(parseStoredGoals(raw), {
    version: 1,
    onboarding: "completed",
    goals: ["env", "production"],
    environments: ["play"],
  });
  // 序列化前同样清洗:env 未选时 environments 落盘为空
  const cleared = serializeGoals("completed", ["production"], ["play"]);
  assert.deepEqual(parseStoredGoals(cleared)?.environments, []);
});

test("goal gates require both the env goal and the specific environment", () => {
  assert.equal(goalEnabled(completedAll, "production"), true);
  assert.equal(goalEnabled({ ...completedAll, goals: ["production"] }, "env"), false);
  assert.equal(goalEnabled(null, "env"), false);
  assert.equal(envGoalEnabled(completedAll, "play"), true);
  assert.equal(
    envGoalEnabled({ ...completedAll, environments: ["create"] }, "play"),
    false,
  );
  assert.equal(
    envGoalEnabled({ ...completedAll, goals: ["production"] }, "play"),
    false,
  );
});

test("sanitize drops retired goal ids from older stored payloads", () => {
  // 2026-09-26 用户裁决:工具合集/游戏引导目标退役——旧存储的 "tools"/"guide"
  // 当未知 id 丢弃
  assert.deepEqual(
    parseStoredGoals(
      JSON.stringify({
        version: 1,
        onboarding: "completed",
        goals: ["tools", "guide", "env"],
        environments: ["play"],
      }),
    ),
    { version: 1, onboarding: "completed", goals: ["env"], environments: ["play"] },
  );
});

test("legacy page ids migrate to the v0.3.2 IA", () => {
  assert.equal(migratePageId("deployer-play"), "env-play");
  assert.equal(migratePageId("deployer-create"), "env-create");
  assert.equal(migratePageId("warehouse"), "warehouse");
});

test("entry: unfinished onboarding cannot be bypassed by a stored last page", () => {
  assert.deepEqual(resolveEntry(null, "warehouse"), {
    showOnboarding: true,
    page: "home",
  });
  // 损坏数据同样视为未完成,不能被 vua-last-page 绕过
  assert.equal(resolveEntry(parseStoredGoals("{"), "warehouse").showOnboarding, true);
});

test("entry: completed onboarding restores a valid last page, legacy ids migrated", () => {
  assert.deepEqual(resolveEntry(completedAll, "workshop"), {
    showOnboarding: false,
    page: "workshop",
  });
  assert.deepEqual(resolveEntry(completedAll, "deployer-create"), {
    showOnboarding: false,
    page: "env-create",
  });
  // Unknown history falls back to the fixed Home directory (2026-10-08 user ruling).
  assert.deepEqual(resolveEntry(completedAll, "nope"), {
    showOnboarding: false,
    page: "home",
  });
  assert.deepEqual(resolveEntry(completedAll, "home"), {
    showOnboarding: false,
    page: "home",
  });
  assert.deepEqual(resolveEntry(completedAll, null), {
    showOnboarding: false,
    page: "home",
  });
});
