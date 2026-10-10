import { describe, expect, it, vi } from "vitest";
import { CATALOG_SYNC_DEFAULT_START_URL } from "./catalog-sync.js";
import { probeBoothAuthentication } from "./booth-auth.js";

describe("BOOTH account probe", () => {
  it("reports no authenticated session without contacting BOOTH when account storage is empty", async () => {
    const session = { signInHint: vi.fn(async () => "none" as const), fetchWithSession: vi.fn() };
    expect(await probeBoothAuthentication(session)).toEqual({ authOk: false, accountName: null });
    expect(session.fetchWithSession).not.toHaveBeenCalled();
  });
  it.each(["stored", "unknown"] as const)("uses the actual library response for a %s hint", async hint => {
    const session = { signInHint: async () => hint, fetchWithSession: vi.fn(async () => ({ status: 200, body: '<header data-user-name="Synthetic account"></header>', finalUrl: CATALOG_SYNC_DEFAULT_START_URL })) };
    expect(await probeBoothAuthentication(session)).toEqual({ authOk: true, accountName: "Synthetic account" });
    expect(session.fetchWithSession).toHaveBeenCalledWith(CATALOG_SYNC_DEFAULT_START_URL, expect.any(AbortSignal));
  });
  it.each([
    { status: 200, body: '<form action="/users/auth/pixiv">', finalUrl: CATALOG_SYNC_DEFAULT_START_URL },
    { status: 200, body: '<header data-user-name="Synthetic account">', finalUrl: "https://accounts.booth.pm/users/sign_in" },
    { status: 503, body: "Unavailable", finalUrl: CATALOG_SYNC_DEFAULT_START_URL },
  ])("does not treat an incomplete login, redirect or HTTP failure as authentication", async response => {
    const session = { signInHint: async () => "stored" as const, fetchWithSession: async () => response };
    expect(await probeBoothAuthentication(session)).toEqual({ authOk: false, accountName: null });
  });
  it("keeps a network failure unauthenticated without leaking its contents", async () => {
    const session = { signInHint: async () => "stored" as const, fetchWithSession: async () => { throw new Error("synthetic transport failure"); } };
    expect(await probeBoothAuthentication(session)).toEqual({ authOk: false, accountName: null });
  });
});
