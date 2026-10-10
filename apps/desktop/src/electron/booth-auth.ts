import { CATALOG_SYNC_DEFAULT_START_URL, isSignInPage } from "./catalog-sync.js";

interface BoothSessionProbe {
  signInHint(): Promise<"stored" | "none" | "unknown">;
  fetchWithSession(url: string, signal?: AbortSignal): Promise<{ status: number; body: string; finalUrl: string }>;
}

/** This private Main-side read retains the existing auth-probe result shape.
 * Cookie absence avoids an anonymous request; presence still needs site evidence.
 * No session bytes or page contents cross the IPC boundary. */
export async function probeBoothAuthentication(session: BoothSessionProbe): Promise<{ authOk: boolean; accountName: string | null }> {
  const unavailable = { authOk: false, accountName: null };
  try {
    if (await session.signInHint() === "none") return unavailable;
    const probe = await session.fetchWithSession(CATALOG_SYNC_DEFAULT_START_URL, AbortSignal.timeout(8_000));
    const location = new URL(probe.finalUrl);
    const authOk = probe.status === 200 && location.origin === "https://accounts.booth.pm"
      && location.pathname === "/library" && !isSignInPage(probe.body);
    return { authOk, accountName: authOk ? /data-user-name="([^"]{1,64})"/.exec(probe.body)?.[1] ?? null : null };
  } catch { return unavailable; }
}
