import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "../../components/primitives/Badge.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { Card } from "../../components/primitives/Card.tsx";
import { EmptyState } from "../../components/primitives/EmptyState.tsx";
import { Icon, type IconName } from "@vua/design-system";
import { format, strings, TERMS, termLabel } from "../../i18n/index.ts";
import type { PageId } from "../../app/nav-model.ts";
import {
  CURRENT_RECIPE_ID,
  useDataSource,
  useGateway,
  useWorkshopView,
} from "../../gateway/index.ts";
import {
  isTrackStage,
  segmentAfter,
  stageConclusion,
  type LogEntry,
  type SegmentKind,
  type StageId,
  type StageNode,
  type StageState,
  type WorkshopConclusionKind,
  type WorkshopView,
} from "./track-model.ts";
import { eventsForStage, formatTapeClock, tapeFrame } from "./workshop-replay.ts";
import { ProductionChainStatusSection } from "./ProductionChainStatusSection.tsx";
import "./workshop.css";

const copy = strings.workshop;

/**
 * 工厂车间(美术方案 v0.4.0 §7;C-WORKSHOP;proposal 029 A6 执行状态面,
 * 切片二 2026-09-22;设计标准 0.7.16 §8.5):车间只作状态显示——呈现当前
 * 执行链(production-use-case v0.2)的解析/计划/装配/记录状态(计划/执行/
 * 记录各卡如实驱动,任务进展以任务中心权威快照为准),不再承担配方驱动链
 * 的发起(发起面在配方页选中态,0.7.15 切片一);素材直产链发起位退出车间、
 * 落位仓储页(未决项 1 桌面落形,ProductionFlowSectionHost 由仓储页挂载)。
 *
 * 轨道只连接 Assembly → Production → Inspection,首尾为进料口 / 出货口端点。
 * 零件上车演出在流程冻结后投入(§13 排期纪律,本切片不做)。
 *
 * 色彩纪律(§7.3):车间不使用红绿灯语义;进行中/完成为 AMF 橙,
 * 琥珀仅检查点确认,红仅阻断。
 *
 * 视图三态:idle=诚实空态;running=实时事件流(联调接入);
 * replay=录制事件流回放(C-WORKSHOP)——节点点亮、日志与劳动计数全部
 * 由回放带事件驱动,可暂停/重播,回放内容带"演示数据"标识。
 *
 * 原则①:轨道状态与日志必须由真实/录制的工作流事件驱动;未接入时
 * 呈现诚实空态,不渲染虚构进度。
 */
const stateGlyph: Record<StageState, IconName | null> = {
  completed: "check",
  current: "arrow-right",
  pending: null,
  needsConfirmation: "warning",
  blocked: "close",
};

const conclusionGlyph: Record<WorkshopConclusionKind, IconName> = {
  running: "arrow-right",
  needsConfirmation: "warning",
  blocked: "close",
  completed: "check",
  notStarted: "clock",
};

/** 工位节点(S-IX-1):整站可点(节点+标签),选中后下方展开工位面板;
 * aria-pressed 表达选中态,视觉用 outline(不与 current 节点的辉光动画争 box-shadow) */
function StageNodeView({
  node,
  selected,
  onSelect,
}: {
  node: StageNode;
  selected: boolean;
  onSelect: () => void;
}) {
  const glyph = stateGlyph[node.state];
  return (
    <button
      type="button"
      className="vua-track__stage"
      data-state={node.state}
      data-selected={selected || undefined}
      aria-pressed={selected}
      aria-label={`${node.label}:${copy.stageState[node.state]}`}
      onClick={onSelect}
    >
      <span className="vua-track__node" aria-hidden="true">
        {glyph ? <Icon name={glyph} size={16} /> : null}
      </span>
      <span className="vua-track__label vua-caption">{node.label}</span>
    </button>
  );
}

function Segment({ kind, onTrack }: { kind: SegmentKind; onTrack: boolean }) {
  return (
    <span
      className={onTrack ? `vua-track__segment vua-track__segment--${kind}` : "vua-track__endpoint-link"}
      aria-hidden="true"
    />
  );
}

/** 阶段状态徽标色调(§7.3:不用红绿灯;红仅阻断,琥珀仅待确认) */
function stateBadgeTone(state: StageState): "neutral" | "error" | "warning" {
  if (state === "blocked") return "error";
  if (state === "needsConfirmation") return "warning";
  return "neutral";
}

/**
 * 工位面板(S-IX-1):选中工位的职责说明 + 状态 + 事件流。
 * events 为 null 表示实时模式(事件流未接入,诚实说明);
 * replay 模式传入截至当前播放时刻的该工位状态迁移序列。
 */
function StationPanel({
  stageId,
  label,
  state,
  events,
}: {
  stageId: StageId;
  label: string;
  state: StageState;
  events: ReadonlyArray<{ readonly at: number; readonly state: StageState }> | null;
}) {
  return (
    <Card className="vua-workshop__station">
      <div className="vua-workshop__station-head">
        <h2 className="vua-title">{copy.station.title}</h2>
        <span className="vua-workshop__station-name">{label}</span>
        <Badge tone={stateBadgeTone(state)}>
          {copy.station.currentState}:{copy.stageState[state]}
        </Badge>
      </div>
      <p className="vua-text-secondary">{copy.station.role[stageId]}</p>
      {events === null ? (
        <p className="vua-caption vua-text-secondary">{copy.station.livePendingNote}</p>
      ) : (
        <section>
          <h3 className="vua-caption vua-text-secondary">{copy.station.eventsTitle}</h3>
          {events.length === 0 ? (
            <p className="vua-caption vua-text-secondary">{copy.station.noEventsYet}</p>
          ) : (
            <ul className="vua-workshop__station-events">
              {events.map((event, index) => (
                <li key={index}>
                  <span className="vua-text-secondary">{formatTapeClock(event.at)}</span>
                  <Badge tone={stateBadgeTone(event.state)}>
                    {copy.stageState[event.state]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </Card>
  );
}

/**
 * 流水线条(S-IX-1):配方 → 车间 → 出厂的真实数据链卡。
 * 未接入的数据不渲染对应链卡(诚实降级),全空时整条不渲染;
 * 车间格为当前页,静态呈现不跳转。
 */
function PipelineStrip({
  recipeId,
  conclusion,
  latestRelease,
  onNavigate,
}: {
  recipeId: string | null;
  conclusion: WorkshopConclusionKind;
  latestRelease: { readonly id: string; readonly title: string } | null;
  onNavigate?: ((target: PageId) => void) | undefined;
}) {
  const cells: ReactNode[] = [];
  if (recipeId !== null) {
    cells.push(
      <button
        key="recipe"
        type="button"
        className="vua-workshop__pipeline-cell"
        onClick={() => onNavigate?.("recipe")}
      >
        <span className="vua-caption vua-text-secondary">{copy.pipeline.recipe}</span>
        <span className="vua-workshop__pipeline-value" title={recipeId}>
          {recipeId}
        </span>
      </button>,
    );
  }
  cells.push(
    <span
      key="workshop"
      className="vua-workshop__pipeline-cell vua-workshop__pipeline-cell--here"
    >
      <span className="vua-caption vua-text-secondary">{copy.pipeline.workshop}</span>
      <span className="vua-workshop__pipeline-value">{copy.conclusion[conclusion]}</span>
    </span>,
  );
  if (latestRelease !== null) {
    cells.push(
      <button
        key="release"
        type="button"
        className="vua-workshop__pipeline-cell"
        onClick={() => onNavigate?.("release")}
      >
        <span className="vua-caption vua-text-secondary">{copy.pipeline.release}</span>
        <span className="vua-workshop__pipeline-value" title={latestRelease.title}>
          {latestRelease.title}
        </span>
      </button>,
    );
  }
  if (cells.length === 1 && recipeId === null && latestRelease === null) return null;
  return (
    <div className="vua-workshop__pipeline" role="group" aria-label={copy.pipeline.aria}>
      {cells.flatMap((cell, index) =>
        index === 0
          ? [cell]
          : [
              <span
                key={`arrow-${index}`}
                className="vua-workshop__pipeline-arrow"
                aria-hidden="true"
              >
                <Icon name="arrow-right" size={16} />
              </span>,
              cell,
            ],
      )}
    </div>
  );
}

/** 英雄区:标题 + 状态结论(图标 + 文字双通道,WCAG 1.4.1)+ 演示徽标 */
function WorkshopHero({
  headline,
  conclusion,
  isFixture,
}: {
  headline: string;
  conclusion: WorkshopConclusionKind;
  isFixture: boolean;
}) {
  return (
    <section className="vua-workshop__hero">
      <h1 className="vua-title">
        {headline}
        {isFixture ? (
          <>
            {" "}
            <Badge tone="warning">{strings.common.fixtureBadge}</Badge>
          </>
        ) : null}
      </h1>
      <p className="vua-workshop__conclusion" data-kind={conclusion}>
        <Icon name={conclusionGlyph[conclusion]} size={16} />
        {copy.conclusion[conclusion]}
      </p>
      <p className="vua-text-secondary">{copy.runningSubtitle}</p>
    </section>
  );
}

/** 轨道卡 + 工位面板 + 日志卡(running 与 replay 共用同一呈现;回放仅多了控制条) */
function WorkshopBody({
  stages,
  log,
  operations,
  controls,
  selectedStage,
  onSelectStage,
  station,
}: {
  stages: readonly StageNode[];
  log: readonly LogEntry[];
  /** 可由日志核实的自动操作数(§7.2 劳动可视化);0 不渲染 */
  operations: number;
  controls?: ReactNode;
  /** 选中的工位(S-IX-1);null = 未选中,不渲染工位面板 */
  selectedStage: StageId | null;
  onSelectStage: (stage: StageId | null) => void;
  /** 工位面板内容(由调用方按模式装配:replay 给事件流,running 给诚实说明) */
  station?: ReactNode;
}) {
  return (
    <>
      <Card className="vua-workshop__track-card">
        <div
          className="vua-track"
          role="list"
          aria-label={format(copy.trackAria, { amf: TERMS.amf })}
        >
          {stages.map((stage, index) => (
            <div className="vua-track__item" role="listitem" key={stage.id}>
              {index > 0 ? (
                <Segment
                  kind={segmentAfter(stages[index - 1]?.state ?? "pending")}
                  onTrack={
                    isTrackStage(stages[index - 1]?.id ?? "warehouse") && isTrackStage(stage.id)
                  }
                />
              ) : null}
              <StageNodeView
                node={stage}
                selected={selectedStage === stage.id}
                onSelect={() =>
                  onSelectStage(selectedStage === stage.id ? null : stage.id)
                }
              />
            </div>
          ))}
        </div>
        <p className="vua-caption vua-text-secondary vua-workshop__track-hint">
          {format(copy.trackHint, {
            infeed: `${termLabel("warehouse")} / ${termLabel("recipe")}`,
            outfeed: termLabel("release"),
          })}
        </p>
        {operations > 0 ? (
          <p className="vua-caption vua-text-secondary vua-workshop__operations">
            {format(copy.replay.operationsLine, { count: operations })}
          </p>
        ) : null}
        {controls}
      </Card>

      {station}

      <Card className="vua-workshop__log">
        <h2 className="vua-title vua-workshop__log-title">{copy.logTitle}</h2>
        <ul className="vua-workshop__log-list">
          {log.map((entry, index) => (
            <li key={index}>
              <span className="vua-text-secondary">{entry.time}</span> {entry.text}
            </li>
          ))}
        </ul>
        <p className="vua-caption vua-text-secondary">{copy.logHint}</p>
      </Card>
    </>
  );
}

const REPLAY_TICK_MS = 100;

/**
 * 录制事件流回放:本地播放钟驱动 tapeFrame 纯函数;结论跟随当前帧;
 * 播到带尾自停;"减少动态效果"开启时默认不自动播放(静态帧切换,§9.2)。
 */
function ReplayWorkshop({
  view,
  isFixture,
  pipeline,
  statusSection,
  onNavigate,
}: {
  view: Extract<WorkshopView, { kind: "replay" }>;
  isFixture: boolean;
  /** 流水线条数据(S-IX-1);null = 尚未加载完成,先不渲染 */
  pipeline: { recipeId: string | null; latestRelease: { id: string; title: string } | null } | null;
  /** 执行状态面(029 A6):回放视图与 running/idle 同位挂载,事实同源 */
  statusSection: ReactNode;
  onNavigate?: ((target: PageId) => void) | undefined;
}) {
  const [positionMs, setPositionMs] = useState(0);
  const [playing, setPlaying] = useState(
    () =>
      typeof window.matchMedia !== "function" ||
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  // 工位选中(S-IX-1):再次点击同一工位取消选中
  const [selectedStage, setSelectedStage] = useState<StageId | null>(null);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setPositionMs((value) => Math.min(value + REPLAY_TICK_MS, view.tape.durationMs));
    }, REPLAY_TICK_MS);
    return () => clearInterval(timer);
  }, [playing, view.tape.durationMs]);

  const frame = tapeFrame(view.tape, positionMs, (id) => termLabel(id));
  useEffect(() => {
    if (frame.done) setPlaying(false);
  }, [frame.done]);

  const selectedNode =
    selectedStage === null
      ? null
      : (frame.stages.find((stage) => stage.id === selectedStage) ?? null);

  return (
    <div className="vua-workshop">
      <WorkshopHero
        headline={view.headline}
        conclusion={stageConclusion(frame.stages).kind}
        isFixture={isFixture}
      />
      {pipeline !== null ? (
        <PipelineStrip
          recipeId={pipeline.recipeId}
          conclusion={stageConclusion(frame.stages).kind}
          latestRelease={pipeline.latestRelease}
          onNavigate={onNavigate}
        />
      ) : null}
      {statusSection}
      <WorkshopBody
        stages={frame.stages}
        log={frame.log}
        operations={frame.operations}
        selectedStage={selectedStage}
        onSelectStage={setSelectedStage}
        station={
          selectedNode !== null ? (
            <StationPanel
              stageId={selectedNode.id}
              label={selectedNode.label}
              state={selectedNode.state}
              events={eventsForStage(view.tape, selectedNode.id).filter(
                (event) => event.at <= positionMs,
              )}
            />
          ) : undefined
        }
        controls={
          <div
            className="vua-workshop__replay"
            role="group"
            aria-label={copy.replay.controlsAria}
          >
            <Button variant="default" onClick={() => setPlaying((value) => !value)}>
              {playing ? copy.replay.pause : copy.replay.play}
            </Button>
            <Button
              variant="default"
              onClick={() => {
                setPositionMs(0);
                setPlaying(true);
              }}
            >
              {copy.replay.restart}
            </Button>
            <span
              className="vua-workshop__replay-progress"
              role="progressbar"
              aria-label={format(copy.replay.progressAria, {
                position: formatTapeClock(positionMs),
                duration: formatTapeClock(view.tape.durationMs),
              })}
              aria-valuemin={0}
              aria-valuemax={view.tape.durationMs}
              aria-valuenow={positionMs}
            >
              <span
                className="vua-workshop__replay-progress-fill"
                style={{
                  width: `${Math.min(100, (positionMs / view.tape.durationMs) * 100)}%`,
                }}
              />
            </span>
            <span className="vua-caption vua-text-secondary" aria-hidden="true">
              {formatTapeClock(positionMs)} / {formatTapeClock(view.tape.durationMs)}
            </span>
          </div>
        }
      />
    </div>
  );
}

export function WorkshopPage({
  envReady = true,
  onPrepareEnv,
  onNavigate,
}: {
  /** 生产环境是否就绪;未就绪时显示诚实阻断态(v0.3.3 §2.1,不自动切页) */
  envReady?: boolean;
  /** "前往准备生产环境"按钮回调:用户点击后才跳转环境部署 */
  onPrepareEnv?: () => void;
  /** 流水线链卡跳转(S-IX-1):由壳层注入页面导航 */
  onNavigate?: ((target: PageId) => void) | undefined;
}) {
  const view = useWorkshopView();
  const isFixture = useDataSource() === "fixture";
  const gateway = useGateway();
  // 工位选中(running 视图;replay 视图自管选中态)
  const [selectedStage, setSelectedStage] = useState<StageId | null>(null);
  // 流水线条(S-IX-1):配方与出厂取自真实 gateway;失败/未接入的格不渲染
  const [pipeline, setPipeline] = useState<{
    recipeId: string | null;
    latestRelease: { id: string; title: string } | null;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all([
      gateway.modelProduction.recipeGraph(CURRENT_RECIPE_ID).catch(() => null),
      gateway.modelProduction.releaseWall().catch(() => null),
    ]).then(([graph, wall]) => {
      if (!alive) return;
      const recipeId = graph?.kind === "graph" ? graph.recipeId : null;
      const projects = wall?.kind === "wall" ? wall.projects : [];
      const latest = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      setPipeline({
        recipeId,
        latestRelease: latest ? { id: latest.id, title: latest.title } : null,
      });
    });
    return () => {
      alive = false;
    };
  }, [gateway]);

  // 执行状态面(029 A6):计划/执行/记录各卡如实驱动;零发起动作——
  // 发起面在配方页选中态(0.7.15 切片一),素材直产链发起位在仓储页
  const statusSection = <ProductionChainStatusSection onNavigate={onNavigate} />;

  if (!envReady) {
    return (
      <div className="vua-workshop">
        <section className="vua-workshop__hero">
          <h1 className="vua-title">{copy.title}</h1>
          <p className="vua-text-secondary">{copy.subtitle}</p>
        </section>
        <Card>
          <div className="vua-page__stack">
            <h2 className="vua-title">{copy.blocked.title}</h2>
            <p className="vua-text-secondary">{copy.blocked.description}</p>
            <div>
              <Button variant="primary" onClick={onPrepareEnv}>
                {copy.blocked.cta}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (view.kind === "idle") {
    return (
      <div className="vua-workshop">
        <section className="vua-workshop__hero">
          <h1 className="vua-title">{copy.title}</h1>
          <p className="vua-text-secondary">{copy.subtitle}</p>
        </section>
        {statusSection}
        <Card>
          <EmptyState
            title={copy.idleTitle}
            description={format(copy.idleDescription, { recipe: termLabel("recipe") })}
          />
        </Card>
      </div>
    );
  }

  if (view.kind === "replay") {
    return (
      <ReplayWorkshop
        view={view}
        isFixture={isFixture}
        pipeline={pipeline}
        statusSection={statusSection}
        onNavigate={onNavigate}
      />
    );
  }

  const selectedNode =
    selectedStage === null
      ? null
      : (view.stages.find((stage) => stage.id === selectedStage) ?? null);

  return (
    <div className="vua-workshop">
      <WorkshopHero
        headline={view.headline}
        conclusion={stageConclusion(view.stages).kind}
        isFixture={isFixture}
      />
      {pipeline !== null ? (
        <PipelineStrip
          recipeId={pipeline.recipeId}
          conclusion={stageConclusion(view.stages).kind}
          latestRelease={pipeline.latestRelease}
          onNavigate={onNavigate}
        />
      ) : null}
      {statusSection}
      <WorkshopBody
        stages={view.stages}
        log={view.log}
        operations={0}
        selectedStage={selectedStage}
        onSelectStage={setSelectedStage}
        station={
          selectedNode !== null ? (
            <StationPanel
              stageId={selectedNode.id}
              label={selectedNode.label}
              state={selectedNode.state}
              events={null}
            />
          ) : undefined
        }
      />
    </div>
  );
}
