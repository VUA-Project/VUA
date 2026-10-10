import assert from "node:assert/strict";
import { test } from "vitest";
import { TOUR_STEPS, firstTourRequired, normalizeStep, parseTourProgress, serializeTourProgress } from "./tour-model.ts";

test("the welcome scene precedes real, unique controls across the available VUA areas", () => {
  assert.equal(TOUR_STEPS[0]?.id, "welcome");
  assert.equal(TOUR_STEPS[0]?.anchor, null);
  assert.equal(new Set(TOUR_STEPS.map(step => step.id)).size, TOUR_STEPS.length);
  for (const step of TOUR_STEPS.slice(1)) {
    assert.ok(step.page && step.anchor && /^[.[]/.test(step.anchor), step.id);
  }
  for (const id of ["route", "network", "checks", "plan", "tools", "creator", "tasks", "guide", "settings"]) {
    assert.ok(TOUR_STEPS.some(step => step.id === id), id);
  }
});

test("a returning V1 tour resumes the same content after new scenes are inserted", () => {
  for (const [step, id] of ["route", "network", "checks", "plan", "tasks", "guide"].entries()) {
    const progress = parseTourProgress(JSON.stringify({ v: 1, status: "active", step }));
    assert.equal(progress?.v, 2);
    assert.equal(TOUR_STEPS[progress!.step]?.id, id);
  }
  for (const status of ["completed", "skipped"]) {
    assert.deepEqual(parseTourProgress(JSON.stringify({ v: 1, status, step: 4 })), { v: 2, status, step: 0 });
    assert.equal(firstTourRequired(false, JSON.stringify({ v: 1, status, step: 4 })), false);
  }
});

test("first use shows the tour before the wizard; existing profiles do not auto-start it", () => {
  assert.equal(firstTourRequired(false, null), true);
  assert.equal(firstTourRequired(false, "invalid"), true);
  assert.equal(firstTourRequired(false, '{"v":2,"status":"active","step":2}'), true);
  assert.equal(firstTourRequired(false, '{"v":2,"status":"completed","step":0}'), false);
  assert.equal(firstTourRequired(false, '{"v":2,"status":"skipped","step":0}'), false);
  assert.equal(firstTourRequired(true, null), false);
});

test("corrupt, unknown and noninteger progress does not silently become a completed tour", () => {
  for (const raw of [null, undefined, "", "not-json", "42", "[1,2]", '{"v":3,"status":"active","step":0}', '{"v":2,"status":"running","step":0}', '{"v":2,"status":"active","step":"2"}', '{"v":2,"status":"active"}']) {
    assert.equal(parseTourProgress(raw), null);
  }
  assert.equal(normalizeStep(-1, 6), 0);
  assert.equal(normalizeStep(99, 6), 5);
  assert.equal(normalizeStep(Number.NaN, 6), 0);
  assert.equal(normalizeStep(2.9, 6), 2);
  assert.equal(normalizeStep(0, 0), 0);
});

test("V2 progress round-trips and terminal progress discards the old step", () => {
  const active = { v: 2 as const, status: "active" as const, step: 3 };
  assert.deepEqual(parseTourProgress(serializeTourProgress(active)), active);
  assert.deepEqual(parseTourProgress(serializeTourProgress({ v: 2, status: "skipped", step: 3 })), { v: 2, status: "skipped", step: 0 });
});
