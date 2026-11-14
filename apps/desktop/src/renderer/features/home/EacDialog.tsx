import { useCallback, useEffect, useRef, useState } from "react";
import type { EacProbeSnapshotV02, EacRecoveryStepIdV02 } from "@vua/contracts";
import { Button } from "../../components/primitives/Button.tsx";
import { ConfirmDialog } from "../../components/primitives/ConfirmDialog.tsx";
import { useDialogMotion } from "../../components/primitives/dialog-motion.ts";
import { ModalOwnerContext, useModalLayer } from "../../components/primitives/modal-layer.tsx";
import { useGateway } from "../../gateway/index.ts";
import { format, strings } from "../../i18n/index.ts";
import { openEncyclopedia } from "../help/encyclopedia-navigation.ts";
import {
  EAC_DIALOG_POLL_MS,
  armUnloadReminder,
  completeUnloadReminderWithToast,
  eacConclusionHeadline,
  eacGuideTarget,
  formatEvidenceTime,
  formatRepairOutcome,
  isUnloadReminderArmed,
  isUnloadingLong,
  selectLadderStep,
  subscribeUnloadReminder,
} from "./eac-model.ts";
import "./eac-dialog.css";

export interface EacDialogProps {
  readonly open: boolean;
  readonly initialSnapshot: EacProbeSnapshotV02 | null;
  readonly canLaunchRepair?: boolean;
  readonly onClose: () => void;
  readonly onSnapshotChange?: (snapshot: EacProbeSnapshotV02) => void;
  readonly onStopVrchat?: () => void;
}

export function EacDialog({
  open,
  initialSnapshot,
  canLaunchRepair = false,
  onClose,
  onSnapshotChange,
  onStopVrchat,
}: EacDialogProps) {
  const eacPort = useGateway().environment.eac;
  const copy = strings.eac;
  const [snapshot, setSnapshot] = useState<EacProbeSnapshotV02 | null>(initialSnapshot);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [stepOffset, setStepOffset] = useState(0);
  const [remindArmed, setRemindArmed] = useState<boolean>(() => isUnloadReminderArmed());
  const [readyAfterWait, setReadyAfterWait] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confirmTerminate, setConfirmTerminate] = useState(false);
  const [confirmRepair, setConfirmRepair] = useState(false);
  const [repairCapable, setRepairCapable] = useState(canLaunchRepair);
  const wasUnloadingRef = useRef(false);

  const modal = useModalLayer(open, onClose);
  const shown = useDialogMotion(open, modal.overlayRef, modal.panelRef);

  useEffect(() => {
    setRepairCapable(canLaunchRepair);
    if (!open || canLaunchRepair || !eacPort) return;
    let alive = true;
    void Promise.all([eacPort.repairCapability(), eacPort.getExperimentalTermination()]).then(
      ([cap, exp]) => {
        if (alive) setRepairCapable(cap.state === "ready" && exp.enabled);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [open, canLaunchRepair, eacPort]);

  useEffect(() => {
    if (initialSnapshot !== null) {
      setSnapshot(initialSnapshot);
      wasUnloadingRef.current = initialSnapshot.conclusion === "unloading";
    }
  }, [initialSnapshot]);

  const applySnapshot = useCallback(
    (next: EacProbeSnapshotV02) => {
      if (wasUnloadingRef.current && next.conclusion === "ready") {
        setReadyAfterWait(true);
        completeUnloadReminderWithToast(() => strings.eac.conclusions.ready_after_wait);
      }
      wasUnloadingRef.current = next.conclusion === "unloading";
      setSnapshot((prev) => {
        if (prev?.conclusion !== next.conclusion) {
          setStepOffset(0);
        }
        return next;
      });
      setNowMs(Date.now());
      onSnapshotChange?.(next);
    },
    [onSnapshotChange],
  );

  useEffect(() => {
    setRemindArmed(isUnloadReminderArmed());
    if (!open) return subscribeUnloadReminder(() => setRemindArmed(isUnloadReminderArmed()));
    return subscribeUnloadReminder(
      () => setRemindArmed(isUnloadReminderArmed()),
      applySnapshot,
    );
  }, [open, applySnapshot]);

  const refresh = useCallback(async () => {
    if (!eacPort) return;
    setBusy(true);
    try {
      const next = await eacPort.inspect();
      applySnapshot(next);
    } catch {
      /* Preserve the last confirmed snapshot if an interim read fails. */
    } finally {
      setBusy(false);
    }
  }, [eacPort, applySnapshot]);

  useEffect(() => {
    if (!open || !eacPort) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (!isUnloadReminderArmed()) {
        try {
          const next = await eacPort.inspect();
          if (active) applySnapshot(next);
        } catch {
          /* Keep last snapshot while open. */
        }
      }
      if (active) {
        timer = setTimeout(() => {
          void tick();
        }, EAC_DIALOG_POLL_MS);
      }
    };

    if (snapshot === null) {
      void tick();
    } else {
      timer = setTimeout(() => {
        void tick();
      }, EAC_DIALOG_POLL_MS);
    }

    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [open, eacPort]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) {
      setReadyAfterWait(false);
      setFeedback(null);
      setConfirmTerminate(false);
      setConfirmRepair(false);
      setStepOffset(0);
    }
  }, [open]);

  if (!shown) return null;

  const openExplorer = async () => {
    if (!eacPort) return;
    const result = await eacPort.openRepairFolder();
    if (!result.opened) {
      setFeedback(copy.openExplorerFailed);
    }
  };

  const runStep = (step: EacRecoveryStepIdV02) => {
    setFeedback(null);
    switch (step) {
      case "wait_unload":
      case "quit_steam":
        void refresh();
        break;
      case "stop_vrchat":
        if (onStopVrchat) onStopVrchat();
        void refresh();
        break;
      case "terminate_residual":
        if (snapshot?.terminationCapability.state === "available" && snapshot.terminationCapability.candidate !== null) {
          setConfirmTerminate(true);
        }
        break;
      case "official_repair":
        if (repairCapable) {
          setConfirmRepair(true);
        } else {
          void openExplorer();
        }
        break;
      case "restart_pc":
        if (snapshot !== null) openEncyclopedia(eacGuideTarget(snapshot));
        break;
    }
  };

  const executeTerminate = async () => {
    const candidate = snapshot?.terminationCapability.candidate;
    if (!eacPort || !candidate || candidate.created === null) {
      setConfirmTerminate(false);
      return;
    }
    setConfirmTerminate(false);
    setBusy(true);
    try {
      const outcome = await eacPort.terminateResidual(
        { pid: candidate.pid, created: candidate.created, path: candidate.path },
        crypto.randomUUID(),
      );
      applySnapshot(outcome.eacSnapshot);
      if (outcome.termination.kind === "terminated") {
        setFeedback(copy.terminateConfirm.succeeded);
      } else if (outcome.termination.kind === "refused") {
        setFeedback(format(copy.terminateConfirm.refused, { detail: outcome.termination.guard }));
      } else {
        setFeedback(format(copy.terminateConfirm.failed, { detail: outcome.termination.guard }));
      }
    } catch (error) {
      setFeedback(
        format(copy.terminateConfirm.refused, {
          detail: error instanceof Error ? error.message : "unavailable",
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const executeRepair = async () => {
    if (!eacPort) {
      setConfirmRepair(false);
      return;
    }
    setConfirmRepair(false);
    setBusy(true);
    try {
      const outcome = await eacPort.launchRepair(crypto.randomUUID());
      applySnapshot(outcome.eacSnapshot);
      if (outcome.repair.outcome === "already_running" || !outcome.eacSnapshot.lastRepair) {
        setFeedback(formatRepairOutcome(outcome.repair, copy));
      } else {
        setFeedback(null);
      }
    } catch (error) {
      setFeedback(
        format(copy.repairConfirm.failed, {
          outcome: error instanceof Error ? error.message : "unavailable",
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const headline = snapshot
    ? eacConclusionHeadline(snapshot, copy, nowMs, readyAfterWait)
    : copy.dialogTitle;
  const ladder = snapshot ? selectLadderStep(snapshot, stepOffset, nowMs) : { current: null, index: 0, hasNext: false };
  const candidate = snapshot?.terminationCapability.candidate ?? null;
  const lastRepairFeedback = snapshot?.lastRepair
    ? formatRepairOutcome(snapshot.lastRepair, copy)
    : null;

  const processesText = !snapshot || snapshot.processes.length === 0
    ? copy.evidence.processesNone
    : format(copy.evidence.processesSummary, {
        count: snapshot.processes.length,
        names: [...new Set(snapshot.processes.map((proc) => proc.name))].join(", "),
      });

  const servicesText = snapshot
    ? snapshot.services
        .map((svc) =>
          svc.present
            ? format(copy.evidence.servicePresent, {
                name: svc.name,
                state: copy.evidence.serviceStates[svc.state],
              })
            : format(copy.evidence.serviceAbsent, { name: svc.name }),
        )
        .join(" · ")
    : "";

  const steamText = !snapshot || snapshot.steam.runningFlag === null
    ? copy.evidence.steamUnknown
    : snapshot.steam.runningFlag === 1
      ? copy.evidence.steamRunning
      : copy.evidence.steamIdle;

  const installText = !snapshot
    ? ""
    : snapshot.install.eacFolder === "present"
        && snapshot.install.setupSignature === "verified"
        && snapshot.install.serviceBinary === "verified"
      ? copy.evidence.installVerified
      : format(copy.evidence.installSummary, {
          folder: copy.evidence.installStates[snapshot.install.eacFolder],
          setup: copy.evidence.installStates[snapshot.install.setupSignature],
          service: copy.evidence.installStates[snapshot.install.serviceBinary],
        });

  const logsText = !snapshot || snapshot.logFindings.length === 0
    ? copy.evidence.logsNone
    : snapshot.logFindings
        .map((finding) => {
          const label = copy.evidence.logCodes[finding.code];
          return finding.observedAt
            ? format(copy.evidence.logWithTime, { label, time: formatEvidenceTime(finding.observedAt) })
            : label;
        })
        .join(" · ");

  return (
    <ModalOwnerContext value={modal.id}>
      <div
        ref={modal.overlayRef}
        className="vua-eac-dialog__overlay"
        data-closing={open ? undefined : true}
        onClick={modal.closeTop}
        data-testid="eac-dialog-overlay"
      >
        <div
          ref={modal.panelRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={headline}
          className="vua-eac-dialog"
          data-conclusion={snapshot?.conclusion}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="vua-eac-dialog__header">
            <h2 className="vua-eac-dialog__headline">{headline}</h2>
            <button
              type="button"
              className="vua-eac-dialog__close"
              aria-label={copy.dismiss}
              onClick={modal.closeTop}
            >
              ×
            </button>
          </div>

          <div className="vua-eac-dialog__body">
            {snapshot ? (
              <>
                <div className="vua-eac-dialog__meta">
                  <span>{copy.evidence.title}</span>
                  <time dateTime={snapshot.capturedAt}>
                    {format(copy.evidence.capturedAt, { time: formatEvidenceTime(snapshot.capturedAt) })}
                  </time>
                </div>

                <dl className="vua-eac-dialog__facts">
                  <div className="vua-eac-dialog__fact">
                    <dt>{copy.evidence.processes}</dt>
                    <dd>{processesText}</dd>
                  </div>
                  <div className="vua-eac-dialog__fact">
                    <dt>{copy.evidence.services}</dt>
                    <dd>{servicesText}</dd>
                  </div>
                  <div className="vua-eac-dialog__fact">
                    <dt>{copy.evidence.steam}</dt>
                    <dd>{steamText}</dd>
                  </div>
                  <div className="vua-eac-dialog__fact">
                    <dt>{copy.evidence.install}</dt>
                    <dd>{installText}</dd>
                  </div>
                  <div className="vua-eac-dialog__fact">
                    <dt>{copy.evidence.logs}</dt>
                    <dd>{logsText}</dd>
                  </div>
                </dl>

                {snapshot.processes.length > 0 ? (
                  <details className="vua-eac-dialog__details">
                    <summary>{copy.evidence.details}</summary>
                    <ul className="vua-eac-dialog__paths">
                      {snapshot.processes.map((proc) => (
                        <li key={`${proc.pid}-${proc.created ?? "none"}`}>
                          {proc.name} (PID {proc.pid}, {proc.hasVisibleWindow ? copy.evidence.windowVisible : copy.evidence.windowHidden}) — {proc.path ?? copy.evidence.noPath}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                {ladder.current !== null ? (
                  <div className="vua-eac-dialog__ladder" data-step={ladder.current}>
                    <p className="vua-eac-dialog__hint">{copy.steps[ladder.current].hint}</p>
                    <div className="vua-eac-dialog__step-actions">
                      <Button
                        variant={ladder.current === "terminate_residual" ? "danger" : "primary"}
                        disabled={busy}
                        data-nav-id={`eac-step-${ladder.current}`}
                        onClick={() => runStep(ladder.current!)}
                      >
                        {copy.steps[ladder.current].button}
                      </Button>
                      {ladder.current === "official_repair" && repairCapable ? (
                        <Button variant="subtle" disabled={busy} onClick={() => { void openExplorer(); }}>
                          {copy.openExplorer}
                        </Button>
                      ) : null}
                      {snapshot.conclusion === "unloading" && !isUnloadingLong(snapshot, nowMs) ? (
                        <Button
                          variant="subtle"
                          disabled={remindArmed || !eacPort}
                          onClick={() => {
                            if (eacPort) {
                              armUnloadReminder(eacPort, () => strings.eac.conclusions.ready_after_wait);
                            }
                          }}
                        >
                          {copy.remindWhenReady}
                        </Button>
                      ) : null}
                      {ladder.hasNext ? (
                        <Button
                          variant="subtle"
                          onClick={() => setStepOffset(ladder.index + 1)}
                        >
                          {copy.nextStep}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {remindArmed ? <p className="vua-eac-dialog__feedback" role="status">{copy.remindArmed}</p> : null}
                {lastRepairFeedback ? <p className="vua-eac-dialog__feedback" role="status" data-testid="eac-last-repair">{lastRepairFeedback}</p> : null}
                {feedback && feedback !== lastRepairFeedback ? <p className="vua-eac-dialog__feedback" role="status">{feedback}</p> : null}
              </>
            ) : null}
          </div>

          <div className="vua-eac-dialog__footer">
            <div className="vua-eac-dialog__step-actions">
              {snapshot ? (
                <Button
                  variant="subtle"
                  data-nav-id="eac-open-guide"
                  onClick={() => openEncyclopedia(eacGuideTarget(snapshot))}
                >
                  {copy.openGuide}
                </Button>
              ) : null}
              <Button variant="subtle" disabled={busy} onClick={() => { void refresh(); }}>
                {copy.refresh}
              </Button>
            </div>
            <Button variant="default" onClick={modal.closeTop}>
              {copy.dismiss}
            </Button>
          </div>
        </div>
      </div>

      {candidate ? (
        <ConfirmDialog
          open={confirmTerminate}
          danger
          title={copy.terminateConfirm.title}
          cancelLabel={copy.cancel}
          confirmLabel={copy.terminateConfirm.confirmButton}
          onCancel={() => setConfirmTerminate(false)}
          onConfirm={() => { void executeTerminate(); }}
        >
          <div className="vua-confirm-dialog__warning">
            <p>{copy.terminateConfirm.riskWarning}</p>
          </div>
          <dl className="vua-eac-dialog__facts">
            <div className="vua-eac-dialog__fact">
              <dt>{copy.terminateConfirm.nameLabel}</dt>
              <dd>{candidate.name}</dd>
            </div>
            <div className="vua-eac-dialog__fact">
              <dt>{copy.terminateConfirm.pidLabel}</dt>
              <dd>{candidate.pid}</dd>
            </div>
            <div className="vua-eac-dialog__fact">
              <dt>{copy.terminateConfirm.pathLabel}</dt>
              <dd>{candidate.path}</dd>
            </div>
            <div className="vua-eac-dialog__fact">
              <dt>{copy.terminateConfirm.publisherLabel}</dt>
              <dd>{candidate.publisherEvidence}</dd>
            </div>
            <div className="vua-eac-dialog__fact">
              <dt>{copy.terminateConfirm.reasonLabel}</dt>
              <dd>{candidate.allowlistReason}</dd>
            </div>
          </dl>
        </ConfirmDialog>
      ) : null}

      <ConfirmDialog
        open={confirmRepair}
        title={copy.repairConfirm.title}
        cancelLabel={copy.cancel}
        confirmLabel={copy.repairConfirm.confirmButton}
        onCancel={() => setConfirmRepair(false)}
        onConfirm={() => { void executeRepair(); }}
      >
        <p>{copy.repairConfirm.body}</p>
        <p>{copy.repairConfirm.publisherNote}</p>
      </ConfirmDialog>
    </ModalOwnerContext>
  );
}
