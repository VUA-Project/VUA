import type { CatalogSyncSnapshotV03 } from "@vua/contracts";

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
