import { useEffect, useState } from "react";
import type { AiToolsSnapshotV01, AiUploadConfirmationV01 } from "@vua/contracts";
import { useGateway } from "../../gateway/index.ts";

/** Live AI connection facts and the player's decision on a request. */
export function useAiRequests() {
  const port = useGateway().aiTools;
  const [snapshot, setSnapshot] = useState<AiToolsSnapshotV01 | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!port) return;
    let alive = true;
    const update = (value: AiToolsSnapshotV01) => { if (alive) setSnapshot(value); };
    void port.snapshot().then(update, () => { if (alive) setFailed(true); });
    const unsubscribe = port.subscribe(update);
    return () => { alive = false; unsubscribe(); };
  }, [port]);
  /** `confirmation` is the player's upload confirmation from the Release page's dialog. */
  const resolve = async (id: string, decision: "approve" | "reject", confirmation?: AiUploadConfirmationV01) => {
    if (!port) return;
    setBusy(true); setFailed(false);
    try { setSnapshot(await port.resolve(id, decision, confirmation)); } catch { setFailed(true); } finally { setBusy(false); }
  };
  return { port, snapshot, setSnapshot, busy, setBusy, failed, setFailed, resolve };
}
