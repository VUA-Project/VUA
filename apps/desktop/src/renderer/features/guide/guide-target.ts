/**
 * 指南定位模型(首玩 B 切片):「主题 + 分节」定位、定位词表校验与回退、
 * 命名定位注册表、部署页标识 → 定位的映射,以及阅读位置持久化。
 *
 * 词表纪律:主题 id 与分节 id 的单一事实源是 i18n 源表(strings.guide.pages)
 * 与 guide-content 的主题注册表;跨进程(Main)只做形状收窄,词表校验与
 * 回退只在本层——未知主题回退到开始页(guide-start),未知分节回退到
 * 主题开头,绝不抛异常打断"打开指南"这一动作。
 *
 * 持久化纪律:只保存阅读信息({topic, section?}),不保存账号信息或部署
 * 任务进度;存储键唯一来源在 app/storage-keys.ts。
 */
import { storageKeys } from "../../app/storage-keys.ts";
import { strings } from "../../i18n/index.ts";
import {
  GUIDE_TOPIC_COPY_KEY,
  GUIDE_TOPIC_IDS,
  type GuideTopicId,
} from "./guide-content.ts";

/** 类型明确的指南定位:主题 + 可选分节(分节缺席 = 主题开头) */
export interface GuideTarget {
  readonly topic: GuideTopicId;
  readonly section?: string;
}

/** 主题 → 合法分节 id 闭集(由源表派生;四语言分节 id 对齐由 check-i18n-tables 把守) */
const guideSectionIds = {} as Record<GuideTopicId, readonly string[]>;
for (const topic of GUIDE_TOPIC_IDS) {
  guideSectionIds[topic] = strings.guide.pages[GUIDE_TOPIC_COPY_KEY[topic]].sections.map(
    (section) => section.id,
  );
}
export const GUIDE_SECTION_IDS: Readonly<Record<GuideTopicId, readonly string[]>> =
  guideSectionIds;

/** 回退落点:开始页(guide-start)主题开头 */
export const GUIDE_FALLBACK_TARGET: GuideTarget = { topic: "guide-start" };

/**
 * 未知值 → 合法定位(纯函数,可测):
 * - 主题在词表内、分节缺席 → 该主题开头;
 * - 主题在词表内、分节在该主题分节闭集内 → 主题 + 分节;
 * - 主题在词表内、分节词表外 → 该主题开头(分节词表外不越出主题);
 * - 其余(主题词表外/形状垃圾/非对象)→ 开始页。
 */
export function normalizeGuideTarget(value: unknown): GuideTarget {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const topic = record.topic;
    if (typeof topic === "string" && (GUIDE_TOPIC_IDS as readonly string[]).includes(topic)) {
      const topicId = topic as GuideTopicId;
      const section = record.section;
      if (typeof section === "string" && GUIDE_SECTION_IDS[topicId].includes(section)) {
        return { topic: topicId, section };
      }
      return { topic: topicId };
    }
  }
  return GUIDE_FALLBACK_TARGET;
}

/** 加载查询段解析(?guideTopic=&guideSection=,新建窗口的首帧投递):
 *  无定位参数 → null(交由阅读位置恢复);有参数 → 词表校验后落位 */
export function parseGuideTargetFromSearch(search: string): GuideTarget | null {
  const params = new URLSearchParams(search);
  const topic = params.get("guideTopic");
  if (topic === null) return null;
  const section = params.get("guideSection");
  return normalizeGuideTarget({ topic, ...(section === null ? {} : { section }) });
}

/** 从查询段剥离定位参数(纯函数,可测):保留 surface/view 等其余参数 */
export function stripGuideTargetFromSearch(search: string): string {
  const params = new URLSearchParams(search);
  if (!params.has("guideTopic")) return search.startsWith("?") ? search : "";
  params.delete("guideTopic");
  params.delete("guideSection");
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/** 明确定位查询段的单次消费:首帧落位后从地址栏剥离(不重载页面)。
 *  定位是一次性指令——之后的状态页往返/重挂载一律按最新阅读位置恢复 */
export function stripGuideTargetFromLocation(): boolean {
  const stripped = stripGuideTargetFromSearch(window.location.search);
  if (stripped === window.location.search) return false;
  window.history.replaceState(null, "", `${window.location.pathname}${stripped}${window.location.hash}`);
  return true;
}

/* ---- 命名定位注册表(部署页与后续切片的统一入口)---- */

/** 覆盖首玩验收的业务步骤:Steam 注册、VRChat 安装与首次登录、PICO 串流
 *  准备,以及 USB / Wi-Fi / 眼追——尚未存在的业务入口同样只准备定位能力 */
export const GUIDE_TARGETS = {
  hardware: { topic: "guide-hardware", section: "identify-device" },
  steamAccount: { topic: "guide-start", section: "steam-account" },
  vrchatInstall: { topic: "guide-start", section: "install-vrchat" },
  vrchatFirstLaunch: { topic: "guide-start", section: "first-launch" },
  picoPrepare: { topic: "guide-devices", section: "pico-prepare" },
  picoUsb: { topic: "guide-devices", section: "pico-usb" },
  picoWifi: { topic: "guide-devices", section: "pico-wifi" },
  eyeTracking: { topic: "guide-devices", section: "eye-tracking" },
} as const satisfies Record<string, GuideTarget>;

/**
 * 部署页标识 → 定位(两套词表共用一张表):
 * - 环境检测项 id(引擎 inspect_zone 词表:steam / vrchat / steamvr /
 *   pico_runtime 等);
 * - 部署计划步骤组件 id(deployment 端口组件词表:同名)。
 * 无映射 = null(该卡片/步骤不渲染指南入口,不伪造指向)。
 */
const DEPLOYMENT_GUIDE_TARGETS: Readonly<Record<string, GuideTarget>> = {
  steam: GUIDE_TARGETS.steamAccount,
  vrchat: GUIDE_TARGETS.vrchatInstall,
  steamvr: GUIDE_TARGETS.picoPrepare,
  pico_runtime: GUIDE_TARGETS.picoPrepare,
};

export function guideTargetForCheckId(checkId: string): GuideTarget | null {
  return DEPLOYMENT_GUIDE_TARGETS[checkId] ?? null;
}

export function guideTargetForComponent(component: string): GuideTarget | null {
  return DEPLOYMENT_GUIDE_TARGETS[component] ?? null;
}

/* ---- 阅读位置持久化 ---- */

/** 读取上次阅读位置:存储缺席/损坏/词表外 → null(调用方回落默认开始页);
 *  存储值经 normalizeGuideTarget 校验,旧词表的失效分节安全落回主题开头 */
export function loadGuideReading(): GuideTarget | null {
  try {
    const stored = localStorage.getItem(storageKeys.guideReading);
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    const normalized = normalizeGuideTarget(parsed);
    // 存储值主题词表外时 normalize 已回落开始页;此处区分"根本没有记录"
    // (null,调用方按缺省处理)与"记录损坏已回退"(开始页)——两者落点一致
    return normalized;
  } catch {
    return null;
  }
}

/** 保存阅读位置(只写 {topic, section?};存储不可用静默降级为本次内存) */
export function saveGuideReading(position: GuideTarget): void {
  try {
    localStorage.setItem(
      storageKeys.guideReading,
      JSON.stringify(
        position.section === undefined
          ? { topic: position.topic }
          : { topic: position.topic, section: position.section },
      ),
    );
  } catch {
    /* 存储不可用:阅读位置仅本次会话内存生效 */
  }
}
