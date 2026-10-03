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
 *   Tab 键只停一次,Enter/Space 激活沿用原生 button 行为。
 */
import { useRef, useState, type KeyboardEvent } from "react";
import { MediaSlot } from "../../components/primitives/MediaSlot.tsx";
import { strings } from "../../i18n/index.ts";
import {
  GUIDE_TOPIC_COPY_KEY,
  GUIDE_TOPIC_IDS,
  resolveGuideMedia,
  type GuideTopicId,
} from "../guide/guide-content.ts";

const GUIDE_PANEL_ID = "guide-overlay-panel";
const guideTabId = (topic: GuideTopicId) => `guide-overlay-tab-${topic}`;

export function GuideOverlayView() {
  const copy = strings.guide;
  const [topic, setTopic] = useState<GuideTopicId>("guide-start");
  const tabRefs = useRef<Partial<Record<GuideTopicId, HTMLButtonElement | null>>>({});
  const topicCopy = copy.pages[GUIDE_TOPIC_COPY_KEY[topic]];

  const selectTopic = (next: GuideTopicId, moveFocus: boolean) => {
    setTopic(next);
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

  return (
    <div className="vua-overlay-guide">
      <div
        className="vua-overlay-guide__topics"
        role="tablist"
        aria-label={copy.topicsAria}
        onKeyDown={onTopicsKeyDown}
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
            <section key={section.id} className="vua-overlay-guide__section">
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
