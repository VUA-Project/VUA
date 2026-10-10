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
 * - 明确定位单次消费:查询段落位后从地址栏剥离,IPC 定位请求应用后
 *   按 nonce 回执清除——状态页往返/重挂载一律恢复最新阅读位置,
 *   旧定位不得重放(评审 P2);
 * - 定位请求(guideRequest 属性,经 Main 的 guide-target 事件转发):
 *   明确步骤以步骤为准;null = 普通打开,恢复上次阅读位置;未知词表值
 *   经 normalizeGuideTarget 安全回退;
 * - 手动切主题 = 从主题开头阅读;当前主题 chip 在切换条内保持可见
 *   (只横向滚动切换条,不动正文滚动);
 * - 阅读位置随切主题/定位/滚动(去抖)持久化:只存 {topic, section?},
 *   切到状态页再返回、收起再打开、窗口重建均不丢失;
 * - 待滚动标记活到动画帧执行时刻,滚动未到位有界重试
 *   (schedulePendingGuideScroll):StrictMode 双调用与首帧布局未长开的
 *   dev 形态下首次定位照常滚动(评审 P2 回归);
 * - 页底定位以「分节进入视口」为到达判定(钳到最大滚动后实测),
 *   用户主动滚动即时停止重试,不抢回滚动位置(评审 P2 第二轮);
 * - 首个程序滚动帧之前(或重试间隙)用户先滚同样取消定位请求——原外层
 *   守卫在无程序滚动时跳过分类,定位会在用户滚动后照常执行(交付计划
 *   挂账的 B 修复,scrollCancelsPendingGuide 纯判定 + 回归用例);
 * - 到位判定要求布局连续两帧稳定:宽版阅读窗在字体/插图载入前内容偏短,
 *   "分节可见"会误判到位并静默放弃定位(阅读窗冒烟 2026-10-06 实证,
 *   guideSectionArrival 纯判定 + 回归用例)。
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { GuideTargetV1 } from "@vua/contracts";
import { MediaSlot } from "../../components/primitives/MediaSlot.tsx";
import { strings } from "../../i18n/index.ts";
import { readEncyclopediaHash, recordEncyclopediaTarget } from "../help/encyclopedia-navigation.ts";
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
  stripGuideTargetFromLocation,
  type GuideTarget,
} from "../guide/guide-target.ts";
import {
  guideAnchorVisible,
  guideSectionArrival,
  schedulePendingGuideScroll,
  scrollCancelsPendingGuide,
} from "./pending-guide-scroll.ts";

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

/** 定位请求回执清除判定(纯函数,可测):只清除已被应用的那一条,
 *  之后到达的新请求不受影响(评审 P2:旧请求不得在重挂载时重复消费) */
export function shouldClearGuideRequest(
  current: { readonly nonce: number } | null,
  ackedNonce: number,
): boolean {
  return current !== null && current.nonce === ackedNonce;
}

export function GuideOverlayView({
  guideRequest,
  onGuideRequestApplied,
  embedded = false,
}: {
  guideRequest?: GuideRequest | null;
  embedded?: boolean;
  /** 定位请求已应用的回执(按 nonce 清除,防重挂载重放) */
  onGuideRequestApplied?: (nonce: number) => void;
}) {
  const copy = strings.guide;
  const [initialTarget] = useState(() =>
    guideRequest != null
      ? guideRequest.target === null ? loadGuideReading() ?? { topic: "guide-start" } as GuideTarget : normalizeGuideTarget(guideRequest.target)
      : (embedded ? readEncyclopediaHash(window.location.hash) : null) ?? initialGuideTarget(window.location.search, loadGuideReading()),
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
  const TopicHeading = embedded ? "h2" : "h1";
  const SectionHeading = embedded ? "h3" : "h2";

  const scroller = () => panelRef.current?.closest(".vua-overlay__body");

  /** 最近一次程序滚动的实际落点(滚动事件据此区分程序/用户来源) */
  const lastProgrammaticScroll = useRef<number | null>(null);
  /** 上一尝试帧的滚动内容高度(到达判定需布局连续两帧稳定;阅读窗冒烟
   *  发现的宽窗误到位回归,见 pending-guide-scroll.guideSectionArrival) */
  const lastBodyScrollHeight = useRef(-1);

  const scrollBodyTo = (top: number): boolean => {
    const body = scroller();
    if (!body) return false;
    body.scrollTop = top;
    lastProgrammaticScroll.current = body.scrollTop;
    return Math.abs(body.scrollTop - top) <= 2;
  };

  const scrollToSection = (section: string): boolean => {
    const body = scroller();
    const anchor = panelRef.current?.querySelector(`#${guideSectionId(section)}`);
    if (!body || !anchor) return false;
    // 布局稳定判定先行:与上一尝试帧的 scrollHeight 相同才算稳定;新定位
    // 请求在调度时清历史高度,首帧恒不稳定,强制至少两帧观察
    const layoutSettled = lastBodyScrollHeight.current === body.scrollHeight;
    lastBodyScrollHeight.current = body.scrollHeight;
    // 页底钳制:期望偏移不得超过最大滚动;到达判定用「分节进入视口 +
    // 滚动真正落地或钳在页底 + 布局稳定」(guideSectionArrival)
    const maxScroll = Math.max(0, body.scrollHeight - body.clientHeight);
    // Main's encyclopedia keeps its topic strip sticky; do not put a heading behind it.
    const stickyHeight = embedded ? (stripRef.current?.offsetHeight ?? 0) : 0;
    const desired = Math.min(
      Math.max(
        0,
        anchor.getBoundingClientRect().top -
          body.getBoundingClientRect().top +
          body.scrollTop -
          (stickyHeight + 8),
      ),
      maxScroll,
    );
    body.scrollTop = desired;
    lastProgrammaticScroll.current = body.scrollTop;
    const anchorTop = anchor.getBoundingClientRect().top;
    return guideSectionArrival(
      guideAnchorVisible(anchorTop, body.getBoundingClientRect().top + stickyHeight, body.clientHeight - stickyHeight),
      layoutSettled,
      Math.abs(body.scrollTop - desired) <= 2 && maxScroll > 0,
      maxScroll === 0 || body.scrollTop >= maxScroll - 2,
    );
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
    if (embedded) recordEncyclopediaTarget({ topic: next });
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

  // 首帧一次:初始落点记为当前阅读位置;明确定位查询段单次消费——
  // 落位后从地址栏剥离,之后的状态页往返/重挂载按最新阅读位置恢复
  useEffect(() => {
    saveGuideReading(initialTarget);
    if (embedded) recordEncyclopediaTarget(initialTarget, true);
    else stripGuideTargetFromLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅首帧一次
  }, []);

  useEffect(() => {
    if (!embedded) return;
    const onHistory = () => {
      const target = readEncyclopediaHash(window.location.hash);
      if (target) applyGuideTarget(target);
    };
    window.addEventListener("hashchange", onHistory);
    return () => window.removeEventListener("hashchange", onHistory);
  }, [embedded]);

  // 渲染提交后执行待滚动(初始分节 / 定位 / 手动切主题开头);
  // 依赖 scrollNonce:同主题内换分节(setTopic 同值不重渲染)也必然触发;
  // 标记活到动画帧执行时刻(schedulePendingGuideScroll 的 StrictMode 纪律);
  // 新请求清布局高度历史,到达判定的「连续两帧稳定」从本请求重新观察
  useEffect(() => {
    if (pendingScroll.current === null) return;
    lastBodyScrollHeight.current = -1;
    return schedulePendingGuideScroll(
      {
        read: () => pendingScroll.current,
        clear: () => {
          pendingScroll.current = null;
        },
        scrollBodyTo,
        scrollToSection,
      },
      (callback) => requestAnimationFrame(callback),
      (id) => cancelAnimationFrame(id),
    );
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
  // null = 普通打开,恢复上次阅读位置;未知词表值安全回退。
  // 应用后按 nonce 回执清除——旧请求不得在重挂载时重复消费(评审 P2)
  useEffect(() => {
    if (guideRequest == null || guideRequest.nonce === appliedNonce.current) return;
    appliedNonce.current = guideRequest.nonce;
    const target = guideRequest.target === null
        ? (loadGuideReading() ?? { topic: "guide-start" })
        : normalizeGuideTarget(guideRequest.target);
    applyGuideTarget(target);
    if (embedded) recordEncyclopediaTarget(target);
    onGuideRequestApplied?.(guideRequest.nonce);
  }, [guideRequest, onGuideRequestApplied]);

  // 滚动跟踪(去抖 150ms):正文当前分节记为阅读位置;只存 {topic, section?}
  // 用户主动滚动即时判定(不去抖):程序滚动落点不符,或首个程序滚动帧
  // 尚未执行(含重试间隙)时用户先滚 = 用户接管,即时取消待执行定位,
  // 不再抢回滚动位置(评审 P2 第二轮 + 交付计划挂账的首帧前滚动修复)
  useEffect(() => {
    const panel = panelRef.current;
    const body = scroller();
    if (!panel || !body) return;
    let timer: number | undefined;
    const onScroll = () => {
      if (
        scrollCancelsPendingGuide(
          body.scrollTop,
          lastProgrammaticScroll.current,
          pendingScroll.current,
        )
      ) {
        pendingScroll.current = null;
      }
      lastProgrammaticScroll.current = null;
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
        <TopicHeading className="vua-overlay-guide__title">{topicCopy.title}</TopicHeading>
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
              <SectionHeading className="vua-overlay-guide__section-title">{section.title}</SectionHeading>
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
