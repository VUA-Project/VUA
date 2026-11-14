import { useCallback, useEffect, useRef, useState } from "react";
import type { PoseGraphSnapshotV01, PoseSourceStateV01 } from "@vua/contracts";
import { Icon } from "@vua/design-system";
import type { PageId } from "../../app/nav-model.ts";
import { Badge } from "../../components/primitives/Badge.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { useGateway } from "../../gateway/index.ts";
import { format, strings } from "../../i18n/index.ts";

function sourceTone(state: PoseSourceStateV01, detailCode: string | null): "success" | "warning" | "neutral" {
  if (detailCode === "blocked_by_safe_mode") return "warning";
  return state === "active" || state === "ready" ? "success" : "neutral";
}

export function PoseGraphSection({
  navigate,
}: {
  navigate?: ((page: PageId, hash?: string) => void) | undefined;
}) {
  const copy = strings.poseGraph;
  const port = useGateway().environment.poseGraph;
  const [snapshot, setSnapshot] = useState<PoseGraphSnapshotV01 | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const alive = useRef(false);

  const load = useCallback(async () => {
    if (!port) return;
    const ticket = ++generation.current;
    setBusy(true);
    setFailed(false);
    try {
      const next = await port.observe();
      if (alive.current && ticket === generation.current) {
        setSnapshot(next);
      }
    } catch {
      if (alive.current && ticket === generation.current) {
        setFailed(true);
      }
    } finally {
      if (alive.current && ticket === generation.current) {
        setBusy(false);
      }
    }
  }, [port]);

  useEffect(() => {
    alive.current = true;
    if (port) void load();
    return () => {
      alive.current = false;
      generation.current += 1;
    };
  }, [port, load]);

  if (!port) return null;

  return (
    <section className="vua-environment-section vua-pose-graph" data-pose-graph>
      <header className="vua-pose-graph__header">
        <div>
          <h2>{copy.title}</h2>
          <p className="vua-pose-graph__subtitle">{copy.subtitle}</p>
        </div>
        <Button
          variant="subtle"
          data-nav-id="tools-refresh-pose-graph"
          disabled={busy}
          onClick={() => void load()}
        >
          {busy ? copy.refreshing : copy.refresh}
        </Button>
      </header>

      {failed ? <p role="status" className="vua-pose-graph__status">{copy.failed}</p> : null}

      {snapshot ? (
        <div className="vua-pose-graph__body">
          {snapshot.fbtDriverConflictRisk === "multiple_openvr_fbt_drivers"
          || snapshot.blockedSteamvrDrivers.length > 0 ? (
            <div className="vua-pose-graph__panel vua-pose-graph__alert" role="status" data-pose-conflict-alert>
              <div className="vua-pose-graph__alert-copy">
                {snapshot.fbtDriverConflictRisk === "multiple_openvr_fbt_drivers" ? (
                  <p className="vua-pose-graph__alert-text">
                    <Icon name="warning" size={16} />
                    <span>{copy.conflictMultipleFbtDrivers}</span>
                  </p>
                ) : null}
                {snapshot.blockedSteamvrDrivers.length > 0 ? (
                  <p className="vua-pose-graph__alert-text">
                    <Icon name="warning" size={16} />
                    <span>
                      {format(copy.conflictSafeModeBlocked, {
                        drivers: snapshot.blockedSteamvrDrivers.map((id) => copy.driverNames[id]).join(", "),
                      })}
                    </span>
                  </p>
                ) : null}
              </div>
              {navigate ? (
                <Button
                  variant="subtle"
                  data-nav-id="pose-graph-diagnose-fbt"
                  onClick={() => navigate("help", "help?sub=diagnostics&symptom=fbt_drift_or_calibration")}
                >
                  {copy.diagnoseInHelpCta}
                  <Icon name="arrow-right" size={16} />
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="vua-pose-graph__panel">
            <h3>{copy.openxrTitle}</h3>
            <div className="vua-pose-graph__row">
              <strong>{snapshot.openxr.runtimeName ?? copy.openxrUnset}</strong>
              <Badge tone={snapshot.openxr.presence === "found" ? "success" : "neutral"}>
                {copy.openxrPresence[snapshot.openxr.presence]}
              </Badge>
            </div>
            {snapshot.lastHeadsetHint ? (
              <p className="vua-pose-graph__meta">
                {format(copy.headsetHint, { name: snapshot.lastHeadsetHint })}
              </p>
            ) : null}
          </div>

          <div className="vua-pose-graph__panel">
            <h3>{copy.sourcesTitle}</h3>
            <ul className="vua-pose-graph__sources">
              {snapshot.poseSources.map((source) => (
                <li key={source.sourceId} className="vua-pose-graph__source" data-pose-source={source.sourceId}>
                  <div className="vua-pose-graph__source-main">
                    <strong>{copy.sourceNames[source.sourceId]}</strong>
                  </div>
                  <div className="vua-pose-graph__badges">
                    {source.detailCode === "blocked_by_safe_mode" ? (
                      <Badge tone="warning">{copy.blockedBySafeMode}</Badge>
                    ) : (
                      <Badge tone={sourceTone(source.state, source.detailCode)}>
                        {copy.sourceStates[source.state]}
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="vua-pose-graph__panel">
            <h3>{copy.driversTitle}</h3>
            {snapshot.steamvrDrivers.length === 0 ? (
              <p className="vua-pose-graph__meta">{copy.driversEmpty}</p>
            ) : (
              <ul className="vua-pose-graph__drivers">
                {snapshot.steamvrDrivers.map((driverId) => {
                  const blocked = snapshot.blockedSteamvrDrivers.includes(driverId);
                  return (
                    <li key={driverId} className="vua-pose-graph__driver">
                      <span>{copy.driverNames[driverId]}</span>
                      <Badge tone={blocked ? "warning" : "success"}>
                        {blocked ? copy.blockedBySafeMode : copy.sourceStates.installed}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
