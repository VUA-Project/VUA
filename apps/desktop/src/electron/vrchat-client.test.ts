import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { VrchatRequestError, vrchatClient, type VrchatClientDeps } from "./vrchat-client.js";

/** A scripted VRChat API: each entry consumes one request and answers it. */
class MockVrchat {
  readonly requests: { method: string; url: string; authorization?: string; cookie?: string; userAgent?: string; body?: string }[] = [];
  private server: Server | null = null;
  private queue: ((request: IncomingMessage, response: ServerResponse, record: MockVrchat["requests"][number]) => void)[] = [];

  reply(handler: (request: IncomingMessage, response: ServerResponse, record: MockVrchat["requests"][number]) => void): void {
    this.queue.push(handler);
  }

  async start(): Promise<string> {
    this.server = createServer((request, response) => {
      const record = { method: request.method ?? "", url: request.url ?? "", authorization: request.headers.authorization,
        cookie: request.headers.cookie, userAgent: request.headers["user-agent"] };
      this.requests.push(record);
      const chunks: Buffer[] = [];
      request.on("data", chunk => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        record.body = Buffer.concat(chunks).toString("utf8");
        const next = this.queue.shift();
        if (next === undefined) { response.writeHead(500, { "Content-Type": "application/json" }); response.end("{}"); return; }
        next(request, response, record);
      });
    });
    await new Promise<void>(resolve => this.server!.listen(0, "127.0.0.1", resolve));
    const address = this.server!.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server === null) return;
    server.closeAllConnections?.();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  client(overrides: Partial<VrchatClientDeps> = {}) {
    return vrchatClient({ version: "9.9.9", backoffMs: [1, 1, 1], minIntervalMs: 0, sleep: async () => {}, ...overrides });
  }
}

const USER = { id: "usr_1", username: "Aran", displayName: "Aran", thumbnailUrl: null };
const json = (response: ServerResponse, status: number, body: unknown, cookies: string[] = []): void => {
  response.writeHead(status, { "Content-Type": "application/json", ...(cookies.length > 0 ? { "Set-Cookie": cookies } : {}) });
  response.end(JSON.stringify(body));
};

let mock: MockVrchat | null = null;
afterEach(async () => { await mock?.close(); mock = null; });

describe("VRChat API client", () => {
  it("signs in with URL-encoded Basic credentials and identifies VUA in the User-Agent", async () => {
    mock = new MockVrchat();
    const baseUrl = await mock.start();
    mock.reply((_request, response) => json(response, 200, USER, ["auth=cookie-a; Path=/; HttpOnly"]));
    const client = mock.client({ baseUrl });
    const step = await client.login("aran@example.com", "pä:ss word/+");
    expect(step).toEqual({ kind: "session", user: { ...USER }, cookies: { auth: "cookie-a", twoFactorAuth: null } });
    const record = mock.requests[0];
    expect(record.userAgent).toBe("VUA/9.9.9 (+https://github.com/VUA-Project/VUA)");
    const expected = Buffer.from(`${encodeURIComponent("aran@example.com")}:${encodeURIComponent("pä:ss word/+")}`, "utf8").toString("base64");
    expect(record.authorization).toBe(`Basic ${expected}`);
  });

  it("reports the two-factor step VRChat asks for and keeps the partial cookie", async () => {
    mock = new MockVrchat();
    const baseUrl = await mock.start();
    mock.reply((_request, response) => json(response, 200, { ...USER, requiresTwoFactorAuth: ["emailotp", "totp"] }, ["auth=partial"]));
    const step = await mock.client({ baseUrl }).login("Aran", "pw");
    expect(step).toEqual({ kind: "two_factor", methods: ["emailotp", "totp"], auth: "partial" });
  });

  it("rejects wrong credentials without repeating the password anywhere", async () => {
    mock = new MockVrchat();
    const baseUrl = await mock.start();
    mock.reply((_request, response) => json(response, 401, { error: { message: "Invalid Username/Password Combination" } }));
    const failure = await mock.client({ baseUrl }).login("Aran", "secret-password").catch(error => error);
    expect(failure).toBeInstanceOf(VrchatRequestError);
    expect((failure as VrchatRequestError).code).toBe("invalid_credentials");
    expect((failure as VrchatRequestError).message).not.toContain("secret-password");
    expect(JSON.stringify(failure)).not.toContain("secret-password");
  });

  it("verifies an emailed code and captures the session's second cookie", async () => {
    mock = new MockVrchat();
    const baseUrl = await mock.start();
    mock.reply((_request, response) => json(response, 200, { verified: true, raw: "123456" }, ["twoFactorAuth=cookie-2fa; Path=/"]));
    const verified = await mock.client({ baseUrl }).verifyTwoFactor("emailotp", "123456", "partial");
    expect(verified).toEqual({ verified: true, twoFactorAuth: "cookie-2fa" });
    const record = mock.requests[0];
    expect(record.url).toBe("/api/1/auth/twofactorauth/emailotp/verify");
    expect(record.cookie).toBe("auth=partial");
    expect(JSON.parse(record.body ?? "{}")).toEqual({ code: "123456" });
  });

  it("tells an invalid code from a verified one", async () => {
    mock = new MockVrchat();
    const baseUrl = await mock.start();
    mock.reply((_request, response) => json(response, 400, { error: { message: "invalid code" } }));
    expect(await mock.client({ baseUrl }).verifyTwoFactor("totp", "000000", "partial")).toEqual({ verified: false, twoFactorAuth: null });
  });

  it("resends the emailed code and reads the current user with both cookies", async () => {
    mock = new MockVrchat();
    const baseUrl = await mock.start();
    mock.reply((_request, response) => json(response, 200, {}));
    mock.reply((_request, response) => json(response, 200, USER));
    const client = mock.client({ baseUrl });
    await client.resendEmailCode("partial");
    expect(mock.requests[0].url).toBe("/api/1/auth/twofactorauth/emailotp/resend");
    expect(await client.currentUser({ auth: "a", twoFactorAuth: "b" })).toEqual({ ...USER });
    expect(mock.requests[1].cookie).toBe("auth=a; twoFactorAuth=b");
  });

  it("reports an ended session as null and ends it on logout", async () => {
    mock = new MockVrchat();
    const baseUrl = await mock.start();
    mock.reply((_request, response) => json(response, 401, { error: { message: "Not logged in" } }));
    mock.reply((_request, response) => json(response, 200, { success: {} }));
    const client = mock.client({ baseUrl });
    expect(await client.currentUser({ auth: "stale", twoFactorAuth: null })).toBeNull();
    await client.logout({ auth: "a", twoFactorAuth: "b" });
    expect(mock.requests[1].method).toBe("PUT");
    expect(mock.requests[1].url).toBe("/api/1/logout");
  });

  it("walks the Avatar list page by page until the upload appears", async () => {
    mock = new MockVrchat();
    const baseUrl = await mock.start();
    const avatar = { id: "avtr_7ce0e209-6069-40c2-8b23-4e6c2dad389a", name: "AMF test1", releaseStatus: "private", platforms: ["pc", "ios"], updatedAt: "2026-10-17T15:40:00Z" };
    mock.reply((_request, response) => json(response, 200, { total: 101, results: Array.from({ length: 100 }, (_, index) => ({ ...avatar, id: `avtr_filler_${index}` })) }));
    mock.reply((request, response) => {
      expect(request.url).toContain("offset=100");
      expect(request.url).toContain("n=100");
      expect(request.url).toContain("user=me");
      json(response, 200, { total: 101, results: [avatar] });
    });
    const found = await mock.client({ baseUrl }).findAvatar(avatar.id, { auth: "a", twoFactorAuth: null });
    expect(found).toEqual({ kind: "found", avatar: { id: avatar.id, name: "AMF test1", releaseStatus: "private", platforms: ["pc", "ios"], updatedAt: avatar.updatedAt } });
  });

  it("says missing when the whole list was read, and expired when the session ended", async () => {
    mock = new MockVrchat();
    const baseUrl = await mock.start();
    mock.reply((_request, response) => json(response, 200, { total: 1, results: [{ id: "avtr_other", name: "Other" }] }));
    expect(await mock.client({ baseUrl }).findAvatar("avtr_7ce0e209-6069-40c2-8b23-4e6c2dad389a", { auth: "a", twoFactorAuth: null }))
      .toEqual({ kind: "missing", pages: 1 });
    mock.reply((_request, response) => json(response, 401, {}));
    expect(await mock.client({ baseUrl }).findAvatar("avtr_7ce0e209-6069-40c2-8b23-4e6c2dad389a", { auth: "stale", twoFactorAuth: null }))
      .toEqual({ kind: "expired" });
  });

  it("backs off on 429 and 5xx answers and retries", async () => {
    mock = new MockVrchat();
    const baseUrl = await mock.start();
    mock.reply((_request, response) => { response.writeHead(429, { "Retry-After": "0" }); response.end("{}"); });
    mock.reply((_request, response) => { response.writeHead(503, {}); response.end("down"); });
    mock.reply((_request, response) => json(response, 200, USER, ["auth=late"]));
    const step = await mock.client({ baseUrl }).login("Aran", "pw");
    expect(step.kind).toBe("session");
    expect(mock.requests).toHaveLength(3);
  });

  it("gives up after the configured backoff attempts", async () => {
    mock = new MockVrchat();
    const baseUrl = await mock.start();
    for (let index = 0; index < 4; index++) mock.reply((_request, response) => { response.writeHead(500, {}); response.end("{}"); });
    const failure = await mock.client({ baseUrl }).login("Aran", "pw").catch(error => error);
    expect(failure).toBeInstanceOf(VrchatRequestError);
    expect((failure as VrchatRequestError).code).toBe("server");
    expect(mock.requests).toHaveLength(4);
  });
});
