/** VRChat API client for the experimental sign-in (author ruling 2026-10-18).
 * Requests identify VUA in their User-Agent, stay few and back off on 429/5xx.
 * Endpoints follow the community documentation (https://vrchatapi.github.io).
 * Credentials never appear in errors, logs or returned records. */

export type VrchatErrorCode = "network" | "rate_limited" | "server" | "invalid_credentials" | "invalid_response";

/** A typed failure whose message never repeats a password or cookie value. */
export class VrchatRequestError extends Error {
  constructor(readonly code: VrchatErrorCode, message: string) {
    super(message);
    this.name = "VrchatRequestError";
  }
}

export interface VrchatCookies {
  readonly auth: string;
  readonly twoFactorAuth: string | null;
}

export interface VrchatUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly thumbnailUrl: string | null;
}

/** One password attempt: a finished session, or the two-factor step VRChat asked for. */
export type VrchatLoginStep =
  | { readonly kind: "session"; readonly user: VrchatUser; readonly cookies: VrchatCookies }
  | { readonly kind: "two_factor"; readonly methods: readonly string[]; readonly auth: string };

export interface VrchatAvatarSummary {
  readonly id: string;
  readonly name: string;
  readonly releaseStatus: string;
  readonly platforms: readonly string[];
  readonly updatedAt: string;
}

/** One page-walk over the account's own Avatars. */
export type VrchatAvatarLookup =
  | { readonly kind: "found"; readonly avatar: VrchatAvatarSummary }
  | { readonly kind: "missing"; readonly pages: number }
  | { readonly kind: "expired" };

export interface VrchatClientDeps {
  readonly version: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  /** Backoff waits in milliseconds; tests shrink them. */
  readonly backoffMs?: readonly number[];
  /** Smallest gap between two requests; tests set it to 0. */
  readonly minIntervalMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const MAX_BODY_CHARS = 1024 * 1024;
const AVATARS_PER_PAGE = 100;
/** Ten pages cover a thousand Avatars; the check stays a bounded read. */
const MAX_AVATAR_PAGES = 10;
const MAX_THUMBNAIL_BYTES = 128 * 1024;

function pickSetCookie(headers: Headers, name: string): string | null {
  const all = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  for (const cookie of all) {
    const separator = cookie.indexOf("=");
    if (separator > 0 && cookie.slice(0, separator) === name) {
      return cookie.slice(separator + 1).split(";")[0] ?? null;
    }
  }
  return null;
}

function text(value: unknown, limit: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= limit ? value : null;
}

function parseUser(body: unknown): VrchatUser {
  if (typeof body !== "object" || body === null) throw new VrchatRequestError("invalid_response", "VRChat returned no user record.");
  const record = body as Record<string, unknown>;
  const id = text(record.id, 64), username = text(record.username, 64), displayName = text(record.displayName, 64);
  if (id === null || username === null || displayName === null) {
    throw new VrchatRequestError("invalid_response", "VRChat returned an incomplete user record.");
  }
  return { id, username, displayName, thumbnailUrl: text(record.thumbnailUrl, 2048) };
}

export interface VrchatClient {
  login(username: string, password: string): Promise<VrchatLoginStep>;
  /** The verified answer carries the `twoFactorAuth` cookie back with it. */
  verifyTwoFactor(method: "emailotp" | "totp" | "otp", code: string, auth: string): Promise<{ verified: boolean; twoFactorAuth: string | null }>;
  resendEmailCode(auth: string): Promise<void>;
  currentUser(cookies: VrchatCookies): Promise<VrchatUser | null>;
  logout(cookies: VrchatCookies): Promise<void>;
  findAvatar(blueprintId: string, cookies: VrchatCookies): Promise<VrchatAvatarLookup>;
  fetchThumbnail(url: string): Promise<string | null>;
}

/** One client per VUA launch; the pacing state lives for its whole life. */
export function vrchatClient(deps: VrchatClientDeps): VrchatClient {
  const baseUrl = (deps.baseUrl ?? "https://api.vrchat.com").replace(/\/+$/u, "");
  const userAgent = `VUA/${deps.version} (+https://github.com/VUA-Project/VUA)`;
  const backoff = deps.backoffMs ?? [1000, 2000, 4000];
  const minInterval = deps.minIntervalMs ?? 1000;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const doFetch = deps.fetch ?? fetch;
  let lastRequestAt = 0;

  interface Answer {
    readonly status: number;
    readonly body: unknown;
    readonly headers: Headers;
    readonly retryAfterMs: number | null;
  }

  async function request(method: "GET" | "POST" | "PUT", path: string, init: {
    auth?: { readonly username: string; readonly password: string };
    cookies?: VrchatCookies | { readonly auth: string };
    json?: unknown;
  }): Promise<Answer> {
    let attempt = 0;
    for (;;) {
      const gap = lastRequestAt + minInterval - now();
      if (gap > 0) await sleep(gap);
      lastRequestAt = now();
      const backoffWait = backoff[attempt];
      let response: Response;
      const headers: Record<string, string> = { "User-Agent": userAgent, Accept: "application/json" };
      if (init.auth) {
        const key = `${encodeURIComponent(init.auth.username)}:${encodeURIComponent(init.auth.password)}`;
        headers.Authorization = `Basic ${Buffer.from(key, "utf8").toString("base64")}`;
      }
      const cookies = init.cookies as { auth: string; twoFactorAuth?: string | null } | undefined;
      if (cookies) headers.Cookie = `auth=${cookies.auth}${cookies.twoFactorAuth ? `; twoFactorAuth=${cookies.twoFactorAuth}` : ""}`;
      let body: string | undefined;
      if (init.json !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(init.json);
      }
      try {
        response = await doFetch(`${baseUrl}${path}`, { method, headers, ...(body !== undefined ? { body } : {}) });
      } catch {
        if (backoffWait !== undefined) { await sleep(backoffWait); attempt++; continue; }
        throw new VrchatRequestError("network", "VRChat could not be reached.");
      }
      const retryAfter = Number.parseFloat(response.headers.get("retry-after") ?? "");
      const retryAfterMs = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : null;
      if ((response.status === 429 || response.status >= 500) && backoffWait !== undefined) {
        await sleep(retryAfterMs ?? backoffWait);
        attempt++;
        continue;
      }
      const raw = await response.text();
      if (raw.length > MAX_BODY_CHARS) throw new VrchatRequestError("server", "VRChat sent an unexpectedly large response.");
      let parsed: unknown = null;
      if (raw.length > 0) {
        try { parsed = JSON.parse(raw); } catch { parsed = null; }
      }
      return { status: response.status, body: parsed, headers: response.headers, retryAfterMs };
    }
  }

  return {
    async login(username, password) {
      const answer = await request("GET", "/api/1/auth/user", { auth: { username, password } });
      if (answer.status === 401) throw new VrchatRequestError("invalid_credentials", "VRChat rejected this username or password.");
      if (answer.status === 429) throw new VrchatRequestError("rate_limited", "VRChat asked VUA to slow down; try again in a moment.");
      if (answer.status >= 400) throw new VrchatRequestError("server", "VRChat answered with an error.");
      const auth = pickSetCookie(answer.headers, "auth");
      if (auth === null) throw new VrchatRequestError("invalid_response", "VRChat sent no session cookie.");
      const requires = (answer.body as Record<string, unknown> | null)?.requiresTwoFactorAuth;
      const methods = Array.isArray(requires) ? requires.filter((value): value is string => typeof value === "string") : [];
      if (methods.length > 0) return { kind: "two_factor", methods, auth };
      const user = parseUser(answer.body);
      return { kind: "session", user, cookies: { auth, twoFactorAuth: pickSetCookie(answer.headers, "twoFactorAuth") } };
    },

    async verifyTwoFactor(method, code, auth) {
      const answer = await request("POST", `/api/1/auth/twofactorauth/${method}/verify`, { cookies: { auth }, json: { code } });
      if (answer.status === 429) throw new VrchatRequestError("rate_limited", "VRChat asked VUA to slow down; try again in a moment.");
      return {
        verified: answer.status === 200 && (answer.body as Record<string, unknown> | null)?.verified === true,
        twoFactorAuth: pickSetCookie(answer.headers, "twoFactorAuth"),
      };
    },

    async resendEmailCode(auth) {
      const answer = await request("POST", "/api/1/auth/twofactorauth/emailotp/resend", { cookies: { auth } });
      if (answer.status === 429) throw new VrchatRequestError("rate_limited", "VRChat asked VUA to slow down; try again in a moment.");
      if (answer.status >= 400) throw new VrchatRequestError("server", "VRChat could not resend the email code.");
    },

    async currentUser(cookies) {
      const answer = await request("GET", "/api/1/auth/user", { cookies });
      if (answer.status === 401) return null;
      if (answer.status === 429) throw new VrchatRequestError("rate_limited", "VRChat asked VUA to slow down; try again in a moment.");
      if (answer.status >= 400) throw new VrchatRequestError("server", "VRChat answered with an error.");
      return parseUser(answer.body);
    },

    async logout(cookies) {
      // VRChat ends the session when it receives this; VUA clears its own state either way.
      await request("PUT", "/api/1/logout", { cookies });
    },

    async findAvatar(blueprintId, cookies) {
      for (let page = 0; page < MAX_AVATAR_PAGES; page++) {
        const answer = await request("GET",
          `/api/1/avatars?user=me&releaseStatus=all&n=${AVATARS_PER_PAGE}&offset=${page * AVATARS_PER_PAGE}`, { cookies });
        if (answer.status === 401) return { kind: "expired" } as const;
        if (answer.status === 429) throw new VrchatRequestError("rate_limited", "VRChat asked VUA to slow down; try again in a moment.");
        if (answer.status >= 400) throw new VrchatRequestError("server", "VRChat answered with an error.");
        const results = (answer.body as Record<string, unknown> | null)?.results;
        if (!Array.isArray(results)) throw new VrchatRequestError("invalid_response", "VRChat returned no Avatar list.");
        for (const entry of results) {
          if (typeof entry !== "object" || entry === null) continue;
          const avatar = entry as Record<string, unknown>;
          if (avatar.id !== blueprintId) continue;
          const name = text(avatar.name, 128), updatedAt = text(avatar.updatedAt, 64);
          if (name === null || updatedAt === null) throw new VrchatRequestError("invalid_response", "VRChat returned an incomplete Avatar record.");
          const platforms = Array.isArray(avatar.platforms)
            ? avatar.platforms.filter((value): value is string => typeof value === "string").slice(0, 8)
            : [];
          return { kind: "found", avatar: { id: blueprintId, name, releaseStatus: text(avatar.releaseStatus, 32) ?? "unknown", platforms, updatedAt } };
        }
        if (results.length < AVATARS_PER_PAGE) return { kind: "missing", pages: page + 1 } as const;
      }
      return { kind: "missing", pages: MAX_AVATAR_PAGES } as const;
    },

    async fetchThumbnail(url) {
      if (!/^https:\/\//u.test(url)) return null;
      try {
        const gap = lastRequestAt + minInterval - now();
        if (gap > 0) await sleep(gap);
        lastRequestAt = now();
        const response = await doFetch(url, { method: "GET", headers: { "User-Agent": userAgent } });
        if (!response.ok) return null;
        const type = response.headers.get("content-type") ?? "";
        if (!type.startsWith("image/")) return null;
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength === 0 || buffer.byteLength > MAX_THUMBNAIL_BYTES) return null;
        return `data:${type.split(";")[0]};base64,${buffer.toString("base64")}`;
      } catch {
        return null;
      }
    },
  };
}
