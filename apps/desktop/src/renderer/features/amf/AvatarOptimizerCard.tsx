/** Optional Avatar Optimizer (TraceAndOptimize) panel for finished Workshop lines. */
import { useState } from "react";
import { formatBytes, type AmfOptimizerReport, type AmfProductionPort, type AmfProductionRun } from "../../gateway/index.ts";
import { Alert } from "../../components/primitives/Alert.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { Card } from "../../components/primitives/Card.tsx";
import { strings } from "../../i18n/index.ts";

const copy = strings.avatarOptimizer;
const sdkRatings = strings.sdkReview.ratings;

function formatRank(value: string): string {
  if (!value || value === "None") return "—";
  return sdkRatings[value as keyof typeof sdkRatings] ?? value;
}

function OptimizerReportBlock({ report, packageMissing }: { report: AmfOptimizerReport; packageMissing: boolean }) {
  if (report.state === "not_run") return null;
  if (report.state === "failed") {
    return <p className="vua-caption vua-text-secondary">
      {packageMissing || report.detail.toLowerCase().includes("package") ? copy.unmeasuredPackageMissing : copy.unmeasuredFailed}
    </p>;
  }
  const { before, after } = report;
  const rows: readonly { readonly key: string; readonly label: string; readonly beforeText: string; readonly afterText: string }[] = [
    { key: "overall", label: copy.metrics.overall, beforeText: formatRank(before.overall), afterText: formatRank(after.overall) },
    { key: "triangles", label: copy.metrics.triangles, beforeText: before.triangles.toLocaleString(), afterText: after.triangles.toLocaleString() },
    { key: "materialSlots", label: copy.metrics.materialSlots, beforeText: String(before.materialSlots), afterText: String(after.materialSlots) },
    { key: "skinnedMeshes", label: copy.metrics.skinnedMeshes, beforeText: String(before.skinnedMeshes), afterText: String(after.skinnedMeshes) },
    { key: "textureBytes", label: copy.metrics.textureBytes, beforeText: formatBytes(before.textureBytes), afterText: formatBytes(after.textureBytes) },
    { key: "physBones", label: copy.metrics.physBones, beforeText: String(before.physBones), afterText: String(after.physBones) },
  ];
  return <div className="vua-line__prediction">
    <p>{copy.reportTitle}</p>
    <table className="vua-line__prediction-table">
      <thead>
        <tr>
          <th scope="col" style={{ textAlign: "start" }}>{copy.columns.metric}</th>
          <th scope="col">{copy.columns.before}</th>
          <th scope="col">{copy.columns.after}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.key}>
            <th scope="row">{row.label}</th>
            <td>{row.beforeText}</td>
            <td>{row.afterText}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <span className="vua-caption vua-text-secondary">{copy.localOnlyNote}</span>
  </div>;
}

export function AvatarOptimizerCard({ port, run, disabled, ftLocked, onStarted, onError }: {
  port: AmfProductionPort;
  run: AmfProductionRun;
  disabled: boolean;
  ftLocked: boolean;
  onStarted: (taskId: string) => void;
  onError: (error: unknown) => void;
}) {
  const [updating, setUpdating] = useState(false);
  const enabled = run.optimizer?.enabled === true;
  const report = run.result?.facts?.optimizerReport ?? run.optimizer?.report ?? null;
  const ft = run.result?.facts?.faceTracking;
  const activeFt = ft !== undefined && (
    ft.manualReplayRequired
    || ft.parameters.length > 0
    || ft.components.some(component => component !== "" && !component.startsWith("nadena.dev.modular_avatar."))
  );
  const oscWarning = (run.result?.facts?.optimizerWarnings?.includes("osc_gimmick_possible") ?? false) || activeFt;

  const toggle = async () => {
    if (updating || disabled || ftLocked) return;
    setUpdating(true);
    try {
      const accepted = await port.setOptimizer(run.runId, !enabled, copy.task);
      onStarted(accepted.taskId);
    } catch (error) {
      onError(error);
    } finally {
      setUpdating(false);
    }
  };

  return <Card className="vua-optimizer" data-nav-id="workshop-avatar-optimizer">
    <div className="vua-n3__toolbar">
      <h2>{copy.title}<span className="vua-n3__tag">{enabled ? copy.badgeOn : copy.badgeOff}</span></h2>
    </div>
    <p>{copy.intro}</p>
    <p className="vua-caption vua-text-secondary">{copy.boundaryNote}</p>
    {oscWarning && <Alert tone="warning">{copy.oscCaution}</Alert>}
    {ftLocked && <p className="vua-caption vua-text-secondary">{copy.ftLockedNote}</p>}
    {report !== null && <OptimizerReportBlock report={report} packageMissing={run.optimizer?.packageVersion === null} />}
    <div className="vua-n3__actions">
      <Button
        variant={enabled ? "subtle" : "default"}
        disabled={disabled || updating || ftLocked}
        data-nav-id="workshop-optimizer-toggle"
        onClick={() => { void toggle(); }}
      >
        {updating ? copy.working : enabled ? copy.disable : copy.enable}
      </Button>
    </div>
  </Card>;
}
