import { DeploymentPanel } from "./DeploymentPanel.tsx";
import { NetworkPanel } from "./NetworkPanel.tsx";
import { formatDateTime } from "../../i18n/index.ts";
import { useEffect, useState } from "react";
import { useMinBusyValue } from "../../app/busy-timing.ts";
import { openExternalUrl } from "../../app/open-external.ts";
import { Badge } from "../../components/primitives/Badge.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { Card } from "../../components/primitives/Card.tsx";
import { EmptyState } from "../../components/primitives/EmptyState.tsx";
import { StatusLight } from "../../components/primitives/StatusLight.tsx";
import { format, strings } from "../../i18n/index.ts";
import { useDataSource, useEnvironmentView, useGateway } from "../../gateway/index.ts";
import { summarizeGroup, summarizeHealth, zoneSummaryItems, type CheckItem, type CheckZone } from "./deployer-model.ts";
import { canAdvanceStep, type FixPlanV1 } from "./fix-plan-model.ts";
import { GuideEntryButton } from "../guide/GuideEntryButton.tsx";
import { guideTargetForCheckId } from "../guide/guide-target.ts";
import { VersionPanel } from "./VersionPanel.tsx";
import "./deployer.css";

const copy = strings.deployer;

/**
 * 渲染条目:独立检查项原样成卡;替代组(CHECK_GROUPS)成员合并为一张组卡,
 * 位置取组内首个成员处,顺序保持稳定(不重新排序,如实反映检测输出)。
 */
type DisplayEntry =
  | { kind: "item"; item: CheckItem }
  | { kind: "group"; groupId: string; members: CheckItem[] };

function toDisplayEntries(items: readonly CheckItem[]): DisplayEntry[] {
  const entries: DisplayEntry[] = [];
  const groupAt = new Map<string, number>();
  for (const item of items) {
    if (item.groupId === undefined) {
      entries.push({ kind: "item", item });
      continue;
    }
    const at = groupAt.get(item.groupId);
    if (at === undefined) {
      groupAt.set(item.groupId, entries.length);
      entries.push({ kind: "group", groupId: item.groupId, members: [item] });
    } else {
      const entry = entries[at];
      if (entry?.kind === "group") entry.members.push(item);
    }
  }
  return entries;
}

/** 修复计划流的页面本地状态:confirm = 计划确认;executing = 引导执行 */
type PlanState =
  | { kind: "confirm"; plan: FixPlanV1 }
  | { kind: "executing"; plan: FixPlanV1; stepIndex: number; candidate: string | null };

/**
 * 部署器(美术方案 v0.3.3 §4),按辖区拆为游玩环境 / 生产环境两页(§2.1)。
 * 参考系:Windows 安全中心首页——英雄区状态结论 + 红绿灯状态卡片。
 * 色彩纪律:红绿灯语义仅部署器辖区(§2.4/§3.3),品牌色只用于主按钮与选中态。
 *
 * 原则①:检查结论必须来自真实数据;真实检测器未接入时(not-run)
 * 呈现诚实空态,绝不展示虚构的"已就绪"结论。
 *
 * 动作纪律(environment-port 契约):检测/修复是端口意图,入口按钮只在
 * capability = ready 时出现(不出现,而非禁用);修复意图端口未接入前,
 * 单项 fixLabel 只以文本呈现动作建议,不渲染可点击外观;检测动作
 * 只有 runCheck(开始/重新检测),"一键修复/进入下一步"入口待修复
 * 意图接入后恢复。
 *
 * 状态机(C-ENV):每辖区独立 not-run → running → results / failed;
 * running/failed 携带的旧证据(last)只以"时间戳 + 仅供参考"呈现,
 * 不升级为当前结论;running 态不提供重复触发入口,也无假进度条。
 *
 * 目标门控(v0.3.3 §2.2/§4.1):未选择环境部署目标(goal-off)或本辖区
 * 未纳入目标(env-off)时显示中性说明,不显示健康结论、不激活英雄区;
 * "选择环境目标"按钮跳往设置的目标重选页,不自动开始检测。
 *
 * 取数(G3):视图经 Gateway 环境端口注入(useEnvironmentView),
 * "演示数据"徽标由 dataSource 驱动,页面不感知 fixture / live 实现差异。
 */
/** Keep the network panel mounted when software inspection changes phase. */
export function DeployerPage(props: { zone: CheckZone; goal?: "active" | "goal-off" | "env-off"; onChooseGoals?: () => void }) {
  return <>
    {props.zone === "play" && (props.goal ?? "active") === "active" ? <NetworkPanel /> : null}
    <EnvironmentChecks {...props} />
  </>;
}

function EnvironmentChecks({
  zone,
  goal = "active",
  onChooseGoals,
}: {
  zone: CheckZone;
  /** 目标门控态:goal-off = 未选环境部署;env-off = 本辖区未纳入目标 */
  goal?: "active" | "goal-off" | "env-off";
  onChooseGoals?: () => void;
}) {
  const environmentView = useEnvironmentView();
  const view = environmentView.deployer;
  const phase = view.zones[zone];
  // 版本轨道(S-XV):与检测相位无关的事实表面;版本源未接入(空数组)时整块不出现
  const versionTracks = environmentView.versions[zone];
  const isFixture = useDataSource() === "fixture";
  const gateway = useGateway();
  const zoneCopy = copy.zones[zone];
  // 检测能力门控:capability 查询失败按不可用处理(入口不出现,而非禁用)
  const [checkReady, setCheckReady] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void gateway.environment
      .capability()
      .then((report) => {
        if (alive) setCheckReady(report.state === "ready");
      })
      .catch(() => {
        /* 能力查询失败:保持不可用态 */
      });
    return () => {
      alive = false;
    };
  }, [gateway]);

  const runCheck = () => {
    setCheckFailed(false);
    void gateway.environment.runCheck(zone).catch(() => setCheckFailed(true));
  };

  // 修复计划流(C-ENV):planFix 生成版本化计划 → 用户确认 → 引导执行 → 重检。
  // 执行只记录用户确认;结论只能由重检改变(原则①)
  const [planState, setPlanState] = useState<PlanState | null>(null);
  const [planLoading, setPlanLoading] = useState<string | null>(null);
  // 最小忙碌(S-XIV-4):planFix 亚帧返回时加载提示仍挂满 700ms,防"没点中"感
  const planBusyId = useMinBusyValue(planLoading);
  const [planError, setPlanError] = useState<string | null>(null);
  const [linkFailed, setLinkFailed] = useState(false);

  const startFix = (checkId: string) => {
    setPlanLoading(checkId);
    setPlanError(null);
    setPlanState(null);
    void gateway.environment
      .planFix(checkId)
      .then((result) => {
        setPlanLoading(null);
        if (result.kind === "ok") {
          setPlanState({ kind: "confirm", plan: result.plan });
        } else {
          setPlanError(
            result.kind === "unknown-check" ? copy.fix.unknownCheck : copy.fix.unavailable,
          );
        }
      })
      .catch(() => {
        setPlanLoading(null);
        setPlanError(copy.fix.loadFailed);
      });
  };

  /** 推进当前步骤:候选确认步须先选定候选;重检步触发 runCheck 并关闭计划卡 */
  const advancePlanStep = () => {
    if (planState?.kind !== "executing") return;
    const step = planState.plan.steps[planState.stepIndex];
    if (!step || !canAdvanceStep(step, planState.candidate)) return;
    if (step.kind === "recheck") {
      setPlanState(null);
      runCheck();
      return;
    }
    setLinkFailed(false);
    setPlanState({ ...planState, stepIndex: planState.stepIndex + 1, candidate: null });
  };

  if (goal !== "active") {
    const goalCopy = goal === "goal-off" ? copy.goalOff : copy.envOff;
    const description =
      goal === "env-off"
        ? format(goalCopy.description, {
            other: copy.zones[zone === "play" ? "create" : "play"].title,
            zone: zoneCopy.title,
          })
        : goalCopy.description;
    return (
      <div className="vua-deployer">
        <Card>
          <EmptyState
            title={goalCopy.title}
            description={description}
            action={
              <Button variant="primary" onClick={onChooseGoals}>
                {goalCopy.cta}
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  if (phase.kind === "not-run") {
    return (
      <div className="vua-deployer">
        <Card className="vua-deployer__hero" data-status="unknown">
          <StatusLight level="unknown" size="lg" />
          <div className="vua-deployer__conclusion">
            <h1 className="vua-display">{copy.page.notRunTitle}</h1>
            <p className="vua-text-secondary">
              {format(copy.page.notRunDescription, { zone: zoneCopy.title })}
            </p>
          </div>
          <div className="vua-deployer__cta">
            {/* 契约:能力不可用时入口不出现(而非禁用),只留里程碑说明 */}
            {checkReady ? (
              <Button variant="primary" onClick={runCheck}>
                {copy.page.notRunCta}
              </Button>
            ) : (
              <span className="vua-caption vua-text-secondary">{copy.page.notRunCtaHint}</span>
            )}
            {checkFailed ? (
              <span className="vua-caption vua-text-secondary">{copy.page.checkFailed}</span>
            ) : null}
          </div>
        </Card>
        <Card>
          <EmptyState
            title={copy.page.emptyTitle}
            description={zoneCopy.emptyDescription}
          />
        </Card>
        {versionTracks.length > 0 ? <VersionPanel tracks={versionTracks} /> : null}
      </div>
    );
  }

  // 证据:results 是当前证据;running/failed 的 last 是旧证据,仅供参考
  const evidence = phase.kind === "results" ? phase : phase.last;
  const evidenceTime =
    evidence !== null ? formatDateTime(evidence.checkedAt) : null;
  // The dedicated HTTPS panel replaces the legacy TCP card in the live play view.
  // Keep its frozen wire facts intact for other consumers and historical fixtures.
  const items = (evidence?.items ?? []).filter(item => !(zone === "play" && gateway.environment.network && item.id === "network"));
  // 摘要计数口径(2026-09-20 用户裁决,与生产门同源):创作辖区只数门内项
  // (Unity 编辑器是唯一硬前置);信息性展示项卡照常逐张呈现,不进「还差
  // N 项准备」计数与总览灯。游玩辖区全量计入。
  const summary = summarizeHealth(zoneSummaryItems(zone, items));
  const headline =
    summary.headlineKey === "ready"
      ? zoneCopy.readyHeadline
      : summary.headlineKey === "empty"
        ? copy.summary.empty
        : format(copy.summary.pending, summary.headlineParams);

  return (
    <div className="vua-deployer">
      {phase.kind === "running" ? (
        <Card className="vua-deployer__hero" data-status="unknown">
          <StatusLight level="unknown" size="lg" />
          <div className="vua-deployer__conclusion">
            <h1 className="vua-display">
              {format(copy.page.runningTitle, { zone: zoneCopy.title })}
            </h1>
            <p className="vua-text-secondary">{copy.page.runningDescription}</p>
          </div>
          {/* 检测中不提供重复触发入口;不放假进度条(v0.4.0 §2.5) */}
        </Card>
      ) : phase.kind === "failed" ? (
        <Card className="vua-deployer__hero" data-status="error">
          <StatusLight level="error" size="lg" />
          <div className="vua-deployer__conclusion">
            <h1 className="vua-display">{copy.page.failedTitle}</h1>
            <p className="vua-text-secondary">{copy.page.failedDescription}</p>
          </div>
          <div className="vua-deployer__cta">
            {checkReady ? (
              <Button variant="primary" onClick={runCheck}>
                {copy.page.failedRetry}
              </Button>
            ) : (
              <span className="vua-caption vua-text-secondary">{copy.page.notRunCtaHint}</span>
            )}
            {checkFailed ? (
              <span className="vua-caption vua-text-secondary">{copy.page.checkFailed}</span>
            ) : null}
          </div>
        </Card>
      ) : (
        <Card className="vua-deployer__hero" data-status={summary.overall}>
          <StatusLight level={summary.overall} size="lg" />
          <div className="vua-deployer__conclusion">
            <h1 className="vua-display">
              {headline}
              {isFixture ? (
                <>
                  {" "}
                  <Badge tone="warning">{strings.common.fixtureBadge}</Badge>
                </>
              ) : null}
            </h1>
            <p className="vua-text-secondary">
              {summary.headlineKey === "empty"
                ? copy.summary.emptyDescription
                : summary.ready
                  ? format(zoneCopy.readyDescription, { zone: zoneCopy.title })
                  : zoneCopy.pendingDescription}
            </p>
            {evidenceTime !== null ? (
              <p className="vua-caption vua-text-secondary">
                {format(copy.page.evidenceNote, { time: evidenceTime })}
              </p>
            ) : null}
          </div>
          {/* 空列表或检测能力不可用时没有可执行动作,不显示主按钮,避免虚构修复入口;
              能力可用时唯一真实动作是 runCheck(重新检测) */}
          {summary.headlineKey === "empty" || !checkReady ? null : (
            <Button variant="primary" onClick={runCheck}>
              {copy.summary.ctaRecheck}
            </Button>
          )}
          {checkFailed ? (
            <p className="vua-caption vua-text-secondary">{copy.page.checkFailed}</p>
          ) : null}
        </Card>
      )}

      {checkReady && goal === "active" ? <DeploymentPanel key={zone} zone={zone} /> : null}
      {planError !== null ? (
        <p className="vua-caption vua-text-secondary">{planError}</p>
      ) : null}

      {/* 修复计划卡:计划确认 → 引导执行;同一时刻只有一张计划 */}
      {planState !== null ? (
        <FixPlanCard
          state={planState}
          linkFailed={linkFailed}
          onOpenLink={(url) => {
            setLinkFailed(false);
            void openExternalUrl(url).then((ok) => {
              if (!ok) setLinkFailed(true);
            });
          }}
          onStart={() =>
            setPlanState({ kind: "executing", plan: planState.plan, stepIndex: 0, candidate: null })
          }
          onSelectCandidate={(candidate) =>
            planState.kind === "executing" ? setPlanState({ ...planState, candidate }) : null
          }
          onAdvance={advancePlanStep}
          onCancel={() => setPlanState(null)}
        />
      ) : null}

      {/* 旧证据(running/failed 的 last):仅供参考,时间戳 + 演示数据徽标如实标注 */}
      {phase.kind !== "results" && evidenceTime !== null ? (
        <p className="vua-caption vua-text-secondary">
          {format(copy.page.staleNote, { time: evidenceTime })}
          {isFixture ? (
            <>
              {" "}
              <Badge tone="warning">{strings.common.fixtureBadge}</Badge>
            </>
          ) : null}
        </p>
      ) : null}

      <div className="vua-deployer__grid">
        {toDisplayEntries(items).map((entry) =>
          entry.kind === "group" ? (
            <RuntimeGroupCard
              key={entry.groupId}
              groupId={entry.groupId}
              members={entry.members}
            />
          ) : (
          <Card key={entry.item.id} className="vua-deployer__item" data-status={entry.item.status}>
            <header className="vua-deployer__item-header">
              <StatusLight level={entry.item.status} />
              <h2 className="vua-deployer__item-title">{entry.item.title}</h2>
            </header>
            <p className="vua-deployer__item-desc vua-text-secondary">{entry.item.description}</p>
            {/* 修复入口:能力可用时渲染真实按钮(planFix);不可用时动作建议
                只以文本呈现,不渲染可点击外观(environment-port 契约) */}
            {entry.item.fixLabel ? (
              checkReady ? (
                <>
                  <Button
                    variant={entry.item.status === "error" ? "primary" : "subtle"}
                    disabled={planBusyId === entry.item.id}
                    onClick={() => startFix(entry.item.id)}
                  >
                    {entry.item.fixLabel}
                  </Button>
                  {planBusyId === entry.item.id ? (
                    <p className="vua-caption vua-text-secondary">{copy.fix.loading}</p>
                  ) : null}
                </>
              ) : (
                <p className="vua-caption vua-text-secondary">{entry.item.fixLabel}</p>
              )
            ) : null}
            {/* 「查看操作指南」入口(首玩 B 切片):检查项有定位映射时出现;
                指南是静态内容,不经 capability 门控 */}
            <GuideEntryButton target={guideTargetForCheckId(entry.item.id)} label={copy.guideCta} />
          </Card>
          ),
        )}
      </div>
      {versionTracks.length > 0 ? <VersionPanel tracks={versionTracks} /> : null}
    </div>
  );
}

/* ---- 替代组卡(CHECK_GROUPS)---- */

/**
 * 替代组卡:整组一张卡(组级状态灯 + "任选其一"徽标 + 组结论),
 * 成员逐行如实列出各自在场事实(已检测到/可选/检测失败)。
 * 组文案注册表未收录的 groupId 如实透传 id(与 checkTitle 同一纪律),
 * 不虚构组标题。
 */
function RuntimeGroupCard({
  groupId,
  members,
}: {
  groupId: string;
  members: CheckItem[];
}) {
  const verdict = summarizeGroup(members);
  const groupCopy = (copy.groups as Readonly<Record<string, typeof copy.groups["vr_runtime"]>>)[
    groupId
  ];
  const detectedCount = members.filter((member) => member.status === "ok").length;
  const description =
    groupCopy === undefined
      ? undefined
      : verdict === "ok"
        ? format(groupCopy.satisfied, { count: detectedCount })
        : groupCopy.unsatisfied;
  return (
    <Card className="vua-deployer__item vua-deployer__group" data-status={verdict}>
      <header className="vua-deployer__item-header">
        <StatusLight level={verdict} />
        <h2 className="vua-deployer__item-title">{groupCopy?.title ?? groupId}</h2>
        {groupCopy !== undefined ? <Badge tone="neutral">{groupCopy.badge}</Badge> : null}
      </header>
      {description !== undefined ? (
        <p className="vua-deployer__item-desc vua-text-secondary">{description}</p>
      ) : null}
      <ul className="vua-deployer__group-members">
        {members.map((member) => (
          <li key={member.id} data-status={member.status}>
            <StatusLight level={member.status} />
            <span className="vua-deployer__group-member-title">{member.title}</span>
            <span className="vua-caption vua-text-secondary">{member.description}</span>
            <GuideEntryButton target={guideTargetForCheckId(member.id)} label={copy.guideCta} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ---- 修复计划卡(C-ENV)---- */

/**
 * 修复计划卡:计划确认(步骤与影响范围明示)→ 引导执行(当前步骤动作区)。
 * 步骤文案全部来自版本化负载(FixPlanV1),本组件只负责呈现与推进;
 * 候选确认步未选定候选时"确认并继续"禁用(Issue #4:不替用户猜测)。
 */
function FixPlanCard({
  state,
  linkFailed,
  onOpenLink,
  onStart,
  onSelectCandidate,
  onAdvance,
  onCancel,
}: {
  state: PlanState;
  linkFailed: boolean;
  onOpenLink: (url: string) => void;
  onStart: () => void;
  onSelectCandidate: (candidate: string) => void;
  onAdvance: () => void;
  onCancel: () => void;
}) {
  const { plan } = state;
  const stepIndex = state.kind === "executing" ? state.stepIndex : -1;
  const currentStep =
    state.kind === "executing" ? plan.steps[state.stepIndex] : undefined;
  return (
    <Card>
      <div className="vua-page__stack">
        <h2 className="vua-deployer__item-title">{plan.title}</h2>
        <div>
          <h3 className="vua-caption vua-text-secondary">{copy.fix.impactTitle}</h3>
          <p className="vua-caption vua-text-secondary">{plan.impact}</p>
        </div>
        <div>
          <h3 className="vua-caption vua-text-secondary">{copy.fix.stepsTitle}</h3>
          <ol className="vua-deployer__plan-steps">
            {plan.steps.map((step, index) => {
              const stepState =
                stepIndex < 0
                  ? "pending"
                  : index < stepIndex
                    ? "done"
                    : index === stepIndex
                      ? "current"
                      : "pending";
              return (
                <li
                  key={step.id}
                  data-state={stepState}
                  aria-current={stepState === "current" ? "step" : undefined}
                >
                  <span className="vua-deployer__plan-step-title">{step.title}</span>
                  {step.description !== "" ? (
                    <span className="vua-caption vua-text-secondary">{step.description}</span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
        {state.kind === "confirm" ? (
          <div className="vua-deployer__cta-row">
            <Button variant="primary" onClick={onStart}>
              {copy.fix.confirmStart}
            </Button>
            <Button variant="subtle" onClick={onCancel}>
              {copy.fix.cancel}
            </Button>
          </div>
        ) : currentStep ? (
          <div className="vua-deployer__cta-row">
            {currentStep.kind === "confirm-candidate" ? (
              <>
                {currentStep.candidates.map((candidate) => (
                  <Button
                    key={candidate}
                    variant={state.candidate === candidate ? "primary" : "default"}
                    aria-pressed={state.candidate === candidate}
                    onClick={() => onSelectCandidate(candidate)}
                  >
                    {candidate}
                  </Button>
                ))}
                <Button
                  variant="primary"
                  disabled={!canAdvanceStep(currentStep, state.candidate)}
                  onClick={onAdvance}
                >
                  {copy.fix.confirmCandidate}
                </Button>
              </>
            ) : currentStep.kind === "external-link" ? (
              <>
                <Button variant="default" onClick={() => onOpenLink(currentStep.url)}>
                  {copy.fix.openPage}
                </Button>
                <Button variant="primary" onClick={onAdvance}>
                  {copy.fix.stepDone}
                </Button>
              </>
            ) : currentStep.kind === "manual" ? (
              <Button variant="primary" onClick={onAdvance}>
                {copy.fix.stepDone}
              </Button>
            ) : (
              <Button variant="primary" onClick={onAdvance}>
                {copy.fix.recheckNow}
              </Button>
            )}
            <Button variant="subtle" onClick={onCancel}>
              {copy.fix.cancel}
            </Button>
            {linkFailed ? (
              <span className="vua-caption vua-text-secondary">{copy.fix.openPageFailed}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
