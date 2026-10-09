import { afterEach, expect, it, vi } from "vitest";
import { storageKeys } from "./storage-keys.ts";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it("dependency clues default off and persist the player's explicit choice", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  const { loadDependencyClues, saveDependencyClues } = await import("./dependency-clues-flag.ts");
  expect(loadDependencyClues()).toBe(false);
  saveDependencyClues(true);
  expect(values.get(storageKeys.dependencyClues)).toBe("on");
  expect(loadDependencyClues()).toBe(true);
  vi.resetModules();
  expect((await import("./dependency-clues-flag.ts")).loadDependencyClues()).toBe(true);
  saveDependencyClues(false);
  expect(values.get(storageKeys.dependencyClues)).toBe("off");
});

it("unavailable persistent storage still permits enabling and disabling for this window", async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("localStorage", {
    getItem: () => { throw new Error("storage unavailable"); },
    setItem: () => { throw new Error("storage unavailable"); },
  });
  const { loadDependencyClues, saveDependencyClues } = await import("./dependency-clues-flag.ts");
  expect(loadDependencyClues()).toBe(false);
  saveDependencyClues(true);
  expect(loadDependencyClues()).toBe(true);
  saveDependencyClues(false);
  expect(loadDependencyClues()).toBe(false);
});
