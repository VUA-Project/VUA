/**
 * 覆盖层引导视图(2026-09-26 用户裁决:游戏引导 Tab 退役,引导内容迁入
 * 置顶覆盖层窗口;窄窗口 460px 形态)。
 * 结构:横排主题 chips(六主题,顺序即 guide-content 的 GUIDE_TOPIC_IDS)
 * + 所选主题的标题/导语/分节(段落 + 自制 SVG 插图,经 GUIDE_MEDIA 解析)。
 * 内容全部来自 i18n strings.guide.pages——覆盖层与(已退役的)原页面
 * 消费同一份文案,不另立第二套内容。
 * 刻意不含:「学习目标与进度」卡(教程端口为未接入占位,常驻空槽不诚实)
 * 与 DEV-only 教程入口(随 GuidePage 一并退役)。
 *
 * 首玩发行(ibis A 切片)补充:
 * - 插图四语言图注(section.caption,与 media 成对出现):明确其为示意图,
 *   与真实软件截图区分;图注是文案的一部分,随语言表切换;
 * - 主题切换条键盘操作:roving tabindex + 方向键/Home/End(tablist 语义),
 *   Tab 键只停一次,Enter/Space 激活沿用原生 button 行为;
 * - 正文面板可聚焦(tabpanel tabIndex=0):Tab 自主题进入正文,聚焦后
 *   方向键/翻页键经最近滚动祖先(.vua-overlay__body)滚动阅读。
 *
 * 首玩 B 切片(定位与阅读恢复):
 * - 初始落点:加载查询的明确定位 > 上次阅读位置 > 开始页;
 * - 定位请求(guideRequest 属性,经 Main 的 guide-target 事件转发):
 *   明确步骤以步骤为准;null = 普通打开,恢复上次阅读位置;未知词表值
 *   经 normalizeGuideTarget 安全回退;
 * - 手动切主题 = 从主题开头阅读;当前主题 chip 在切换条内保持可见
 *   (只横向滚动切换条,不动正文滚动);
 * - 阅读位置随切主题/定位/滚动(去抖)持久化:只存 {topic, section?},
 *   切到状态页再返回、收起再打开、窗口重建均不丢失。
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { GuideTargetV1 } from "@vua/contracts";
import { MediaSlot } from "../../components/primitives/MediaSlot.tsx";
import { strings } from "../../i18n/index.ts";
import {
  GUIDE_TOPIC_COPY_KEY,
  GUIDE_TOPIC_IDS,
  resolveGuideMedia,
  type GuideTopicId,
} from "../guide/guide-content.ts";
import {
  loadGuideReading,
  normalizeGuideTarget,
  parseGuideTargetFromSearch,
  saveGuideReading,
  type GuideTarget,
} from "../guide/guide-target.ts";

const GUIDE_PANEL_ID = "guide-overlay-panel";
const guideTabId = (topic: GuideTopicId) => `guide-overlay-tab-${topic}`;
const guideSectionId = (section: string) => `guide-overlay-section-${section}`;

/** 定位请求(DesktopOverlaySurface 投递):nonce 递增区分"重复定位同一分节" */
export interface GuideRequest {
  readonly target: GuideTargetV1 | null;
  readonly nonce: number;
}

/** 初始落点判定(纯函数,可测):明确定位(加载查询)> 上次阅读位置 > 开始页 */
export function initialGuideTarget(search: string, stored: GuideTarget | null): GuideTarget {
  return parseGuideTargetFromSearch(search) ?? stored ?? { topic: "guide-start" };
}

export function GuideOverlayView({ guideRequest }: { guideRequest?: GuideRequest | null }) {
  const copy = strings.guide;
  const [initialTarget] = useState(() =>
    initialGuideTarget(window.location.search, loadGuideReading()),
  );
  const [topic, setTopic] = useState<GuideTopicId>(initialTarget.topic);
  // 滚动触发序号:同主题内换分节时 setTopic 不产生渲染,滚动副作用
  // 必须另有触发源(首玩 B 切片真机演示发现的同主题定位缺陷)
  const [scrollNonce, setScrollNonce] = useState(0);
  const tabRefs = useRef<Partial<Record<GuideTopicId, HTMLButtonElement | null>>>({});
  const stripRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** 待执行滚动:主题渲染提交后生效("top" = 主题开头;否则分节 id) */
  const pendingScroll = useRef<string | null>(initialTarget.section ?? null);
  const appliedNonce = useRef(0);
  const topicCopy = copy.pages[GUIDE_TOPIC_COPY_KEY[topic]];

  const scroller = () => panelRef.current?.closest(".vua-overlay__body");

  const scrollBodyTo = (top: number) => {
    const body = scroller();
    if (body) body.scrollTop = top;
  };

  const scrollToSection = (section: string) => {
    const body = scroller();
    const anchor = panelRef.current?.querySelector(`#${guideSectionId(section)}`);
    if (!body || !anchor) return;
    body.scrollTop =
      anchor.getBoundingClientRect().top -
      body.getBoundingClientRect().top +
      body.scrollTop -
      8;
  };

  /** 应用定位(显式步骤或恢复值):切主题、渲染后滚动、记为当前阅读位置 */
  const applyGuideTarget = (target: GuideTarget) => {
    pendingScroll.current = target.section ?? "top";
    setTopic(target.topic);
    setScrollNonce((nonce) => nonce + 1);
    saveGuideReading(target);
  };

  const selectTopic = (next: GuideTopicId, moveFocus: boolean) => {
    // 手动切主题 = 从该主题开头阅读(首玩 B 切片导航纪律)
    applyGuideTarget({ topic: next });
    if (moveFocus) tabRefs.current[next]?.focus();
  };

  const onTopicsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = GUIDE_TOPIC_IDS.indexOf(topic);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % GUIDE_TOPIC_IDS.length;
    else if (event.key === "ArrowLeft")
      nextIndex = (index - 1 + GUIDE_TOPIC_IDS.length) % GUIDE_TOPIC_IDS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = GUIDE_TOPIC_IDS.length - 1;
    if (nextIndex === null) return;
    const next = GUIDE_TOPIC_IDS[nextIndex];
    if (next === undefined) return;
    event.preventDefault();
    selectTopic(next, true);
  };

  // 初始落点记为当前阅读位置(首帧一次的显式定位覆盖旧值)
  useEffect(() => {
    saveGuideReading(initialTarget);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅首帧一次
  }, []);

  // 渲染提交后执行待滚动(初始分节 / 定位 / 手动切主题开头);
  // 依赖 scrollNonce:同主题内换分节(setTopic 同值不重渲染)也必然触发
  useEffect(() => {
    if (pendingScroll.current === null) return;
    const target = pendingScroll.current;
    pendingScroll.current = null;
    const frame = requestAnimationFrame(() => {
      if (target === "top") scrollBodyTo(0);
      else scrollToSection(target);
    });
    return () => cancelAnimationFrame(frame);
  }, [topic, scrollNonce]);

  // 当前主题 chip 在切换条内保持可见:只横向滚动切换条,不动正文滚动
  useEffect(() => {
    const strip = stripRef.current;
    const chip = tabRefs.current[topic];
    if (!strip || !chip) return;
    const left = chip.offsetLeft - (strip.clientWidth - chip.clientWidth) / 2;
    strip.scrollLeft = Math.max(0, left);
  }, [topic]);

  // 定位请求(Main 的 guide-target 事件):明确步骤以步骤为准;
  // null = 普通打开,恢复上次阅读位置;未知词表值安全回退
  useEffect(() => {
    if (guideRequest == null || guideRequest.nonce === appliedNonce.current) return;
    appliedNonce.current = guideRequest.nonce;
    applyGuideTarget(
      guideRequest.target === null
        ? (loadGuideReading() ?? { topic: "guide-start" })
        : normalizeGuideTarget(guideRequest.target),
    );
  }, [guideRequest]);

  // 滚动跟踪(去抖 150ms):正文当前分节记为阅读位置;只存 {topic, section?}
  useEffect(() => {
    const panel = panelRef.current;
    const body = scroller();
    if (!panel || !body) return;
    let timer: number | undefined;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const bodyTop = body.getBoundingClientRect().top;
        let current: string | undefined;
        for (const anchor of panel.querySelectorAll("[data-guide-section]")) {
          if (anchor.getBoundingClientRect().top - bodyTop > 96) break;
          current = anchor.getAttribute("data-guide-section") ?? undefined;
        }
        saveGuideReading(current === undefined ? { topic } : { topic, section: current });
      }, 150);
    };
    body.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      body.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
    };
  }, [topic]);

  return (
    <div className="vua-overlay-guide">
      <div
        className="vua-overlay-guide__topics"
        role="tablist"
        aria-label={copy.topicsAria}
        onKeyDown={onTopicsKeyDown}
        ref={stripRef}
      >
        {GUIDE_TOPIC_IDS.map((id) => (
          <button
            key={id}
            ref={(element) => {
              tabRefs.current[id] = element;
            }}
            type="button"
            role="tab"
            id={guideTabId(id)}
            aria-selected={topic === id}
            aria-controls={GUIDE_PANEL_ID}
            tabIndex={topic === id ? 0 : -1}
            className="vua-overlay-guide__topic"
            data-active={topic === id || undefined}
            onClick={() => selectTopic(id, false)}
          >
            {copy.pages[GUIDE_TOPIC_COPY_KEY[id]].title}
          </button>
        ))}
      </div>
      <div
        className="vua-overlay-guide__content"
        role="tabpanel"
        id={GUIDE_PANEL_ID}
        aria-labelledby={guideTabId(topic)}
        tabIndex={0}
        ref={panelRef}
      >
        <h1 className="vua-overlay-guide__title">{topicCopy.title}</h1>
        <p className="vua-overlay-guide__intro">{topicCopy.intro}</p>
        {topicCopy.sections.map((section) => {
          const media =
            "media" in section && typeof section.media === "string"
              ? resolveGuideMedia(section.media)
              : null;
          const caption =
            "caption" in section && typeof section.caption === "string"
              ? section.caption
              : null;
          return (
            <section
              key={section.id}
              className="vua-overlay-guide__section"
              id={guideSectionId(section.id)}
              data-guide-section={section.id}
            >
              <h2 className="vua-overlay-guide__section-title">{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph} className="vua-overlay-guide__paragraph">
                  {paragraph}
                </p>
              ))}
              {media !== null && caption !== null ? (
                <figure className="vua-overlay-guide__figure">
                  <MediaSlot src={media.src} alt={media.alt} aspectRatio="16 / 9" />
                  <figcaption className="vua-overlay-guide__caption">{caption}</figcaption>
                </figure>
              ) : media !== null ? (
                <MediaSlot src={media.src} alt={media.alt} aspectRatio="16 / 9" />
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
