import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { VrchatGatewayRequestV1 } from "@vua/contracts";
import { SDK_SESSION_FILE, vrchatSession, writeSdkSessionFile, type VrchatSessionService } from "./vrchat-session.js";
import type { VrchatAvatarLookup, VrchatClient, VrchatCookies, VrchatLoginStep, VrchatUser } from "./vrchat-client.js";

/** OS sealing, faked: the sealed blob is only reversible through the fake. */
function fakeSecrets() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`sealed:${value}`, "utf8"),
    decryptString: (value: Buffer) => {
      const text = value.toString("utf8");
      if (!text.startsWith("sealed:")) throw new Error("could not decrypt");
      return text.slice("sealed:".length);
    },
  };
}

const USER: VrchatUser = { id: "usr_1", username: "Aran", displayName: "Aran", thumbnailUrl: null };
const COOKIES: VrchatCookies = { auth: "auth-cookie", twoFactorAuth: "2fa-cookie" };

/** A scripted client: every call is answered by the current handler. */
function fakeClient(script: {
  login?: (username: string, password: string) => Promise<VrchatLoginStep>;
  verify?: (method: string, code: string, auth: string) => Promise<{ verified: boolean; twoFactorAuth: string | null }>;
  resend?: () => Promise<void>;
  currentUser?: (cookies: VrchatCookies) => Promise<VrchatUser | null>;
  logout?: () => Promise<void>;
  findAvatar?: (blueprintId: string) => Promise<VrchatAvatarLookup>;
  fetchThumbnail?: (url: string) => Promise<string | null>;
} = {}): VrchatClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    login: script.login ?? (async () => { throw new Error("unexpected login"); }),
    verifyTwoFactor: script.verify ?? (async () => { throw new Error("unexpected verify"); }),
    resendEmailCode: script.resend ?? (async () => { calls.push("resend"); }),
    currentUser: script.currentUser ?? (async () => USER),
    logout: script.logout ?? (async () => { calls.push("logout"); }),
    findAvatar: script.findAvatar ?? (async () => ({ kind: "missing", pages: 1 })),
    fetchThumbnail: script.fetchThumbnail ?? (async () => null),
  } as VrchatClient & { calls: string[] };
}

let directories: string[] = [];
function tempDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vua-vrchat-test-"));
  directories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true });
  directories = [];
});

function call(service: VrchatSessionService, method: VrchatGatewayRequestV1["method"], params: Record<string, unknown> = {}): Promise<unknown> {
  return service.handle({ schemaVersion: 1, requestId: "test", method, params: { commandId: "cmd", ...params } } as VrchatGatewayRequestV1);
}

const signIn = (service: VrchatSessionService, password = "pw-123", remember = false) =>
  call(service, "vrchat.signIn", { username: "Aran", password, rememberPassword: remember }) as Promise<{ outcome: string; methods?: string[] }>;

describe("experimental VRChat sign-in storage", () => {
  it("stays off until the risk is accepted, and never signs in while off", async () => {
    const directory = tempDirectory();
    const client = fakeClient();
    const service = vrchatSession({ directory, version: "1", secrets: fakeSecrets(), client });
    expect(await call(service, "vrchat.status")).toMatchObject({ enabled: false, state: "signed_out" });
    expect(await signIn(service)).toEqual({ outcome: "not_enabled" });
    expect(client.calls).toEqual([]);
  });

  it("completes an emailed-code sign-in and seals only the session, unless the password is remembered", async () => {
    const directory = tempDirectory();
    const client = fakeClient({
      login: async () => ({ kind: "two_factor", methods: ["emailotp"], auth: "partial" }),
      verify: async () => ({ verified: true, twoFactorAuth: "2fa-cookie" }),
    });
    const service = vrchatSession({ directory, version: "1", secrets: fakeSecrets(), client });
    await call(service, "vrchat.setExperimental", { enabled: true });
    expect(await signIn(service, "pw-123", false)).toEqual({ outcome: "two_factor_required", methods: ["emailotp"] });
    expect(await call(service, "vrchat.verifyCode", { method: "emailotp", code: "123456" })).toMatchObject({ outcome: "signed_in" });
    expect(await call(service, "vrchat.status")).toMatchObject({ enabled: true, state: "signed_in", account: { displayName: "Aran" }, rememberPassword: false });

    const secrets = fs.readFileSync(path.join(directory, "vrchat-secrets.json"), "utf8");
    expect(secrets).not.toContain("pw-123");
    expect(secrets).not.toContain("auth-cookie");
    const account = fs.readFileSync(path.join(directory, "vrchat-account.json"), "utf8");
    expect(account).not.toContain("pw-123");
    expect(account).not.toContain("cookie");
    const sealed = JSON.parse(secrets).encrypted as string;
    expect(Buffer.from(sealed, "base64").toString("utf8")).not.toContain("pw-123");
  });

  it("remembers the password only as a separate choice, sealed the same way", async () => {
    const directory = tempDirectory();
    const client = fakeClient({ login: async () => ({ kind: "session", user: USER, cookies: COOKIES }) });
    const service = vrchatSession({ directory, version: "1", secrets: fakeSecrets(), client });
    await call(service, "vrchat.setExperimental", { enabled: true });
    await signIn(service, "pw-123", true);
    expect(await call(service, "vrchat.status")).toMatchObject({ state: "signed_in", rememberPassword: true });
    const sealed = JSON.parse(fs.readFileSync(path.join(directory, "vrchat-secrets.json"), "utf8")).encrypted as string;
    const payload = Buffer.from(sealed, "base64").toString("utf8");
    expect(payload).toContain("pw-123");
    expect(fs.readFileSync(path.join(directory, "vrchat-secrets.json"), "utf8")).not.toContain("pw-123");
  });

  it("signs out but keeps the remembered password; forgetting removes everything", async () => {
    const directory = tempDirectory();
    const client = fakeClient({ login: async () => ({ kind: "session", user: USER, cookies: COOKIES }) });
    const service = vrchatSession({ directory, version: "1", secrets: fakeSecrets(), client });
    await call(service, "vrchat.setExperimental", { enabled: true });
    await signIn(service, "pw-123", true);
    await call(service, "vrchat.signOut");
    expect(client.calls).toContain("logout");
    expect(await call(service, "vrchat.status")).toMatchObject({ state: "signed_out", rememberPassword: true, account: null });
    // The remembered password can sign in again on its own.
    expect(await call(service, "vrchat.relogin")).toMatchObject({ outcome: "signed_in" });
    await call(service, "vrchat.forget");
    expect(fs.existsSync(path.join(directory, "vrchat-secrets.json"))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(directory, "vrchat-account.json"), "utf8")).rememberPassword).toBe(false);
    expect(await call(service, "vrchat.status")).toMatchObject({ enabled: true, state: "signed_out", rememberPassword: false });
  });

  it("turning the experimental switch off signs the player out and removes every stored value", async () => {
    const directory = tempDirectory();
    const client = fakeClient({ login: async () => ({ kind: "session", user: USER, cookies: COOKIES }) });
    const service = vrchatSession({ directory, version: "1", secrets: fakeSecrets(), client });
    await call(service, "vrchat.setExperimental", { enabled: true });
    await signIn(service, "pw-123", true);
    await call(service, "vrchat.setExperimental", { enabled: false });
    expect(await call(service, "vrchat.status")).toMatchObject({ enabled: false, state: "signed_out" });
    expect(fs.existsSync(path.join(directory, "vrchat-secrets.json"))).toBe(false);
  });

  it("renews an ended session with the remembered password, stopping at a new code", async () => {
    const directory = tempDirectory();
    const client = fakeClient({
      currentUser: async () => null,
      login: async () => ({ kind: "two_factor", methods: ["emailotp"], auth: "partial-2" }),
    });
    const service = vrchatSession({ directory, version: "1", secrets: fakeSecrets(), client });
    await call(service, "vrchat.setExperimental", { enabled: true });
    // A stored, remembered sign-in from an earlier launch.
    fs.writeFileSync(path.join(directory, "vrchat-account.json"), JSON.stringify({ version: "0.1", enabled: true, rememberPassword: true, displayName: "Aran", checkedAt: "2026-10-17T00:00:00Z" }));
    fs.writeFileSync(path.join(directory, "vrchat-secrets.json"), JSON.stringify({ version: "0.1",
      encrypted: Buffer.from(`sealed:${JSON.stringify({ username: "Aran", auth: "expired", twoFactorAuth: "gone", loginName: "Aran", password: "pw-123" })}`, "utf8").toString("base64") }));
    const restarted = vrchatSession({ directory, version: "1", secrets: fakeSecrets(), client });
    expect(await restarted.refresh()).toMatchObject({ state: "needs_code", pendingMethods: ["emailotp"] });
  });

  it("keeps a working session across restarts, and clears it when nothing is remembered", async () => {
    const directory = tempDirectory();
    const remembered = fakeClient({ login: async () => ({ kind: "session", user: USER, cookies: COOKIES }) });
    const service = vrchatSession({ directory, version: "1", secrets: fakeSecrets(), client: remembered });
    await call(service, "vrchat.setExperimental", { enabled: true });
    await signIn(service, "pw-123", false);
    const works = vrchatSession({ directory, version: "1", secrets: fakeSecrets(), client: fakeClient({ currentUser: async () => USER }) });
    expect(await works.refresh()).toMatchObject({ state: "signed_in" });
    expect(works.sdkSession()).toEqual({ username: "Aran", auth: "auth-cookie", twoFactorAuth: "2fa-cookie" });
    // A session VRChat ended, without a remembered password, is dropped.
    const expired = vrchatSession({ directory, version: "1", secrets: fakeSecrets(), client: fakeClient({ currentUser: async () => null }) });
    expect(await expired.refresh()).toMatchObject({ state: "signed_out" });
    expect(expired.sdkSession()).toBeNull();
  });

  it("checks uploads against the account's Avatar list and remembers just the check", async () => {
    const directory = tempDirectory();
    const blueprint = "avtr_7ce0e209-6069-40c2-8b23-4e6c2dad389a";
    const client = fakeClient({
      login: async () => ({ kind: "session", user: USER, cookies: COOKIES }),
      findAvatar: async id => id === blueprint
        ? { kind: "found", avatar: { id, name: "AMF test1", releaseStatus: "private", platforms: ["pc", "ios"], updatedAt: "2026-10-17T15:40:00Z" } }
        : { kind: "missing", pages: 1 },
    });
    const service = vrchatSession({ directory, version: "1", secrets: fakeSecrets(), client });
    await call(service, "vrchat.setExperimental", { enabled: true });
    await signIn(service);
    const check = await call(service, "vrchat.avatarCheck", { blueprintId: blueprint }) as Record<string, unknown>;
    expect(check).toMatchObject({ state: "found", avatar: { name: "AMF test1", releaseStatus: "private", platforms: ["pc", "ios"] } });
    expect(await call(service, "vrchat.avatarCheck", { blueprintId: "avtr_00000000-0000-4000-8000-000000000000" }))
      .toMatchObject({ state: "not_found" });
    const stored = JSON.parse(fs.readFileSync(path.join(directory, "vrchat-avatar-checks.json"), "utf8"));
    expect(Object.keys(stored.checks)).toEqual([blueprint, "avtr_00000000-0000-4000-8000-000000000000"]);
    // The cached check is answered without another read.
    expect(await call(service, "vrchat.avatarCheck", { blueprintId: blueprint })).toMatchObject({ state: "found" });
    expect(client.calls.filter(call => call === "findAvatar").length).toBe(0);
  });

  it("answers the upload check as signed out while the feature or session is off", async () => {
    const directory = tempDirectory();
    const service = vrchatSession({ directory, version: "1", secrets: fakeSecrets(), client: fakeClient() });
    expect(await call(service, "vrchat.avatarCheck", { blueprintId: "avtr_7ce0e209-6069-40c2-8b23-4e6c2dad389a" }))
      .toMatchObject({ state: "signed_out" });
  });

  it("keeps secrets out of every Gateway answer", async () => {
    const directory = tempDirectory();
    const client = fakeClient({ login: async () => ({ kind: "session", user: USER, cookies: COOKIES }) });
    const service = vrchatSession({ directory, version: "1", secrets: fakeSecrets(), client });
    await call(service, "vrchat.setExperimental", { enabled: true });
    await signIn(service, "pw-123", true);
    for (const method of ["vrchat.status", "vrchat.signOut"] as const) {
      const value = JSON.stringify(await call(service, method));
      expect(value).not.toContain("pw-123");
      expect(value).not.toContain("auth-cookie");
      expect(value).not.toContain("2fa-cookie");
    }
  });

  it("throttles resending the emailed code", async () => {
    const directory = tempDirectory();
    const client = fakeClient({ login: async () => ({ kind: "two_factor", methods: ["emailotp"], auth: "partial" }) });
    const service = vrchatSession({ directory, version: "1", secrets: fakeSecrets(), client });
    await call(service, "vrchat.setExperimental", { enabled: true });
    await signIn(service);
    expect(await call(service, "vrchat.resendEmailCode")).toEqual({ outcome: "sent" });
    expect(await call(service, "vrchat.resendEmailCode")).toEqual({ outcome: "resend_too_soon" });
  });

  it("writes the one-time SDK handoff file and removes it again on cleanup", async () => {
    const project = tempDirectory();
    const file = await writeSdkSessionFile(project, { username: "Aran", auth: "auth-cookie", twoFactorAuth: "2fa-cookie" }, async () => {});
    const written = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(written).toMatchObject({ schemaVersion: "0.1", username: "Aran", auth: "auth-cookie", twoFactorAuth: "2fa-cookie" });
    expect(path.basename(file)).toBe(SDK_SESSION_FILE);
    const directory = tempDirectory();
    const service = vrchatSession({ directory, version: "1", secrets: fakeSecrets(), client: fakeClient() });
    service.noteSdkHandoff(file);
    service.clearSdkHandoffs();
    expect(fs.existsSync(file)).toBe(false);
  });

  it("narrows the handoff file to the current user before the session is written", async () => {
    const project = tempDirectory();
    const sizes: number[] = [];
    await writeSdkSessionFile(project, { username: "Aran", auth: "auth-cookie", twoFactorAuth: null }, async pending => {
      sizes.push(fs.statSync(pending).size);
    });
    expect(sizes).toEqual([0]);
  });

  it("removes a handoff file an earlier launch left behind at the next start", async () => {
    const project = tempDirectory();
    const file = await writeSdkSessionFile(project, { username: "Aran", auth: "auth-cookie", twoFactorAuth: null }, async () => {});
    const directory = tempDirectory();
    vrchatSession({ directory, version: "1", secrets: fakeSecrets(), client: fakeClient() }).noteSdkHandoff(file);
    // That launch ended without its cleanup.
    expect(fs.existsSync(file)).toBe(true);
    vrchatSession({ directory, version: "1", secrets: fakeSecrets(), client: fakeClient() });
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(directory, "vrchat-handoffs.json"))).toBe(false);
  });

  it("never sweeps a recorded path outside a .vua/bridge handoff file", async () => {
    const directory = tempDirectory();
    const other = path.join(tempDirectory(), "notes.json");
    fs.writeFileSync(other, "{}");
    fs.writeFileSync(path.join(directory, "vrchat-handoffs.json"), JSON.stringify([other]));
    vrchatSession({ directory, version: "1", secrets: fakeSecrets(), client: fakeClient() });
    expect(fs.existsSync(other)).toBe(true);
  });
});
