import { describe, expect, it } from "vitest";
import { currentStation, formatDuration, lineLabels, lineStations, lineStatus, phaseStatus, runStartedAt, stopsAt } from "./factory-model.ts";

const steps = (...pairs: [string, string][]) => pairs.map(([key, state]) => ({ key, state }));

describe("AMF production line stations", () => {
  it("follows a fresh preparation through intake", () => {
    const line = { phase: "preparing" as const, steps: steps(["project", "succeeded"], ["materials", "succeeded"], ["inspect", "running"]) };
    expect(lineStations(line)).toEqual({ prepare: "done", inspect: "running", plan: "todo", assemble: "todo", check: "todo" });
    expect(currentStation(lineStations(line))).toBe("inspect");
    expect(lineStatus(line)).toBe("running");
  });

  it("treats a reinspection that runs under a failed phase as running", () => {
    const line = { phase: "failed" as const, steps: steps(["project", "succeeded"], ["materials", "succeeded"], ["inspect", "failed"], ["reinspect", "running"]) };
    expect(lineStations(line).inspect).toBe("running");
    expect(lineStatus(line)).toBe("running");
  });

  it("waits for the player at the assembly plan once intake succeeded", () => {
    const line = { phase: "ready" as const, steps: steps(["project", "succeeded"], ["materials", "succeeded"], ["inspect", "failed"], ["reinspect", "succeeded"]) };
    const states = lineStations(line);
    expect(states).toEqual({ prepare: "done", inspect: "done", plan: "waiting", assemble: "todo", check: "todo" });
    expect(currentStation(states)).toBe("plan");
    expect(lineStatus(line)).toBe("waiting");
  });

  it("finishes every station after a successful assembly", () => {
    const line = { phase: "succeeded" as const, steps: steps(["project", "succeeded"], ["materials", "succeeded"], ["inspect", "succeeded"], ["snapshot", "succeeded"], ["assembly", "succeeded"]) };
    expect(Object.values(lineStations(line)).every(state => state === "done")).toBe(true);
    expect(currentStation(lineStations(line))).toBe("check");
  });

  it("marks the failing station and the line as needing attention", () => {
    const line = { phase: "failed" as const, steps: steps(["project", "succeeded"], ["materials", "succeeded"], ["inspect", "failed"]) };
    expect(lineStations(line).inspect).toBe("failed");
    expect(lineStatus(line)).toBe("attention");
    expect(phaseStatus("cancelled")).toBe("stopped");
    expect(phaseStatus("stopped")).toBe("stopped");
  });

  it("shows a stopped step as stopped and keeps the line at that station", () => {
    const line = { phase: "stopped" as const, steps: steps(["project", "succeeded"], ["materials", "succeeded"], ["inspect", "stopped"]) };
    expect(lineStations(line).inspect).toBe("stopped");
    expect(currentStation(lineStations(line))).toBe("inspect");
    expect(lineStatus(line)).toBe("stopped");
    expect(lineStatus({ phase: "inspecting" as const, steps: steps(["reinspect", "running"]) })).toBe("running");
  });

  it("stops at more stations as the automation level lowers", () => {
    expect([...stopsAt("auto")]).toEqual(["plan"]);
    expect([...stopsAt("semi")]).toEqual(["plan", "check"]);
    expect(stopsAt("manual").size).toBe(5);
  });

  it("formats durations as minutes and seconds", () => {
    expect(formatDuration(161_000)).toBe("2:41");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
  });
});

describe("telling production lines apart", () => {
  const time = (date: Date) => date.toISOString().slice(5, 16).replace("T", " ");
  it("reads the start time from the run ID", () => {
    expect(runStartedAt("n3-01a1455e-7790-7006-a7c0-000100000003")?.toISOString()).toBe(new Date(0x01a1455e7790).toISOString());
    expect(runStartedAt("not-a-run")).toBeNull();
  });
  it("adds the start time only where names repeat, and a number within one minute", () => {
    const labels = lineLabels([
      { runId: "n3-01a14184-826d-7000-a900-000100000000", sourceNames: ["Meiyun_v2.1.0.zip", "TshirtShorts.zip"] },
      { runId: "n3-01a1455e-7790-7006-a7c0-000100000003", sourceNames: ["Meiyun_v2.1.0.zip", "TshirtShorts.zip"] },
      { runId: "n3-01a1455e-7791-7006-a7c0-000100000004", sourceNames: ["Meiyun_v2.1.0.zip", "TshirtShorts.zip"] },
      { runId: "n3-01a14445-0b30-7000-a140-000100000000", sourceNames: ["Meiyun_v2.1.0.zip", "Costume4.zip"] },
    ], time);
    expect(labels.get("n3-01a14445-0b30-7000-a140-000100000000")).toEqual({ name: "Meiyun_v2.1.0 + Costume4", extra: null });
    expect(labels.get("n3-01a14184-826d-7000-a900-000100000000")?.extra).not.toContain("#");
    expect(labels.get("n3-01a1455e-7790-7006-a7c0-000100000003")?.extra).toMatch(/#1$/u);
    expect(labels.get("n3-01a1455e-7791-7006-a7c0-000100000004")?.extra).toMatch(/#2$/u);
  });
});
