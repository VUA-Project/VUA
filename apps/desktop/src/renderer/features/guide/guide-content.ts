/**
 * 引导内容模型(G6 → 2026-09-26 覆盖层宿主裁决):主题 ↔ 内容包教程的映射,
 * 以及主题内插图的资产解析。页文案来自既有语言表和独立内容包;
 * 本模块只持有结构性事实——每个主题对应哪个教程、媒体 id 解析到哪张
 * 自制 SVG 或有来源记录的实机截图。游戏引导 Tab 退役后,本模型由覆盖层引导视图(GuideOverlayView)
 * 消费,深链接语义不再经页面路由。
 * 本模块不 import 内容包 JSON(node --test 无法裸 import JSON);
 * 与内容包的一致性由 validateGuideContent 在测试中以注入方式校验。
 */
import type { TutorialContentPackV1 } from "../../app/tutorial-content-pack.ts";
import { currentLocale, strings } from "../../i18n/index.ts";
import { guideAvatarCopy } from "../../i18n/guide-avatar-copy.ts";
import { guideEacCopy } from "../../i18n/guide-eac-copy.ts";
import { encyclopediaCopy } from "../../i18n/encyclopedia-copy.ts";
import { firstUseCopy } from "../../i18n/first-use-copy.ts";
import { resolveGuideScreenshot } from "./guide-media-manifest.ts";

export interface GuideSectionContent {
  readonly id: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly media?: string;
  readonly caption?: string;
}

export interface GuidePageContent {
  readonly title: string;
  readonly intro: string;
  readonly sections: readonly GuideSectionContent[];
}

export type GuideTopicId =
  | "guide-hardware"
  | "guide-room"
  | "guide-start"
  | "guide-basics"
  | "guide-avatars"
  | "guide-safety"
  | "guide-creator"
  | "guide-devices"
  | "guide-tutorials"
  | "guide-vua";

/** All IDs remain valid for bookmarks. */
export const GUIDE_TOPIC_IDS: readonly GuideTopicId[] = [
  "guide-hardware",
  "guide-room",
  "guide-start",
  "guide-basics",
  "guide-avatars",
  "guide-safety",
  "guide-creator",
  "guide-devices",
  "guide-tutorials",
  "guide-vua",
];

export const ENCYCLOPEDIA_TOPIC_IDS: readonly GuideTopicId[] = GUIDE_TOPIC_IDS.filter(topic => topic !== "guide-tutorials");

type GuideTopicCopyKey = keyof typeof strings.guide.pages | "avatars";
export const GUIDE_TOPIC_COPY_KEY: Record<GuideTopicId, GuideTopicCopyKey> = {
  "guide-hardware": "hardware",
  "guide-room": "room",
  "guide-start": "start",
  "guide-basics": "basics",
  "guide-avatars": "avatars",
  "guide-safety": "safety",
  "guide-creator": "creator",
  "guide-devices": "devices",
  "guide-tutorials": "tutorials",
  "guide-vua": "vua",
};

export function guidePage(topic: GuideTopicId, copy: typeof strings.guide = strings.guide): GuidePageContent {
  const key = GUIDE_TOPIC_COPY_KEY[topic];
  if (key === "avatars") return guideAvatarCopy[currentLocale];
  const page = copy.pages[key];
  if (key === "start") {
    return {
      ...page,
      sections: [firstUseCopy[currentLocale].vrchat, ...page.sections, ...guideEacCopy[currentLocale]],
    };
  }
  return key === "vua" ? { ...page, sections: [encyclopediaCopy[currentLocale].firstRun, ...page.sections] } : page;
}

export const GUIDE_SOURCE_LINKS: Partial<Record<GuideTopicId, string>> = {
  "guide-avatars": "https://creators.vrchat.com/avatars/creating-your-first-avatar/",
  "guide-creator": "https://creators.vrchat.com/avatars/creating-your-first-avatar/",
  "guide-safety": "https://docs.vrchat.com/docs/vrchat-safety-and-trust-system",
};

/** 教程支撑子集:主题 → 内容包教程 id(教程 id 与主题 id 同名是约定)。
 *  guide-vua 与 guide-room 是阅读型主题,无教程支撑——教程端口未接入前
 *  不伪造内容包行。 */
export type GuideTutorialTopicId = Exclude<GuideTopicId, "guide-vua" | "guide-room" | "guide-hardware" | "guide-creator" | "guide-avatars">;

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

export interface GuideMedia {
  readonly src: string;
  readonly alt: string;
  readonly caption?: string;
  readonly kind: "illustration" | "screenshot";
  readonly aspectRatio: string;
}

/** 未登记的媒体 id 解析为 null——诚实缺省(不渲染破图),由测试保证不发生 */
export function resolveGuideMedia(mediaId: string): GuideMedia | null {
  if (mediaId in GUIDE_MEDIA) return { ...GUIDE_MEDIA[mediaId as GuideMediaId], kind: "illustration", aspectRatio: "16 / 9" };
  return resolveGuideScreenshot(mediaId);
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
  for (const topic of GUIDE_TOPIC_IDS) {
    for (const section of guidePage(topic).sections) {
      if (section.media !== undefined && resolveGuideMedia(section.media) === null) {
        throw new Error(`guide_content_unknown_media:${section.media}`);
      }
    }
  }
}
