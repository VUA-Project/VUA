import { useCallback, useEffect, useRef, useState } from "react";
import type { ExternalToolAction, ExternalToolSnapshot } from "@vua/contracts";
import { useGateway } from "../../gateway/index.ts";
export function useVrcft() {
  const port = useGateway().environment.tools;
  const [snapshot, setSnapshot] = useState<ExternalToolSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const active = useRef(false), busy = useRef(false), epoch = useRef(0);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    const version = ++epoch.current;
    try { if (!port) throw new Error("unavailable"); const next = await port.observe();
      if (active.current && version === epoch.current) { setSnapshot(next); setFailed(false); }
    } catch { if (active.current && version === epoch.current) { setFailed(true); setSnapshot(null); } }
  }, [port]);
  useEffect(() => {
    active.current = true; let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { if (!document.hidden) await refresh(); if (!cancelled) timer = setTimeout(() => { void poll(); }, document.documentElement.dataset.effects === "off" ? 5000 : 2000); };
    void poll(); const focus = () => { void refresh(); }; window.addEventListener("focus", focus);
    return () => { active.current = false; ++epoch.current; cancelled = true; clearTimeout(timer); window.removeEventListener("focus", focus); };
  }, [refresh]);
  const act = async (action: ExternalToolAction) => {
    if (!port || busy.current) return;
    busy.current = true; ++epoch.current; setPending(true);
    try { const next = await port.act(action, crypto.randomUUID()); if (active.current) { setSnapshot(next); setFailed(false); } }
    catch { if (active.current) { setFailed(true); setSnapshot(null); } }
    finally { busy.current = false; if (active.current) setPending(false); }
  };
  return { snapshot, pending, failed, available: !!port, refresh, act };
}
