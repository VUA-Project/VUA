/**
 * 引导内容模型(G6 → 2026-09-26 覆盖层宿主裁决):主题 ↔ 内容包教程的映射,
 * 以及主题内插图的资产解析。页文案在 i18n strings(guide.pages.*);
 * 本模块只持有结构性事实——每个主题对应哪个教程、媒体 id 解析到哪张
 * 自制 SVG。游戏引导 Tab 退役后,本模型由覆盖层引导视图(GuideOverlayView)
 * 消费,深链接语义不再经页面路由。
 * 本模块不 import 内容包 JSON(node --test 无法裸 import JSON);
 * 与内容包的一致性由 validateGuideContent 在测试中以注入方式校验。
 */
import type { TutorialContentPackV1 } from "../../app/tutorial-content-pack.ts";
import { strings } from "../../i18n/index.ts";

/** 引导主题 id:房间/游玩空间准备 + 五个教程支撑主题(原游戏引导五页)
 *  + 阅读型 VUA 使用教程。房间准备是三类引导裁决后阅读器的首个主题——
 *  准备阅读器在没有软件安装前就有用(物理空间先于软件) */
export type GuideTopicId =
  | "guide-room"
  | "guide-start"
  | "guide-basics"
  | "guide-safety"
  | "guide-devices"
  | "guide-tutorials"
  | "guide-vua";

/** 主题顺序即阅读器/覆盖层主题切换条的展示顺序(房间准备殿先,VUA 使用教程殿后) */
export const GUIDE_TOPIC_IDS: readonly GuideTopicId[] = [
  "guide-room",
  "guide-start",
  "guide-basics",
  "guide-safety",
  "guide-devices",
  "guide-tutorials",
  "guide-vua",
];

/** 主题 id → strings.guide.pages 键(主题内容与 i18n 的接缝) */
export const GUIDE_TOPIC_COPY_KEY: Record<GuideTopicId, keyof typeof strings.guide.pages> = {
  "guide-room": "room",
  "guide-start": "start",
  "guide-basics": "basics",
  "guide-safety": "safety",
  "guide-devices": "devices",
  "guide-tutorials": "tutorials",
  "guide-vua": "vua",
};

/** 教程支撑子集:主题 → 内容包教程 id(教程 id 与主题 id 同名是约定)。
 *  guide-vua 与 guide-room 是阅读型主题,无教程支撑——教程端口未接入前
 *  不伪造内容包行。 */
export type GuideTutorialTopicId = Exclude<GuideTopicId, "guide-vua" | "guide-room">;

export const GUIDE_PAGE_TUTORIAL: Record<GuideTutorialTopicId, string> = {
  "guide-start": "guide-start",
  "guide-basics": "guide-basics",
  "guide-safety": "guide-safety",
  "guide-devices": "guide-devices",
  "guide-tutorials": "guide-tutorials",
};

export const GUIDE_TUTORIAL_TOPIC_IDS: readonly GuideTutorialTopicId[] = [
  "guide-start",
  "guide-basics",
  "guide-safety",
  "guide-devices",
  "guide-tutorials",
];

export type GuideMediaId =
  | "pc-keys"
  | "vr-controller"
  | "pico-usb"
  | "pico-wifi"
  | "steamvr-desktop"
  | "vrcft-flow";

/** 媒体 id → 资产与替代文本;strings 中引用的媒体 id 必须在此登记。
 * SVG 置 public/(Vite 原样拷贝进 dist):node --test 无法 import .svg,
 * URL 引用同时保证本模型可测、双主题可读。src 用相对路径(./guide/):
 * 打包应用经 file:// 加载 index.html,绝对路径 /guide/ 会解析到文件
 * 系统根而破图(B 切片真机演示发现);相对路径在 dev(http 页面路径 /)
 * 与 dist(file:// 相对 index.html)下都解析到渲染根 */
export const GUIDE_MEDIA: Record<GuideMediaId, { src: string; alt: string }> = {
  "pc-keys": { src: "./guide/pc-keys.svg", alt: strings.guide.mediaAlt.pcKeys },
  "vr-controller": { src: "./guide/vr-controller.svg", alt: strings.guide.mediaAlt.vrController },
  "pico-usb": { src: "./guide/pico-usb.svg", alt: strings.guide.mediaAlt.picoUsb },
  "pico-wifi": { src: "./guide/pico-wifi.svg", alt: strings.guide.mediaAlt.picoWifi },
  "steamvr-desktop": {
    src: "./guide/steamvr-desktop.svg",
    alt: strings.guide.mediaAlt.steamvrDesktop,
  },
  "vrcft-flow": { src: "./guide/vrcft-flow.svg", alt: strings.guide.mediaAlt.vrcftFlow },
};

/** 未登记的媒体 id 解析为 null——诚实缺省(不渲染破图),由测试保证不发生 */
export function resolveGuideMedia(mediaId: string): { src: string; alt: string } | null {
  return mediaId in GUIDE_MEDIA ? GUIDE_MEDIA[mediaId as GuideMediaId] : null;
}

/**
 * 结构一致性校验(测试注入内容包):
 * - 每个教程支撑主题的教程必须存在于内容包;
 * - strings 中引用的每个媒体 id 必须已登记资产。
 * 校验失败抛 Error——两者都是构建期内容损坏,不是运行时分支。
 */
export function validateGuideContent(pack: TutorialContentPackV1): void {
  const tutorialIds = new Set(pack.tutorials.map((t) => t.id));
  for (const topic of GUIDE_TUTORIAL_TOPIC_IDS) {
    const tutorialId = GUIDE_PAGE_TUTORIAL[topic];
    if (!tutorialIds.has(tutorialId)) {
      throw new Error(`guide_content_missing_tutorial:${tutorialId}`);
    }
  }
  for (const pageCopy of Object.values(strings.guide.pages)) {
    for (const section of pageCopy.sections) {
      if ("media" in section && section.media !== undefined && !(section.media in GUIDE_MEDIA)) {
        throw new Error(`guide_content_unknown_media:${section.media}`);
      }
    }
  }
}
