import { useState, type ReactNode } from "react";
import { Badge, type BadgeProps } from "../components/primitives/Badge.tsx";
import { Button, type ButtonProps } from "../components/primitives/Button.tsx";
import { Card } from "../components/primitives/Card.tsx";
import { EmptyState } from "../components/primitives/EmptyState.tsx";
import { MediaSlot } from "../components/primitives/MediaSlot.tsx";
import { Skeleton } from "../components/primitives/Skeleton.tsx";
import { StatusLight, type StatusLevel } from "../components/primitives/StatusLight.tsx";
import { format, strings, TERMS } from "../i18n/index.ts";
import { capabilityDetailKeys, capabilityStates } from "../gateway/index.ts";
import { PerfProbeOverlay } from "./PerfProbeOverlay.tsx";
import "../app-shell.css";
import "./showcase.css";

/**
 * 组件状态展台(G2-A,dev-only):单页走查全部 primitives 的状态矩阵。
 * - 深/浅主题同页并排(data-theme 作用域到面板,不改动全局主题);
 * - 辖区敏感节(按钮/徽标/卡片/导航)紫橙两栏并排(data-module 作用域);
 * - 交互态用 .demo-* 类强制渲染,取值只引用既有 Token 与既有规则(见 showcase.css);
 * - 顶部切换"正常动画 / 模拟减少动态效果"(容器类压掉动效,对照用);
 * - 高对比度列留空位,待 G11 补。
 * 挂载:main.tsx 的 ?dev=showcase 分支,import.meta.env.DEV 守卫,生产构建剔除。
 */

const copy = strings.showcase;

type ButtonVariant = NonNullable<ButtonProps["variant"]>;
type BadgeTone = NonNullable<BadgeProps["tone"]>;

const buttonVariants: readonly ButtonVariant[] = ["primary", "default", "subtle"];
const badgeTones: readonly BadgeTone[] = ["neutral", "brand", "success", "warning", "error"];
const statusLevels: readonly StatusLevel[] = ["ok", "warning", "error", "unknown"];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="showcase__section">
      <h3 className="vua-title showcase__section-title">{title}</h3>
      {children}
    </section>
  );
}

/** 辖区敏感节:紫(默认)与橙(data-module="production")两栏并排 */
function DistrictPair({ children }: { children: ReactNode }) {
  return (
    <div className="showcase__districts">
      <div className="showcase__district">
        <p className="vua-caption vua-text-secondary">{copy.districtPurple}</p>
        {children}
      </div>
      <div className="showcase__district" data-module="production">
        <p className="vua-caption vua-text-secondary">
          {format(copy.districtOrange, { amf: TERMS.amf })}
        </p>
        {children}
      </div>
    </div>
  );
}

function StateLabel({ text }: { text: string }) {
  return <p className="vua-caption vua-text-secondary showcase__state-label">{text}</p>;
}

function ButtonMatrix() {
  return (
    <div className="showcase__grid">
      {buttonVariants.map((variant) => (
        <div className="showcase__row" key={variant}>
          <StateLabel text={`${variant}`} />
          <span className="showcase__cell">
            <Button variant={variant}>{copy.demo.buttonLabel}</Button>
          </span>
          <span className="showcase__cell">
            <Button variant={variant} className="demo-hover">
              {copy.states.hover}
            </Button>
          </span>
          <span className="showcase__cell">
            <Button variant={variant} className="demo-pressed">
              {copy.states.pressed}
            </Button>
          </span>
          <span className="showcase__cell">
            <Button variant={variant} className="demo-focus">
              {copy.states.focused}
            </Button>
          </span>
          <span className="showcase__cell">
            <Button variant={variant} disabled>
              {copy.states.disabled}
            </Button>
          </span>
        </div>
      ))}
      <p className="vua-caption vua-text-secondary">{copy.loadingNote}</p>
    </div>
  );
}

function BadgeRow() {
  return (
    <div className="showcase__line">
      {badgeTones.map((tone) => (
        <Badge tone={tone} key={tone}>
          {copy.badgeTones[tone]}
        </Badge>
      ))}
    </div>
  );
}

function CardRow() {
  return (
    <div className="showcase__line">
      <span className="showcase__cell">
        <StateLabel text={copy.states.default} />
        <Card>{copy.demo.cardBody}</Card>
      </span>
      <span className="showcase__cell">
        <StateLabel text={copy.states.hover} />
        <Card className="demo-hover">{copy.demo.cardBody}</Card>
      </span>
      <span className="showcase__cell">
        <StateLabel text="elevated" />
        <Card elevated>{copy.demo.cardBody}</Card>
      </span>
    </div>
  );
}

/** 控件质感节(v0.4.0 §3.6):面板卡 vs Elevated 浮层 vs 输入框,质感无辖区敏感性 */
function TextureRow() {
  return (
    <div className="showcase__line">
      <span className="showcase__cell">
        <StateLabel text={copy.textureDemo.panel} />
        <Card>{copy.textureDemo.panelBody}</Card>
      </span>
      <span className="showcase__cell">
        <StateLabel text={copy.textureDemo.elevated} />
        <Card elevated>{copy.textureDemo.elevatedBody}</Card>
      </span>
      <span className="showcase__cell">
        <StateLabel text={copy.textureDemo.input} />
        <input
          className="showcase__input"
          type="text"
          placeholder={copy.textureDemo.inputPlaceholder}
          readOnly
        />
      </span>
    </div>
  );
}

function CapabilityRow() {
  // 七态(G3 §2.6 + 自审补强):键与 gateway/types.ts 的 CapabilityState 一一对应;
  // 文案一律查 strings.capability,展台只演示呈现,不持有状态逻辑
  const tones: Record<(typeof capabilityStates)[number], BadgeTone> = {
    unavailable: "neutral",
    unconfigured: "warning",
    loading: "brand",
    ready: "success",
    blocked: "warning",
    waitingInput: "warning",
    error: "error",
  };
  return (
    <div className="showcase__grid">
      <div className="showcase__line">
        {capabilityStates.map((state) => (
          <Badge tone={tones[state]} key={state}>
            {strings.capability.states[state]}
          </Badge>
        ))}
      </div>
      {capabilityDetailKeys.map((key) => (
        <p className="vua-caption vua-text-secondary" key={key}>
          {strings.capability.details[key]}
        </p>
      ))}
    </div>
  );
}

function NavSelectedDemo() {  return (
    <div className="showcase__line">
      <span className="showcase__cell">
        <StateLabel text={copy.states.default} />
        <button type="button" className="vua-shell__tab">
          {copy.demo.navTab}
        </button>
      </span>
      <span className="showcase__cell">
        <StateLabel text={copy.states.hover} />
        <button type="button" className="vua-shell__tab demo-hover">
          {copy.demo.navTab}
        </button>
      </span>
      <span className="showcase__cell">
        <StateLabel text={copy.states.selected} />
        <button type="button" className="vua-shell__tab" aria-current="page">
          {copy.demo.navTab}
        </button>
      </span>
      <span className="showcase__cell">
        <StateLabel text={copy.states.default} />
        <button type="button" className="vua-shell__sidebar-item">
          {copy.demo.navSidebar}
        </button>
      </span>
      <span className="showcase__cell">
        <StateLabel text={copy.states.selected} />
        <button type="button" className="vua-shell__sidebar-item" aria-current="page">
          {copy.demo.navSidebar}
        </button>
      </span>
    </div>
  );
}

function ThemeSections() {
  return (
    <>
      <Section title={copy.sections.button}>
        <DistrictPair>
          <ButtonMatrix />
        </DistrictPair>
      </Section>
      <Section title={copy.sections.badge}>
        <DistrictPair>
          <BadgeRow />
        </DistrictPair>
      </Section>
      <Section title={copy.sections.card}>
        <DistrictPair>
          <CardRow />
        </DistrictPair>
      </Section>
      <Section title={copy.sections.texture}>
        <TextureRow />
      </Section>
      <Section title={copy.sections.statusLight}>
        <div className="showcase__grid">
          {statusLevels.map((level) => (
            <div className="showcase__line" key={level}>
              <StatusLight level={level} />
              <StatusLight level={level} withLabel />
              <StatusLight level={level} size="lg" />
              <StatusLight level={level} size="lg" withLabel />
            </div>
          ))}
        </div>
      </Section>
      <Section title={copy.sections.emptyState}>
        <Card>
          <EmptyState title={copy.demo.emptyTitle} description={copy.demo.emptyDescription} />
        </Card>
      </Section>
      <Section title={copy.sections.skeleton}>
        <div className="showcase__grid">
          <Skeleton width="60%" />
          <Skeleton width="80%" />
          <Skeleton width={120} height={120} />
        </div>
      </Section>
      <Section title={copy.sections.mediaSlot}>
        <div className="showcase__line">
          <span className="showcase__cell">
            <StateLabel text={copy.states.loading} />
            <MediaSlot src="/guide/pc-keys.svg" alt="" previewState="loading" />
          </span>
          <span className="showcase__cell">
            <StateLabel text={copy.states.ready} />
            <MediaSlot src="/guide/pc-keys.svg" alt="" previewState="ready" />
          </span>
          <span className="showcase__cell">
            <StateLabel text={copy.states.failed} />
            <MediaSlot src="/guide/pc-keys.svg" alt="" previewState="failed" />
          </span>
        </div>
      </Section>
      <Section title={copy.sections.navSelected}>
        <DistrictPair>
          <NavSelectedDemo />
        </DistrictPair>
      </Section>
      <Section title={copy.sections.capability}>
        <CapabilityRow />
      </Section>
    </>
  );
}

export function ShowcasePage() {
  const [reduced, setReduced] = useState(false);
  return (
    <div className={reduced ? "showcase showcase--reduced" : "showcase"}>
      <header className="showcase__header">
        <h1 className="vua-display">{copy.title}</h1>
        <p className="vua-text-secondary">{copy.subtitle}</p>
        <div className="showcase__motion-toggle" role="group" aria-label={copy.title}>
          <Button variant={reduced ? "default" : "primary"} onClick={() => setReduced(false)}>
            {copy.motionNormal}
          </Button>
          <Button variant={reduced ? "primary" : "default"} onClick={() => setReduced(true)}>
            {copy.motionReduced}
          </Button>
        </div>
      </header>
      <div className="showcase__themes">
        <section className="showcase__theme" data-theme="dark">
          <h2 className="vua-title">{copy.themeDark}</h2>
          <ThemeSections />
        </section>
        <section className="showcase__theme" data-theme="light">
          <h2 className="vua-title">{copy.themeLight}</h2>
          <ThemeSections />
        </section>
        {/* HC 列(C-I18N):局部 data-hc="on" 预览手动高对比度映射,
            与系统 forced-colors 通道共用同一套 Token 覆盖 */}
        <section className="showcase__theme" data-hc="on">
          <h2 className="vua-title">{copy.themeHc}</h2>
          <ThemeSections />
        </section>
      </div>
      {import.meta.env.DEV ? <PerfProbeOverlay /> : null}
    </div>
  );
}
