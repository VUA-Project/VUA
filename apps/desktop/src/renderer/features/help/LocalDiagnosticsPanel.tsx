import { useEffect, useRef, useState } from "react";
import {
  SYMPTOM_IDS_V01,
  type LocalDiagnosticsSnapshotV01,
  type SymptomDiagnosisV01,
  type SymptomIdV01,
  type UdpPortObservationV01,
} from "@vua/contracts";
import { Icon } from "@vua/design-system";
import type { PageId } from "../../app/nav-model.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { useEscapeClose } from "../../components/use-escape-close.ts";
import { useAmfModule, useGateway } from "../../gateway/index.ts";
import { format, strings } from "../../i18n/index.ts";
import "./local-diagnostics.css";

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${mib.toFixed(1)} MiB`;
  const gib = mib / 1024;
  return `${gib.toFixed(1)} GiB`;
}

function formatPort(port: UdpPortObservationV01, copy: typeof strings.localDiagnostics.cards): string {
  if (port.state === "unbound") return copy.portUnbound;
  if (port.state === "probe_unavailable") return copy.portUnavailable;
  if (port.ownerProcess) return format(copy.portBound, { owner: port.ownerProcess });
  return format(copy.portBoundUnknown, { pid: port.ownerPid ?? 0 });
}

function formatError(err: unknown, copy: typeof strings.localDiagnostics.errors): string {
  const code = err instanceof Error ? err.message : "unknown";
  if (code === "vua.diagnostics.client_running") return copy.clientRunning;
  if (code === "vua.diagnostics.config_malformed") return copy.configMalformed;
  return format(copy.generic, { code });
}

type SopJumpKey = keyof typeof strings.localDiagnostics.sopActions;

function sopJumpForStep(stepId: string): { readonly page: PageId; readonly labelKey: SopJumpKey } | null {
  switch (stepId) {
    case "osc_resolve_port_9000_conflict":
    case "osc_align_oscquery_port":
    case "osc_verify_radial_menu_and_companion":
    case "fbt_check_multi_driver_and_safe_mode":
    case "fbt_space_calibrator":
    case "playspace_reset_ovras_offsets":
      return { page: "tools-discover", labelKey: "openTools" };
    case "osc_check_avatar_parameters":
    case "perf_avatar_texture_memory_optimization":
      return { page: "workshop", labelKey: "openWorkshop" };
    case "steamvr_unblock_safe_mode_drivers":
    case "crash_steamvr_openxr_runtime":
      return { page: "env-play", labelKey: "openPlay" };
    case "upload_unity_2022_3_22f1_and_sdk_checks":
      return { page: "env-create", labelKey: "openUnitySetup" };
    case "upload_trust_rank_and_2fa":
    case "upload_blueprint_id_ownership":
      return { page: "release", labelKey: "openFinishedAvatars" };
    default:
      return null;
  }
}

/** Builds a zero-path, zero-username, zero-device-name diagnostic summary safe for pasting. */
export function buildRedactedDiagnosticSummary(
  snapshot: LocalDiagnosticsSnapshotV01,
  diagnosis: SymptomDiagnosisV01 | null,
): string {
  return JSON.stringify(
    {
      schemaVersion: snapshot.schemaVersion,
      clientRunning: snapshot.clientRunning,
      recentLog: snapshot.recentClientLog.classification,
      cache: {
        presence: snapshot.clientCache.presence,
        used: formatBytes(snapshot.clientCache.totalBytes),
        free: formatBytes(snapshot.clientCache.driveFreeBytes),
        cacheSizeGb: snapshot.clientConfig.cacheSizeGb,
        cacheExpiryDelayDays: snapshot.clientConfig.cacheExpiryDelayDays,
      },
      osc: {
        udp9000: snapshot.osc.udp9000.state,
        udp9001: snapshot.osc.udp9001.state,
        avatarConfigCount: snapshot.osc.avatarConfigCount,
        oscQuery: {
          state: snapshot.osc.oscQuery.state,
          httpPort: snapshot.osc.oscQuery.httpPort,
          advertisedOscPort: snapshot.osc.oscQuery.advertisedOscPort,
        },
      },
      steamvr: {
        presence: snapshot.steamvrSettings.presence,
        renderTargetMultiplier: snapshot.steamvrSettings.renderTargetMultiplier,
        vrchatResolutionScale: snapshot.steamvrSettings.vrchatResolutionScale,
        blockedDriverCount: snapshot.steamvrSettings.blockedDrivers.length,
      },
      audio: {
        defaultCaptureRole: snapshot.audioEndpoints.defaultCaptureRole,
        virtualMicHijack: snapshot.audioEndpoints.virtualMicHijack,
        communicationsMismatch: snapshot.audioEndpoints.communicationsMismatch,
      },
      streaming: {
        questLink: {
          presence: snapshot.streamingSettings.questLink.presence,
          encodeResolutionWidth: snapshot.streamingSettings.questLink.encodeResolutionWidth,
          encodeBitrateMbps: snapshot.streamingSettings.questLink.encodeBitrateMbps,
        },
        picoConnect: {
          presence: snapshot.streamingSettings.picoConnect.presence,
          preset: snapshot.streamingSettings.picoConnect.preset,
          bitrateMbps: snapshot.streamingSettings.picoConnect.bitrateMbps,
        },
      },
      systemTuning: {
        hardwareGpuScheduling: snapshot.systemTuning.hardwareGpuScheduling,
        powerPlanRole: snapshot.systemTuning.powerPlanRole,
        ovrAdvancedSettingsInstalled: snapshot.systemTuning.ovrAdvancedSettingsInstalled,
      },
      diagnosis: diagnosis
        ? {
            symptom: diagnosis.symptom,
            findings: diagnosis.findings.map(finding => finding.code),
          }
        : null,
    },
    null,
    2,
  );
}

export function LocalDiagnosticsPanel({
  onBack,
  navigate,
  initialSymptom,
}: {
  onBack: () => void;
  navigate?: ((page: PageId, hash?: string) => void) | undefined;
  initialSymptom?: SymptomIdV01 | undefined;
}) {
  useEscapeClose(true, onBack);
  const port = useGateway().environment.diagnostics;
  const amf = useAmfModule();
  const copy = strings.localDiagnostics;
  const symptomStripRef = useRef<HTMLDivElement>(null);
  const [snapshot, setSnapshot] = useState<LocalDiagnosticsSnapshotV01 | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [unavailable, setUnavailable] = useState(() => !port);
  const [selectedSymptom, setSelectedSymptom] = useState<SymptomIdV01>(
    () => initialSymptom ?? "osc_or_face_tracking_not_responding",
  );
  const [diagnosis, setDiagnosis] = useState<SymptomDiagnosisV01 | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [summaryCopied, setSummaryCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
  }, []);

  const [cacheSizeInput, setCacheSizeInput] = useState("20");
  const [cacheExpiryInput, setCacheExpiryInput] = useState("30");
  const [oscBusy, setOscBusy] = useState(false);
  const [oscFeedback, setOscFeedback] = useState<string | null>(null);
  const [cfgBusy, setCfgBusy] = useState(false);
  const [cfgFeedback, setCfgFeedback] = useState<string | null>(null);

  const syncConfigInputs = (next: LocalDiagnosticsSnapshotV01) => {
    setCacheSizeInput(String(next.clientConfig.cacheSizeGb ?? 20));
    setCacheExpiryInput(String(next.clientConfig.cacheExpiryDelayDays ?? 30));
  };

  const loadAll = async (symptom: SymptomIdV01) => {
    if (!port) {
      setUnavailable(true);
      return;
    }
    setRefreshing(true);
    setDiagnosing(true);
    try {
      const diag = await port.diagnose(symptom);
      setUnavailable(false);
      setSnapshot(diag.snapshot);
      setDiagnosis(diag);
      syncConfigInputs(diag.snapshot);
    } catch {
      setUnavailable(true);
    } finally {
      setRefreshing(false);
      setDiagnosing(false);
    }
  };

  useEffect(() => {
    void loadAll(selectedSymptom);
  }, [port]);

  const selectSymptom = async (symptom: SymptomIdV01) => {
    setSelectedSymptom(symptom);
    if (!port) return;
    setDiagnosing(true);
    try {
      const diag = await port.diagnose(symptom);
      setSnapshot(diag.snapshot);
      setDiagnosis(diag);
    } catch {
      /* Preserve prior snapshot if symptom check fails transiently. */
    } finally {
      setDiagnosing(false);
    }
  };

  useEffect(() => {
    if (initialSymptom && initialSymptom !== selectedSymptom) {
      void selectSymptom(initialSymptom);
    }
  }, [initialSymptom]);

  const canRunOfflineHelpers = snapshot?.clientRunning === false;

  const handleClearOscCache = async () => {
    if (!port || !canRunOfflineHelpers || oscBusy) return;
    setOscBusy(true);
    setOscFeedback(null);
    try {
      const receipt = await port.clearOscAvatarCache(crypto.randomUUID());
      setOscFeedback(
        format(copy.oscHelperDone, {
          count: receipt.removedFileCount,
          bytes: formatBytes(receipt.freedBytes),
        }),
      );
      await loadAll(selectedSymptom);
    } catch (err) {
      setOscFeedback(formatError(err, copy.errors));
    } finally {
      setOscBusy(false);
    }
  };

  const handleSaveClientConfig = async () => {
    if (!port || !canRunOfflineHelpers || cfgBusy) return;
    const sizeNum = Number.parseInt(cacheSizeInput.trim(), 10);
    const expiryNum = Number.parseInt(cacheExpiryInput.trim(), 10);
    if (
      !Number.isInteger(sizeNum)
      || sizeNum < 1
      || sizeNum > 200
      || !Number.isInteger(expiryNum)
      || expiryNum < 1
      || expiryNum > 365
    ) {
      setCfgFeedback(copy.configInvalidRange);
      return;
    }
    setCfgBusy(true);
    setCfgFeedback(null);
    try {
      const receipt = await port.updateClientConfig(
        { cacheSizeGb: sizeNum, cacheExpiryDelayDays: expiryNum },
        crypto.randomUUID(),
      );
      setCfgFeedback(
        format(copy.configSaveDone, {
          gb: receipt.cacheSizeGb ?? sizeNum,
          days: receipt.cacheExpiryDelayDays ?? expiryNum,
        }),
      );
      await loadAll(selectedSymptom);
    } catch (err) {
      setCfgFeedback(formatError(err, copy.errors));
    } finally {
      setCfgBusy(false);
    }
  };

  const handleCopySummary = async () => {
    if (!snapshot) return;
    try {
      await navigator.clipboard?.writeText(buildRedactedDiagnosticSummary(snapshot, diagnosis));
      setSummaryCopied(true);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        setSummaryCopied(false);
        copyTimerRef.current = null;
      }, 1800);
    } catch {
      /* Restricted clipboard environments stay quiet. */
    }
  };

  return (
    <div className="vua-page vua-help-child vua-local-diag" data-focus-scope data-local-diagnostics>
      <header className="vua-page__hero vua-environment-heading">
        <h1 className="vua-title">{copy.title}</h1>
        <div className="vua-local-diag__hero-actions">
          <Button
            data-nav-id="diagnostics-refresh"
            disabled={!port || refreshing}
            onClick={() => void loadAll(selectedSymptom)}
          >
            <Icon name="refresh" size={16} />
            {refreshing ? copy.refreshing : copy.refresh}
          </Button>
          {snapshot ? (
            <Button
              variant="subtle"
              data-nav-id="diagnostics-copy-summary"
              onClick={() => void handleCopySummary()}
            >
              <Icon name={summaryCopied ? "check" : "copy"} size={16} />
              <span aria-live="polite">{summaryCopied ? copy.copiedSummary : copy.copySummary}</span>
            </Button>
          ) : null}
          <Button variant="subtle" data-back data-nav-id="help-child-back" onClick={onBack}>
            {strings.journey.backToHelp}
          </Button>
        </div>
      </header>
      <p className="vua-local-diag__subtitle">{copy.subtitle}</p>

      {unavailable || !snapshot ? (
        <p className="vua-local-diag__guard" role="status">
          {refreshing ? copy.refreshing : copy.unavailable}
        </p>
      ) : (
        <>
          <section className="vua-local-diag__cards" aria-label={copy.title}>
            <article className="vua-local-diag__card" data-diag-card="client">
              <div className="vua-local-diag__card-head">
                <h3>{copy.cards.clientTitle}</h3>
                <Icon
                  name={snapshot.clientRunning === false ? "check" : "info"}
                  size={20}
                />
              </div>
              <p className="vua-local-diag__primary-fact">
                {snapshot.clientRunning === true
                  ? copy.cards.clientRunning
                  : snapshot.clientRunning === false
                    ? copy.cards.clientStopped
                    : copy.cards.clientUnknown}
              </p>
              <p className="vua-local-diag__secondary-fact">
                {format(copy.cards.logPrefix, {
                  status: copy.logs[snapshot.recentClientLog.classification],
                })}
              </p>
            </article>

            <article className="vua-local-diag__card" data-diag-card="cache">
              <div className="vua-local-diag__card-head">
                <h3>{copy.cards.cacheTitle}</h3>
                <Icon name="folder" size={20} />
              </div>
              <p className="vua-local-diag__primary-fact">
                {snapshot.clientCache.presence === "found"
                  ? format(copy.cards.cacheUsage, {
                      used: formatBytes(snapshot.clientCache.totalBytes),
                    })
                  : copy.cards.cacheMissing}
              </p>
              <p className="vua-local-diag__secondary-fact">
                {snapshot.clientConfig.cacheSizeGb !== null
                  || snapshot.clientConfig.cacheExpiryDelayDays !== null
                  ? format(copy.cards.cacheLimit, {
                      gb: snapshot.clientConfig.cacheSizeGb ?? 20,
                      days: snapshot.clientConfig.cacheExpiryDelayDays ?? 30,
                    })
                  : copy.cards.cacheDefaultLimit}
                {snapshot.clientCache.driveFreeBytes !== null
                  ? ` · ${format(copy.cards.driveFree, {
                      free: formatBytes(snapshot.clientCache.driveFreeBytes),
                    })}`
                  : ""}
              </p>
            </article>

            <article className="vua-local-diag__card" data-diag-card="osc">
              <div className="vua-local-diag__card-head">
                <h3>{copy.cards.oscTitle}</h3>
                <Icon name="signal" size={20} />
              </div>
              <p className="vua-local-diag__primary-fact">
                {format(copy.cards.oscPorts, {
                  p9000: formatPort(snapshot.osc.udp9000, copy.cards),
                  p9001: formatPort(snapshot.osc.udp9001, copy.cards),
                })}
              </p>
              <p className="vua-local-diag__secondary-fact">
                {snapshot.osc.avatarConfigCount > 0
                  ? format(copy.cards.oscAvatarCount, {
                      count: snapshot.osc.avatarConfigCount,
                      size: formatBytes(snapshot.osc.avatarCacheBytes),
                    })
                  : copy.cards.oscEmpty}
                {snapshot.osc.oscQuery.state === "found" && snapshot.osc.oscQuery.httpPort !== null
                  ? ` · ${format(copy.cards.oscQueryActive, {
                      http: snapshot.osc.oscQuery.httpPort,
                      osc: snapshot.osc.oscQuery.advertisedOscPort ?? copy.cards.streamingDefaultVal,
                    })}`
                  : ""}
              </p>
            </article>

            <article className="vua-local-diag__card" data-diag-card="steamvr">
              <div className="vua-local-diag__card-head">
                <h3>{copy.cards.steamvrTitle}</h3>
                <Icon name="computer" size={20} />
              </div>
              <p className="vua-local-diag__primary-fact">
                {snapshot.steamvrSettings.presence !== "found"
                  ? copy.cards.steamvrMissing
                  : snapshot.steamvrSettings.renderTargetMultiplier !== null
                    || snapshot.steamvrSettings.vrchatResolutionScale !== null
                    ? format(copy.cards.steamvrScale, {
                        ss: Math.round((snapshot.steamvrSettings.renderTargetMultiplier ?? 1) * 100),
                        app: Math.round((snapshot.steamvrSettings.vrchatResolutionScale ?? 1) * 100),
                      })
                    : copy.cards.steamvrScaleDefault}
              </p>
              <p className="vua-local-diag__secondary-fact">
                {snapshot.steamvrSettings.blockedDrivers.length > 0
                  ? format(copy.cards.steamvrSafeModeBlocked, {
                      drivers: snapshot.steamvrSettings.blockedDrivers.join(", "),
                    })
                  : copy.cards.steamvrClean}
              </p>
            </article>

            <article className="vua-local-diag__card" data-diag-card="audio">
              <div className="vua-local-diag__card-head">
                <h3>{copy.cards.audioTitle}</h3>
                <Icon name="mic" size={20} />
              </div>
              <p className="vua-local-diag__primary-fact">
                {copy.audioRoles[snapshot.audioEndpoints.defaultCaptureRole]}
              </p>
              <p className="vua-local-diag__secondary-fact">
                {snapshot.audioEndpoints.virtualMicHijack !== "none"
                  ? copy.audioHijack[snapshot.audioEndpoints.virtualMicHijack]
                  : snapshot.audioEndpoints.communicationsMismatch
                    ? copy.cards.audioCommMismatch
                    : copy.cards.audioClean}
              </p>
            </article>

            <article className="vua-local-diag__card" data-diag-card="streaming">
              <div className="vua-local-diag__card-head">
                <h3>{copy.cards.streamingTitle}</h3>
                <Icon name="signal" size={20} />
              </div>
              <p className="vua-local-diag__primary-fact">
                {snapshot.streamingSettings.questLink.presence === "found"
                  ? format(copy.cards.questLinkSummary, {
                      width: snapshot.streamingSettings.questLink.encodeResolutionWidth ?? copy.cards.streamingDefaultVal,
                      mbps: snapshot.streamingSettings.questLink.encodeBitrateMbps ?? copy.cards.streamingDefaultVal,
                    })
                  : snapshot.streamingSettings.picoConnect.presence === "found"
                    ? format(copy.cards.picoSummary, {
                        preset: snapshot.streamingSettings.picoConnect.preset ?? copy.cards.streamingDefaultVal,
                        mbps: snapshot.streamingSettings.picoConnect.bitrateMbps ?? copy.cards.streamingDefaultVal,
                      })
                    : copy.cards.streamingNone}
              </p>
              <p className="vua-local-diag__secondary-fact">
                {snapshot.streamingSettings.questLink.presence === "found"
                  && snapshot.streamingSettings.picoConnect.presence === "found"
                  ? format(copy.cards.picoSummary, {
                      preset: snapshot.streamingSettings.picoConnect.preset ?? copy.cards.streamingDefaultVal,
                      mbps: snapshot.streamingSettings.picoConnect.bitrateMbps ?? copy.cards.streamingDefaultVal,
                    })
                  : copy.cards.streamingSecondaryClean}
              </p>
            </article>

            <article className="vua-local-diag__card" data-diag-card="tuning">
              <div className="vua-local-diag__card-head">
                <h3>{copy.cards.tuningTitle}</h3>
                <Icon name="gauge" size={20} />
              </div>
              <p className="vua-local-diag__primary-fact">
                {snapshot.systemTuning.hardwareGpuScheduling === true
                  ? copy.cards.hagsOn
                  : snapshot.systemTuning.hardwareGpuScheduling === false
                    ? copy.cards.hagsOff
                    : copy.cards.hagsUnknown}
                {" · "}
                {copy.powerPlans[snapshot.systemTuning.powerPlanRole]}
              </p>
              <p className="vua-local-diag__secondary-fact">
                {snapshot.systemTuning.ovrAdvancedSettingsInstalled
                  ? copy.cards.ovrasInstalled
                  : copy.cards.ovrasNotInstalled}
              </p>
            </article>
          </section>

          <section className="vua-local-diag__section" aria-labelledby="local-diag-symptoms-heading">
            <h2 id="local-diag-symptoms-heading">{copy.symptomsSectionTitle}</h2>
            <p className="vua-local-diag__subtitle">{copy.symptomsSubtitle}</p>
            <div
              ref={symptomStripRef}
              className="vua-local-diag__symptoms"
              role="group"
              aria-label={copy.symptomsSectionTitle}
              onKeyDown={event => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
                const buttons = Array.from(symptomStripRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
                if (buttons.length === 0) return;
                const index = buttons.indexOf(event.target as HTMLButtonElement);
                if (index < 0) return;
                event.preventDefault();
                const nextIndex =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? buttons.length - 1
                      : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
                const nextSymptom = SYMPTOM_IDS_V01[nextIndex];
                buttons[nextIndex]?.focus();
                if (nextSymptom) void selectSymptom(nextSymptom);
              }}
            >
              {SYMPTOM_IDS_V01.map(symptom => (
                <Button
                  key={symptom}
                  className="vua-local-diag__symptom-btn"
                  aria-pressed={selectedSymptom === symptom}
                  data-nav-id={`symptom-${symptom}`}
                  onClick={() => void selectSymptom(symptom)}
                >
                  {copy.symptoms[symptom]}
                </Button>
              ))}
            </div>

            {diagnosing && !diagnosis ? (
              <p className="vua-local-diag__status" role="status" aria-live="polite">{copy.diagnosing}</p>
            ) : diagnosis ? (
              <div className="vua-local-diag__panel" data-symptom-diagnosis={diagnosis.symptom}>
                <div>
                  <h3>{copy.findingsTitle}</h3>
                  {diagnosis.findings.length === 0 ? (
                    <p className="vua-local-diag__status" role="status" aria-live="polite">{copy.findingsClean}</p>
                  ) : (
                    <ul className="vua-local-diag__findings">
                      {diagnosis.findings.map(finding => (
                        <li
                          key={finding.code}
                          className="vua-local-diag__finding"
                          data-severity={finding.severity}
                        >
                          <Icon
                            name={
                              finding.severity === "attention"
                                ? "error-circle"
                                : finding.severity === "warning"
                                  ? "warning"
                                  : "info"
                            }
                            size={20}
                          />
                          <span>{copy.findings[finding.code]}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h3>{copy.stepsTitle}</h3>
                  <ol className="vua-local-diag__steps">
                    {diagnosis.sopSteps.map(step => {
                      const localized = copy.sopSteps[step.stepId as keyof typeof copy.sopSteps];
                      const rawJump = navigate ? sopJumpForStep(step.stepId) : null;
                      const jump =
                        rawJump && (amf.installed || (rawJump.page !== "workshop" && rawJump.page !== "release"))
                          ? rawJump
                          : null;
                      return (
                        <li key={step.stepId} className="vua-local-diag__step">
                          <div className="vua-local-diag__step-head">
                            <strong>{localized ? localized.title : step.title}</strong>
                            <span className="vua-local-diag__layer-tag">
                              {copy.layers[step.layer]}
                            </span>
                          </div>
                          <p>{localized ? localized.instruction : step.instruction}</p>
                          {jump && navigate ? (
                            <div className="vua-local-diag__step-actions">
                              <Button
                                variant="subtle"
                                data-nav-id={`sop-jump-${step.stepId}`}
                                onClick={() => navigate(jump.page)}
                              >
                                {copy.sopActions[jump.labelKey]}
                                <Icon name="arrow-right" size={16} />
                              </Button>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                </div>
                {diagnosis.suggestedHelper !== "none" ? (
                  <div className="vua-local-diag__step-actions">
                    <Button
                      variant="subtle"
                      data-nav-id={`diag-suggested-helper-${diagnosis.suggestedHelper}`}
                      onClick={() => {
                        const selector =
                          diagnosis.suggestedHelper === "clear_osc_avatar_cache"
                            ? '[data-helper="osc-cache"]'
                            : '[data-helper="client-config"]';
                        const card = document.querySelector<HTMLElement>(selector);
                        card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                        card?.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled)")?.focus();
                      }}
                    >
                      {diagnosis.suggestedHelper === "clear_osc_avatar_cache"
                        ? copy.sopActions.jumpToOscHelper
                        : copy.sopActions.jumpToConfigHelper}
                      <Icon name="arrow-right" size={16} />
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="vua-local-diag__section" aria-labelledby="local-diag-helpers-heading">
            <h2 id="local-diag-helpers-heading">{copy.helpersTitle}</h2>
            <p className="vua-local-diag__subtitle">{copy.helpersSubtitle}</p>
            {!canRunOfflineHelpers ? (
              <p className="vua-local-diag__guard" role="status" data-offline-guard>
                {snapshot.clientRunning === true ? copy.helpersRunningGuard : copy.helpersUnknownGuard}
              </p>
            ) : null}

            <div className="vua-local-diag__helpers">
              <article className="vua-local-diag__helper" data-helper="osc-cache">
                <h3>{copy.oscHelperTitle}</h3>
                <p>{copy.oscHelperDesc}</p>
                <div>
                  <Button
                    data-nav-id="diagnostics-clear-osc"
                    disabled={!canRunOfflineHelpers || oscBusy}
                    onClick={() => void handleClearOscCache()}
                  >
                    {oscBusy ? copy.oscHelperBusy : copy.oscHelperButton}
                  </Button>
                </div>
                {oscFeedback ? <p className="vua-local-diag__status" role="status">{oscFeedback}</p> : null}
              </article>

              <article className="vua-local-diag__helper" data-helper="client-config">
                <h3>{copy.configHelperTitle}</h3>
                <p>{copy.configHelperDesc}</p>
                <div className="vua-local-diag__fields">
                  <div className="vua-local-diag__field">
                    <label htmlFor="diag-cache-size">{copy.configCacheSizeLabel}</label>
                    <input
                      id="diag-cache-size"
                      type="number"
                      min={1}
                      max={200}
                      disabled={!canRunOfflineHelpers || cfgBusy}
                      value={cacheSizeInput}
                      onChange={event => setCacheSizeInput(event.target.value)}
                    />
                  </div>
                  <div className="vua-local-diag__field">
                    <label htmlFor="diag-cache-expiry">{copy.configExpiryLabel}</label>
                    <input
                      id="diag-cache-expiry"
                      type="number"
                      min={1}
                      max={365}
                      disabled={!canRunOfflineHelpers || cfgBusy}
                      value={cacheExpiryInput}
                      onChange={event => setCacheExpiryInput(event.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <Button
                    variant="primary"
                    data-nav-id="diagnostics-save-config"
                    disabled={!canRunOfflineHelpers || cfgBusy}
                    onClick={() => void handleSaveClientConfig()}
                  >
                    {cfgBusy ? copy.configSaveBusy : copy.configSaveButton}
                  </Button>
                </div>
                {cfgFeedback ? <p className="vua-local-diag__status" role="status">{cfgFeedback}</p> : null}
              </article>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
