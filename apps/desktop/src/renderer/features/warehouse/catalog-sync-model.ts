import type { CatalogSyncApiV1, CatalogSyncSnapshotV03, CatalogSyncStartOutcomeV1, RemoteContentApiV1 } from "@vua/contracts";

export type CatalogAccountState = "checking" | "signed-in" | "sign-in" | "unknown";

/** Recheck the actual account library on an explicit sync request. Stored cookies
 * alone do not establish authentication; an expired session opens the login flow. */
export async function startSignedInCatalogSync(
  remote: Pick<RemoteContentApiV1, "authProbe">,
  sync: Pick<CatalogSyncApiV1, "start">,
  request: Parameters<CatalogSyncApiV1["start"]>[0],
  openSignIn: () => void,
): Promise<CatalogSyncStartOutcomeV1> {
  if (!(await remote.authProbe()).authOk) {
    openSignIn();
    return { status: "blocked", reason: "sign-in-required" };
  }
  const outcome = await sync.start(request);
  if (outcome.status === "blocked") openSignIn();
  return outcome;
}

export type CatalogSyncNotice = "started" | "already" | "blocked" | "done" | "warning" | "failed" | "cancelled" | "inspect" | "unconfirmed";

export function catalogSyncNotice(snapshot: CatalogSyncSnapshotV03): CatalogSyncNotice {
  if (snapshot.recoveryDisposition === "inspect_required") return "inspect";
  switch (snapshot.state) {
    case "running": return "started";
    case "succeeded": return "done";
    case "succeeded_with_warnings": return "warning";
    case "cancelled": return "cancelled";
    case "failed": return snapshot.errorCode === "vua.catalog.sign_in_required" ? "blocked" : "failed";
  }
}
