import { describe, expect, it, vi } from "vitest";
import { startSignedInCatalogSync } from "./catalog-sync-model.ts";

describe("BOOTH sync authentication handoff", () => {
  it("opens login without starting sync for a missing or expired session", async () => {
    const remote = { authProbe: vi.fn(async () => ({ authOk: false, accountName: null })) };
    const sync = { start: vi.fn() };
    const login = vi.fn();
    expect(await startSignedInCatalogSync(remote, sync, { libraryType: "all" }, login)).toEqual({ status: "blocked", reason: "sign-in-required" });
    expect(remote.authProbe).toHaveBeenCalledOnce();
    expect(sync.start).not.toHaveBeenCalled();
    expect(login).toHaveBeenCalledOnce();
  });
  it("keeps unknown probe failures out of sync and does not invent a login result", async () => {
    const remote = { authProbe: vi.fn(async () => { throw new Error("probe unavailable"); }) };
    const sync = { start: vi.fn() };
    const login = vi.fn();
    await expect(startSignedInCatalogSync(remote, sync, { libraryType: "all" }, login)).rejects.toThrow("probe unavailable");
    expect(sync.start).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });
  it("retains the selected library and the existing running receipt after authentication", async () => {
    const remote = { authProbe: vi.fn(async () => ({ authOk: true, accountName: null })) };
    const receipt = { status: "already_running" as const, runId: "synthetic-running-sync" };
    const sync = { start: vi.fn(async () => receipt) };
    const login = vi.fn();
    expect(await startSignedInCatalogSync(remote, sync, { libraryType: "gifts" }, login)).toBe(receipt);
    expect(sync.start).toHaveBeenCalledWith({ libraryType: "gifts" });
    expect(login).not.toHaveBeenCalled();
  });
  it("opens login if the session expires between the probe and sync admission", async () => {
    const remote = { authProbe: vi.fn(async () => ({ authOk: true, accountName: null })) };
    const sync = { start: vi.fn(async () => ({ status: "blocked" as const, reason: "sign-in-required" as const })) };
    const login = vi.fn();
    expect((await startSignedInCatalogSync(remote, sync, { libraryType: "all" }, login)).status).toBe("blocked");
    expect(login).toHaveBeenCalledOnce();
  });
});
