/** Experimental VRChat sign-in held by Electron Main (author ruling 2026-10-18).
 * Session cookies and, with the player's separate choice, the password are sealed
 * with the OS per-user encryption (Electron safeStorage) in their own file; nothing
 * secret ever reaches Gateway values, task records, logs, diagnostics or the MCP
 * adapter. The renderer only reads sign-in state and profile facts. */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type {
  VrchatAvatarCheckValueV1, VrchatGatewayRequestV1, VrchatGatewayValueV1, VrchatSignInValueV1,
  VrchatStatusValueV1, VrchatTwoFactorMethodV1,
} from "@vua/contracts";
import { VrchatRequestError, vrchatClient, type VrchatClient, type VrchatCookies, type VrchatUser } from "./vrchat-client.js";

interface SecretStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

/** What the open Unity Editor receives once, through a file it deletes on read. */
export interface VrchatSdkSession {
  readonly username: string;
  readonly auth: string;
  readonly twoFactorAuth: string | null;
}

interface SecretsPayload {
  readonly username: string;
  readonly auth: string;
  readonly twoFactorAuth: string | null;
  readonly loginName: string | null;
  readonly password: string | null;
}

interface AccountFile {
  readonly version: "0.1";
  readonly enabled: boolean;
  readonly rememberPassword: boolean;
  readonly displayName: string | null;
  readonly checkedAt: string | null;
}

interface StoredCheck {
  readonly state: "found" | "not_found";
  readonly checkedAt: string;
  readonly name: string;
  readonly releaseStatus: string;
  readonly platforms: readonly string[];
  readonly updatedAt: string;
}

interface CheckFile {
  readonly version: "0.1";
  readonly checks: Readonly<Record<string, StoredCheck>>;
}

interface SessionState {
  readonly user: VrchatUser;
  readonly cookies: VrchatCookies;
  readonly thumbnail: string | null;
}

interface PendingTwoFactor {
  readonly methods: readonly VrchatTwoFactorMethodV1[];
  readonly auth: string;
  readonly loginName: string;
  readonly password: string | null;
}

export interface VrchatSessionDeps {
  readonly directory: string;
  readonly version: string;
  readonly secrets: SecretStorage;
  readonly client?: VrchatClient;
  readonly now?: () => number;
}

const ACCOUNT_FILE = "vrchat-account.json";
const SECRETS_FILE = "vrchat-secrets.json";
const CHECKS_FILE = "vrchat-avatar-checks.json";
/** Paths of handoff files written and not yet confirmed gone, swept at the next start. */
const HANDOFFS_FILE = "vrchat-handoffs.json";
/** `.vua/bridge` file the Editor consumes once during an upload. */
export const SDK_SESSION_FILE = "vrchat-session.json";
const RESEND_INTERVAL_MS = 30_000;
const KEPT_CHECKS = 50;

const EMPTY_ACCOUNT: AccountFile = { version: "0.1", enabled: false, rememberPassword: false, displayName: null, checkedAt: null };

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function readJson(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function writeJson(file: string, value: unknown): void {
  const pending = `${file}.pending`;
  fs.writeFileSync(pending, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(pending, file);
}

async function restrictToOwner(file: string): Promise<void> {
  const user = process.env.USERNAME;
  if (process.platform !== "win32" || !user) return;
  const account = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${user}` : user;
  try {
    await promisify(execFile)("icacls", [file, "/inheritance:r", "/grant:r", `${account}:F`], { windowsHide: true });
  } catch { /* The file still sits inside the player's own profile folder. */ }
}

/** Only the handoff file name inside a `.vua/bridge` folder is ever swept. */
function isHandoffPath(file: unknown): file is string {
  return typeof file === "string" && path.isAbsolute(file) && path.basename(file) === SDK_SESSION_FILE
    && path.basename(path.dirname(file)) === "bridge" && path.basename(path.dirname(path.dirname(file))) === ".vua";
}

/** vrchat-session v0.1 Gateway surface, served by Electron Main only. */
export interface VrchatSessionService {
  handle(request: VrchatGatewayRequestV1): Promise<VrchatGatewayValueV1>;
  snapshot(): { experimentalEnabled: boolean; signedIn: boolean };
  /** Rechecks the kept session at startup or on demand; a remembered password renews it. */
  refresh(): Promise<VrchatStatusValueV1>;
  /** The session for the SDK handoff, when one is currently usable. */
  sdkSession(): VrchatSdkSession | null;
  /** Registers a handoff file for later cleanup, including after an unexpected exit. */
  noteSdkHandoff(file: string): void;
  /** Deletes every SDK handoff file still on record (rejected upload, sign-out, forget, quit). */
  clearSdkHandoffs(): void;
}

export function vrchatSession(deps: VrchatSessionDeps): VrchatSessionService {
  const accountFile = path.join(deps.directory, ACCOUNT_FILE);
  const secretsFile = path.join(deps.directory, SECRETS_FILE);
  const checksFile = path.join(deps.directory, CHECKS_FILE);
  const client = deps.client ?? vrchatClient({ version: deps.version });
  const now = deps.now ?? Date.now;
  const handoffsFile = path.join(deps.directory, HANDOFFS_FILE);

  let account: AccountFile = loadAccount();
  let secrets: SecretsPayload | null = loadSecrets();
  let checks: Record<string, StoredCheck> = loadChecks();
  let session: SessionState | null = null;
  let pending: PendingTwoFactor | null = null;
  let lastResendAt = 0;
  const handoffFiles = new Set<string>();
  let lifecycle: Promise<unknown> = Promise.resolve();
  // A launch that ended without its cleanup left its handoff files on record.
  const leftover = readJson(handoffsFile);
  if (Array.isArray(leftover)) for (const file of leftover.filter(isHandoffPath)) handoffFiles.add(file);
  clearSdkHandoffs();

  function loadAccount(): AccountFile {
    const value = readJson(accountFile);
    if (!record(value) || value.version !== "0.1") return { ...EMPTY_ACCOUNT };
    return {
      version: "0.1",
      enabled: value.enabled === true,
      rememberPassword: value.rememberPassword === true,
      displayName: typeof value.displayName === "string" && value.displayName.length > 0 && value.displayName.length <= 64 ? value.displayName : null,
      checkedAt: typeof value.checkedAt === "string" ? value.checkedAt : null,
    };
  }

  /** Only sealed values live on disk; without OS encryption the session stays in memory. */
  function loadSecrets(): SecretsPayload | null {
    try {
      if (!deps.secrets.isEncryptionAvailable()) return null;
      const value = readJson(secretsFile);
      if (!record(value) || value.version !== "0.1" || typeof value.encrypted !== "string" || value.encrypted.length > 16_384) return null;
      const payload: unknown = JSON.parse(deps.secrets.decryptString(Buffer.from(value.encrypted, "base64")));
      if (!record(payload) || typeof payload.username !== "string" || typeof payload.auth !== "string" || payload.auth.length === 0) return null;
      return {
        username: payload.username,
        auth: payload.auth,
        twoFactorAuth: typeof payload.twoFactorAuth === "string" ? payload.twoFactorAuth : null,
        loginName: typeof payload.loginName === "string" ? payload.loginName : null,
        password: typeof payload.password === "string" ? payload.password : null,
      };
    } catch { return null; }
  }

  function loadChecks(): Record<string, StoredCheck> {
    const value = readJson(checksFile);
    if (!record(value) || value.version !== "0.1" || !record(value.checks)) return {};
    const loaded: Record<string, StoredCheck> = {};
    for (const [id, entry] of Object.entries(value.checks).slice(-KEPT_CHECKS)) {
      if (!/^avtr_[0-9a-fA-F-]{36}$/u.test(id) || !record(entry)) continue;
      const name = typeof entry.name === "string" ? entry.name : "";
      const checkedAt = typeof entry.checkedAt === "string" ? entry.checkedAt : "";
      const updatedAt = typeof entry.updatedAt === "string" ? entry.updatedAt : "";
      const releaseStatus = typeof entry.releaseStatus === "string" ? entry.releaseStatus : "";
      const platforms = Array.isArray(entry.platforms) ? entry.platforms.filter((item): item is string => typeof item === "string").slice(0, 8) : [];
      if ((entry.state === "found" || entry.state === "not_found") && name && checkedAt && updatedAt) {
        loaded[id] = { state: entry.state, checkedAt, name, releaseStatus, platforms, updatedAt };
      }
    }
    return loaded;
  }

  function saveAccount(): void {
    try { writeJson(accountFile, account); } catch { /* The in-memory state stays current. */ }
  }

  function saveSecrets(): void {
    try {
      if (secrets === null || !deps.secrets.isEncryptionAvailable()) {
        if (secrets === null) fs.rmSync(secretsFile, { force: true });
        return;
      }
      const sealed = deps.secrets.encryptString(JSON.stringify(secrets));
      writeJson(secretsFile, { version: "0.1", encrypted: sealed.toString("base64") });
    } catch { /* Without a sealed copy the session simply lasts only for this launch. */ }
  }

  function saveChecks(): void {
    try { writeJson(checksFile, { version: "0.1", checks } satisfies CheckFile); } catch { /* Checks are a cache; a lost file re-reads later. */ }
  }

  function status(): VrchatStatusValueV1 {
    return {
      schemaVersion: "0.1",
      enabled: account.enabled,
      state: session !== null ? "signed_in" : pending !== null ? "needs_code" : "signed_out",
      account: session !== null ? { displayName: session.user.displayName, thumbnail: session.thumbnail } : null,
      rememberPassword: account.rememberPassword,
      pendingMethods: pending !== null ? [...pending.methods] : [],
      canCheckUploads: session !== null,
    };
  }

  /** Drops the session; a remembered password survives until "Forget this account". */
  function dropSession(keepPassword: boolean): void {
    session = null;
    pending = null;
    if (secrets === null) return;
    secrets = keepPassword && secrets.password !== null && secrets.loginName !== null
      ? { username: "", auth: "", twoFactorAuth: null, loginName: secrets.loginName, password: secrets.password }
      : null;
    saveSecrets();
  }

  async function establishSession(user: VrchatUser, cookies: VrchatCookies, loginName: string | null, password: string | null): Promise<void> {
    session = { user, cookies, thumbnail: null };
    account = { ...account, rememberPassword: password !== null, displayName: user.displayName, checkedAt: new Date(now()).toISOString() };
    secrets = { username: user.username, auth: cookies.auth, twoFactorAuth: cookies.twoFactorAuth, loginName, password };
    saveAccount();
    saveSecrets();
    session = { ...session, thumbnail: user.thumbnailUrl !== null ? await client.fetchThumbnail(user.thumbnailUrl) : null };
  }

  /** One password attempt, shared by sign-in and automatic re-login. */
  async function attemptLogin(loginName: string, password: string, rememberPassword: boolean): Promise<VrchatSignInValueV1> {
    const step = await client.login(loginName, password);
    if (step.kind === "two_factor") {
      pending = {
        methods: step.methods.filter((method): method is VrchatTwoFactorMethodV1 => method === "emailotp" || method === "totp" || method === "otp"),
        auth: step.auth,
        loginName,
        password: rememberPassword ? password : null,
      };
      return { outcome: "two_factor_required", methods: [...pending.methods] };
    }
    await establishSession(step.user, step.cookies, rememberPassword ? loginName : null, rememberPassword ? password : null);
    return { outcome: "signed_in" };
  }

  function outcomeOf(error: unknown): VrchatSignInValueV1["outcome"] {
    if (error instanceof VrchatRequestError) {
      if (error.code === "rate_limited") return "rate_limited";
      if (error.code === "network") return "network";
      if (error.code === "invalid_credentials") return "invalid_credentials";
      return "server";
    }
    return "network";
  }

  /** Offline at startup: keep the stored session as the working state; VRChat itself
   * confirms or ends it on the next real request. */
  function adoptKeptSession(): void {
    if (secrets === null || secrets.auth.length === 0 || account.displayName === null) return;
    session = {
      user: { id: "", username: secrets.username, displayName: account.displayName, thumbnailUrl: null },
      cookies: { auth: secrets.auth, twoFactorAuth: secrets.twoFactorAuth },
      thumbnail: null,
    };
  }

  /** Startup or on-demand recheck: reuse the kept cookies, renew with a remembered
   * password when VRChat ended the session (a code may still be needed). */
  async function refreshSession(): Promise<VrchatStatusValueV1> {
    if (!account.enabled || session !== null || secrets === null || secrets.auth.length === 0) return status();
    let user: VrchatUser | null;
    try {
      user = await client.currentUser({ auth: secrets.auth, twoFactorAuth: secrets.twoFactorAuth });
    } catch {
      adoptKeptSession();
      return status();
    }
    if (user !== null) {
      await establishSession(user, { auth: secrets.auth, twoFactorAuth: secrets.twoFactorAuth }, secrets.loginName, secrets.password);
      return status();
    }
    // VRChat ended the session.
    if (secrets.loginName !== null && secrets.password !== null) {
      try {
        await attemptLogin(secrets.loginName, secrets.password, true);
      } catch { dropSession(true); }
    } else {
      dropSession(false);
      account = { ...account, displayName: null };
      saveAccount();
    }
    return status();
  }

  function describe(entry: StoredCheck): VrchatAvatarCheckValueV1["avatar"] {
    return entry.state === "found"
      ? { name: entry.name, releaseStatus: entry.releaseStatus, platforms: [...entry.platforms], updatedAt: entry.updatedAt }
      : null;
  }

  function rememberCheck(blueprintId: string, entry: StoredCheck): VrchatAvatarCheckValueV1 {
    checks = Object.fromEntries(Object.entries({ ...checks, [blueprintId]: entry }).slice(-KEPT_CHECKS));
    saveChecks();
    return { schemaVersion: "0.1", blueprintId, state: entry.state, checkedAt: entry.checkedAt, avatar: describe(entry) };
  }

  async function lookupAvatar(blueprintId: string): Promise<VrchatAvatarCheckValueV1> {
    const current = session;
    if (current === null) return { schemaVersion: "0.1", blueprintId, state: "signed_out", checkedAt: null, avatar: null };
    const lookup = await client.findAvatar(blueprintId, current.cookies);
    if (lookup.kind === "expired") {
      // VRChat ended the session mid-read; a remembered password may renew it once.
      dropSession(true);
      account = { ...account, displayName: null };
      saveAccount();
      await refreshSession();
      const renewed = session;
      if (renewed === null) return { schemaVersion: "0.1", blueprintId, state: "signed_out", checkedAt: null, avatar: null };
      const retry = await client.findAvatar(blueprintId, renewed.cookies);
      if (retry.kind === "expired") return { schemaVersion: "0.1", blueprintId, state: "signed_out", checkedAt: null, avatar: null };
      if (retry.kind === "found") return rememberCheck(blueprintId, {
        state: "found", checkedAt: new Date(now()).toISOString(), name: retry.avatar.name,
        releaseStatus: retry.avatar.releaseStatus, platforms: retry.avatar.platforms, updatedAt: retry.avatar.updatedAt,
      });
      return rememberCheck(blueprintId, { state: "not_found", checkedAt: new Date(now()).toISOString(), name: "", releaseStatus: "", platforms: [], updatedAt: "" });
    }
    if (lookup.kind === "found") {
      return rememberCheck(blueprintId, {
        state: "found", checkedAt: new Date(now()).toISOString(), name: lookup.avatar.name,
        releaseStatus: lookup.avatar.releaseStatus, platforms: lookup.avatar.platforms, updatedAt: lookup.avatar.updatedAt,
      });
    }
    return rememberCheck(blueprintId, { state: "not_found", checkedAt: new Date(now()).toISOString(), name: "", releaseStatus: "", platforms: [], updatedAt: "" });
  }

  async function avatarCheck(blueprintId: string, refresh: boolean): Promise<VrchatAvatarCheckValueV1> {
    const cached = checks[blueprintId];
    if (!refresh && cached !== undefined) {
      return { schemaVersion: "0.1", blueprintId, state: cached.state, checkedAt: cached.checkedAt, avatar: describe(cached) };
    }
    if (!account.enabled) return { schemaVersion: "0.1", blueprintId, state: "signed_out", checkedAt: null, avatar: null };
    if (session === null) await refreshSession();
    try {
      return await lookupAvatar(blueprintId);
    } catch {
      return { schemaVersion: "0.1", blueprintId, state: "error", checkedAt: cached?.checkedAt ?? null, avatar: cached ? describe(cached) : null };
    }
  }

  /** Commands run one at a time so a second click cannot race the first. */
  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = lifecycle.then(work, work);
    lifecycle = run.catch(() => {});
    return run;
  }

  async function endSession(forget: boolean): Promise<VrchatStatusValueV1> {
    try { if (session !== null) await client.logout(session.cookies); } catch { /* VRChat ends its side when it can. */ }
    clearSdkHandoffs();
    if (forget) {
      session = null; pending = null;
      secrets = null;
      account = { ...account, rememberPassword: false, displayName: null, checkedAt: null };
      checks = {};
      saveAccount(); saveSecrets();
      try { fs.rmSync(checksFile, { force: true }); } catch { /* already gone */ }
    } else {
      dropSession(true);
      account = { ...account, displayName: null };
      saveAccount();
    }
    return status();
  }

  async function handle(request: VrchatGatewayRequestV1): Promise<VrchatGatewayValueV1> {
    switch (request.method) {
      case "vrchat.status":
        return status();
      case "vrchat.setExperimental":
        return serialize(async () => {
          if (request.params.enabled === account.enabled) return status();
          if (request.params.enabled) {
            account = { ...account, enabled: true };
            saveAccount();
            return status();
          }
          // Turning the feature off signs the player out and removes every stored value.
          await endSession(true);
          account = { ...EMPTY_ACCOUNT };
          saveAccount();
          return status();
        });
      case "vrchat.signIn":
        return serialize(async () => {
          if (!account.enabled) return { outcome: "not_enabled" } as VrchatSignInValueV1;
          pending = null;
          try {
            return await attemptLogin(request.params.username, request.params.password, request.params.rememberPassword);
          } catch (error) {
            return { outcome: outcomeOf(error) } as VrchatSignInValueV1;
          }
        });
      case "vrchat.relogin":
        return serialize(async () => {
          if (!account.enabled) return { outcome: "not_enabled" } as VrchatSignInValueV1;
          const kept = secrets;
          if (kept === null || kept.loginName === null || kept.password === null) return { outcome: "no_sign_in_in_progress" } as VrchatSignInValueV1;
          pending = null;
          try {
            return await attemptLogin(kept.loginName, kept.password, true);
          } catch (error) {
            return { outcome: outcomeOf(error) } as VrchatSignInValueV1;
          }
        });
      case "vrchat.verifyCode":
        return serialize(async () => {
          const waiting = pending;
          if (waiting === null) return { outcome: "no_sign_in_in_progress" } as VrchatSignInValueV1;
          try {
            const verified = await client.verifyTwoFactor(request.params.method, request.params.code, waiting.auth);
            if (!verified.verified) return { outcome: "invalid_code" } as VrchatSignInValueV1;
            const cookies = { auth: waiting.auth, twoFactorAuth: verified.twoFactorAuth };
            const user = await client.currentUser(cookies);
            if (user === null) return { outcome: "invalid_code" } as VrchatSignInValueV1;
            pending = null;
            await establishSession(user, cookies, waiting.password !== null ? waiting.loginName : null, waiting.password);
            return { outcome: "signed_in" } as VrchatSignInValueV1;
          } catch (error) {
            return { outcome: outcomeOf(error) } as VrchatSignInValueV1;
          }
        });
      case "vrchat.resendEmailCode":
        return serialize(async () => {
          const waiting = pending;
          if (waiting === null || !waiting.methods.includes("emailotp")) return { outcome: "no_sign_in_in_progress" } as VrchatSignInValueV1;
          if (now() - lastResendAt < RESEND_INTERVAL_MS) return { outcome: "resend_too_soon" } as VrchatSignInValueV1;
          try {
            await client.resendEmailCode(waiting.auth);
            lastResendAt = now();
            return { outcome: "sent" } as VrchatSignInValueV1;
          } catch (error) {
            return { outcome: outcomeOf(error) } as VrchatSignInValueV1;
          }
        });
      case "vrchat.signOut":
        return serialize(() => endSession(false));
      case "vrchat.forget":
        return serialize(() => endSession(true));
      case "vrchat.avatarCheck":
        return serialize(() => avatarCheck(request.params.blueprintId, request.params.refresh === true));
    }
  }

  function saveHandoffs(): void {
    try {
      if (handoffFiles.size === 0) fs.rmSync(handoffsFile, { force: true });
      else writeJson(handoffsFile, [...handoffFiles]);
    } catch { /* The files are still deleted on sign-out, forgetting and quit. */ }
  }

  function clearSdkHandoffs(): void {
    for (const file of handoffFiles) {
      if (!isHandoffPath(file)) continue;
      try { fs.rmSync(file, { force: true }); } catch { /* the Editor already deleted it */ }
    }
    handoffFiles.clear();
    saveHandoffs();
  }

  return {
    handle,
    snapshot: () => ({ experimentalEnabled: account.enabled, signedIn: session !== null }),
    refresh: () => serialize(refreshSession),
    sdkSession: () => (session !== null ? { username: session.user.username, auth: session.cookies.auth, twoFactorAuth: session.cookies.twoFactorAuth } : null),
    noteSdkHandoff: file => { if (isHandoffPath(file)) { handoffFiles.add(file); saveHandoffs(); } },
    clearSdkHandoffs,
  };
}

/** Writes `.vua/bridge/vrchat-session.json`; the Editor deletes it right after reading. */
export async function writeSdkSessionFile(
  projectRoot: string,
  session: VrchatSdkSession,
  restrict: (file: string) => Promise<void> = restrictToOwner,
): Promise<string> {
  const folder = path.join(projectRoot, ".vua", "bridge");
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, SDK_SESSION_FILE);
  const pending = `${file}.pending`;
  // The empty file is narrowed to the current user before the session is written into it.
  fs.rmSync(pending, { force: true });
  fs.closeSync(fs.openSync(pending, "wx", 0o600));
  await restrict(pending).catch(() => {});
  fs.writeFileSync(pending, JSON.stringify({
    schemaVersion: "0.1",
    createdAt: new Date().toISOString(),
    username: session.username,
    auth: session.auth,
    ...(session.twoFactorAuth !== null ? { twoFactorAuth: session.twoFactorAuth } : {}),
  }));
  fs.renameSync(pending, file);
  return file;
}
