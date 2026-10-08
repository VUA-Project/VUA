import { createRoot } from "react-dom/client";
import type { VuaDesktopApiV1 } from "@vua/contracts";
import "@vua/design-system/tokens.css";
import "@vua/design-system/base.css";

let cancelled: string | null = null;
window.vua = {
  gateway: { invoke: async (request: { method: string; params?: { taskId?: string } }) => {
    if (request.method === "task.requestCancellation") {
      cancelled = request.params?.taskId ?? null;
      return { ok: true, value: { outcome: "requested" } };
    }
    return { ok: true, value: {
      tasks: [{ taskId: "synthetic-live-task", state: "running", correlationId: "synthetic" }],
      productionCard: { currentPlan: { planId: "synthetic-plan", planStatus: "ready", createdAt: "2026-10-09T00:00:00Z", recipeId: "synthetic-recipe" }, latestRecord: null },
    } };
  } },
  events: { subscribe: () => () => {} },
  window: { overlayViewEvents: { subscribe: () => () => {} }, guideTargetEvents: { subscribe: () => () => {} } },
} as unknown as VuaDesktopApiV1;

const { DesktopOverlaySurface } = await import("../../src/renderer/features/overlay/DesktopOverlaySurface.tsx");
const { strings } = await import("../../src/renderer/i18n/index.ts");
const root = createRoot(document.getElementById("root")!);
root.render(<DesktopOverlaySurface />);
const wait = async (predicate: () => unknown) => {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 5000) throw new Error("Task-window condition timed out");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
};
const review = {
  async expectTheme(theme: string) {
    await wait(() => document.documentElement.dataset.theme === theme);
    const background = getComputedStyle(document.querySelector(".vua-overlay")!).backgroundColor;
    if (theme === "light" && background === "rgb(11, 10, 18)") throw new Error("Task window still paints the dark canvas");
    return `Tasks follows ${theme} appearance`;
  },
  async run() {
    await wait(() => document.querySelector(".vua-overlay__task-title"));
    await new Promise(resolve => setTimeout(resolve, 350));
    const checks: string[] = [];
    const check = (name: string, value: unknown) => { if (!value) throw new Error(name); checks.push(name); };
    check("ordinary development task window keeps Gateway task facts", document.querySelector(".vua-overlay__task-title")?.textContent === "synthetic-live-task");
    check("Tasks has no guidance switch or guide content", !document.querySelector('[role="tablist"], .vua-overlay-guide'));
    check("actual tasks are not labelled demonstration data", !document.body.textContent?.includes(strings.common.fixtureBadge));
    check("task title identifies Tasks", document.querySelector(".vua-overlay__title")?.textContent === strings.journey.tasks);
    const details = document.querySelector<HTMLDetailsElement>(".vua-overlay__production-details")!;
    check("production details start collapsed", !!details && !details.open);
    details.querySelector<HTMLElement>("summary")!.click();
    await wait(() => details.open);
    check("production details remain available on demand", details.textContent?.includes("synthetic-plan"));
    const cancel = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes(strings.overlay.actions.requestCancel))!;
    await wait(() => !cancel.disabled);
    cancel.click(); await wait(() => cancelled === "synthetic-live-task");
    check("task cancellation targets the actual queue card", cancelled === "synthetic-live-task");
    return checks;
  },
};
(window as unknown as { taskWindowReview: typeof review }).taskWindowReview = review;
