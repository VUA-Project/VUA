/**
 * Overlay 双表面表现模型(v2,017 表面批 1 wire 消费;设计规范 §8.8):
 * 快照 + 输入形态 → 视图 props 的纯函数;无 IO、无文案字面量(文案 key 由
 * 本模型给出,字符串在 i18n 四表,枚举键与 TS 联合一一对应,测试约束)。
 *
 * v2 与 v1 的差异:事实面 = overlay.getSnapshot 冻结投影(任务卡列表＋生产
 * 状态卡;017 批 2 起下载/导入进度卡可选增量)。tone/状态概括由本模型从冻
 * 结词表事实推导(呈现映射,非跨源推导):词表用 @vua/contracts 导出的九态/
 * 五态冻结常量判断,词表外值原样透传显示、不参与推导(不猜测)。下载卡呈现
 * 策略 = 有进行中项时呈现(017 表态 3),缺席/空集一律不呈现;其 tone/标题
 * 推导以任务面为准(下载尝试行本身在任务面内,推导已覆盖)。环境摘要恒缺席
 * (批 2 未投影),取消动作可见性只按冻结终态词表判断,守卫在服务权威侧
 * (017 §3)。
 *
 * 色彩纪律(§8.8 + §7.3 延伸,Overlay 不用红绿灯):
 * - accent(辖区色,Overlay 属 VUA 紫)= 进行中;
 * - amber(琥珀)= 等待用户确认/处理;
 * - error(红)= 仅阻断/失败;
 * - neutral = 无活动/已结束(取消是用户主动结束,非阻断)。
 *
 * 形态差异(桌面=键鼠,VR=激光点按):
 * - open_on_desktop 只在 VR 表面出现(桌面窗口自身即落点,同教程表面纪律);
 * - request_cancel_task:有非终态任务卡时呈现(每卡一个取消目标);
 * - 主操作每表面至多一个:桌面 = dismiss,VR = open_on_desktop。
 */
import {
  TERMINAL_TASK_STATES_V01,
  type OverlayDownloadCardV01,
  type OverlayProductionCardV01,
  type OverlayTaskCardV01,
} from "@vua/contracts";
import type {
  OverlayAction,
  OverlaySnapshot,
  OverlayStatusTone,
} from "./overlay-contract.ts";

export type OverlayInputMode = "desktop" | "vr";

export type OverlayVisualTone = "neutral" | "accent" | "amber" | "error";

export type OverlayViewState = "inactive" | "ready";

/** 状态概括文案键(strings.overlay.statusTitles 一一对应) */
export type OverlayStatusTitleKey = "active" | "recent" | "idle";

export const overlayStatusTitleKeys: readonly OverlayStatusTitleKey[] = [
  "active",
  "recent",
  "idle",
];

/** 任务卡视图:state 文案在九态词表内取 strings.taskStatus,词表外原词透传 */
export interface OverlayTaskCardView {
  readonly taskId: string;
  readonly stateLabel: string;
  readonly stateRaw: string;
  /** 非终态 = 取消动作目标(冻结终态词表判断;守卫仍在服务权威侧) */
  readonly cancellable: boolean;
}

/** 生产状态卡视图(planStatus 五态/记录 status 词表内取文案,词表外原词) */
export interface OverlayProductionCardView {
  readonly currentPlan: {
    readonly planId: string;
    readonly statusLabel: string;
    readonly createdAt: string;
    readonly recipeId: string;
  } | null;
  readonly latestRecord: {
    readonly buildId: string;
    readonly planId: string;
    readonly statusLabel: string;
    readonly finishedAt: string;
  } | null;
}

/** 下载/导入进度卡视图(017 批 2):行字段裁剪原样透传——downloadId/state/
 *  updatedAt,无字节进度(进度在任务事件通道,快照不发明);state 文案由
 *  表面按任务九态同表映射,词表外原词透传 */
export interface OverlayDownloadCardView {
  readonly activeDownloads: readonly {
    readonly downloadId: string;
    readonly stateLabel: string;
    readonly stateRaw: string;
    readonly updatedAt: string;
  }[];
}

export interface OverlayActionView {
  readonly action: OverlayAction;
  readonly visible: boolean;
  readonly primary: boolean;
}

export interface OverlayViewModel {
  readonly state: OverlayViewState;
  readonly tone: OverlayVisualTone;
  readonly statusTone: OverlayStatusTone;
  readonly statusTitleKey: OverlayStatusTitleKey;
  readonly taskCards: readonly OverlayTaskCardView[];
  readonly productionCard: OverlayProductionCardView;
  /** 下载/导入进度卡:null = 不呈现(字段缺席〔批 1 世代快照〕或空集〔诚实
   *  空卡〕——呈现策略「有进行中项时呈现」,017 表态 3/批 2 交付节) */
  readonly downloadCard: OverlayDownloadCardView | null;
  readonly actions: readonly OverlayActionView[];
  readonly textScale: number;
  readonly reducedMotion: boolean;
}

const TERMINAL_STATES: readonly string[] = TERMINAL_TASK_STATES_V01;

/** 冻结九态词表内 = 终态判断可信;词表外值既非可取消也非已结束(未知) */
function isKnownTerminal(state: string): boolean {
  return TERMINAL_STATES.includes(state);
}

/** status.title → 视觉基调(v2 由事实推导后落入四基调;switch 穷尽) */
export function toneForStatus(tone: OverlayStatusTone): OverlayVisualTone {
  switch (tone) {
    case "inactive":
      return "neutral";
    case "active":
      return "accent";
    case "waiting":
      return "amber";
    case "blocked":
      return "error";
  }
}

function projectTaskCard(card: OverlayTaskCardV01): OverlayTaskCardView {
  return {
    taskId: card.taskId,
    stateLabel: card.state,
    stateRaw: card.state,
    cancellable: !isKnownTerminal(card.state),
  };
}

function projectProductionCard(card: OverlayProductionCardV01): OverlayProductionCardView {
  return {
    currentPlan: card.currentPlan === null
      ? null
      : {
          planId: card.currentPlan.planId,
          statusLabel: card.currentPlan.planStatus,
          createdAt: card.currentPlan.createdAt,
          recipeId: card.currentPlan.recipeId,
        },
    latestRecord: card.latestRecord === null
      ? null
      : {
          buildId: card.latestRecord.buildId,
          planId: card.latestRecord.planId,
          statusLabel: card.latestRecord.status,
          finishedAt: card.latestRecord.finishedAt,
        },
  };
}

/** 呈现策略「有进行中项时呈现」(017 表态 3):字段缺席(批 1 世代快照)或
 *  空集(诚实空卡=无进行中下载)一律 null,绝不渲染空卡 */
function projectDownloadCard(
  card: OverlayDownloadCardV01 | undefined,
): OverlayDownloadCardView | null {
  if (card === undefined || card.activeDownloads.length === 0) return null;
  return {
    activeDownloads: card.activeDownloads.map((row) => ({
      downloadId: row.downloadId,
      stateLabel: row.state,
      stateRaw: row.state,
      updatedAt: row.updatedAt,
    })),
  };
}

export function overlayViewModel(
  snapshot: OverlaySnapshot,
  mode: OverlayInputMode,
): OverlayViewModel {
  const presentation = snapshot.presentation;

  if (snapshot.availability === "unavailable") {
    // 诚实缺席:生产读面未接线 → 与无活动同形的缺席空态,不伪装成空数据
    return {
      state: "inactive",
      tone: "neutral",
      statusTone: "inactive",
      statusTitleKey: "idle",
      taskCards: [],
      productionCard: { currentPlan: null, latestRecord: null },
      downloadCard: null,
      actions: [
        { action: "open_on_desktop", visible: false, primary: false },
        { action: "request_cancel_task", visible: false, primary: false },
        { action: "dismiss", visible: true, primary: mode === "desktop" },
      ],
      textScale: presentation.textScale,
      reducedMotion: presentation.reducedMotion,
    };
  }

  const taskCards = snapshot.tasks.map(projectTaskCard);
  const productionCard = snapshot.productionCard ? projectProductionCard(snapshot.productionCard) : { currentPlan: null, latestRecord: null };
  const downloadCard = projectDownloadCard(snapshot.downloadCard);

  // tone 推导(呈现映射,冻结词表):有非终态任务 → active;无进行中但有
  // failed → blocked;否则 inactive。词表外 state 不参与推导(不猜测)。
  const hasOpenTask = snapshot.tasks.some((card) => !isKnownTerminal(card.state));
  const hasFailedTask = snapshot.tasks.some((card) => card.state === "failed");
  const hasContent = taskCards.length > 0
    || productionCard.currentPlan !== null
    || productionCard.latestRecord !== null;
  const statusTone: OverlayStatusTone = hasOpenTask
    ? "active"
    : hasFailedTask
      ? "blocked"
      : "inactive";
  const statusTitleKey: OverlayStatusTitleKey = hasOpenTask
    ? "active"
    : hasContent
      ? "recent"
      : "idle";

  const openOnDesktopVisible = mode === "vr";
  const cancelVisible = hasOpenTask;

  const primary: OverlayAction | null = mode === "vr"
    ? "open_on_desktop"
    : "dismiss";

  const actions: readonly OverlayActionView[] = [
    { action: "open_on_desktop", visible: openOnDesktopVisible, primary: primary === "open_on_desktop" },
    { action: "request_cancel_task", visible: cancelVisible, primary: false },
    { action: "dismiss", visible: true, primary: primary === "dismiss" },
  ];

  return {
    state: hasContent ? "ready" : "inactive",
    tone: toneForStatus(statusTone),
    statusTone,
    statusTitleKey,
    taskCards,
    productionCard,
    downloadCard,
    actions,
    textScale: presentation.textScale,
    reducedMotion: presentation.reducedMotion,
  };
}
