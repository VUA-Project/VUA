import { formatDateTime } from "../../i18n/index.ts";
import { lazy, Suspense, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Badge } from "../../components/primitives/Badge.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { Card } from "../../components/primitives/Card.tsx";
import { EmptyState } from "../../components/primitives/EmptyState.tsx";
import { Skeleton } from "../../components/primitives/Skeleton.tsx";
import {
  ContextMenu,
  type ContextMenuState,
} from "../../components/primitives/ContextMenu.tsx";
import { Icon } from "@vua/design-system";
import {
  TurntablePlayer,
  type TurntableStatus,
} from "../../components/preview/TurntablePlayer.tsx";
import { format, strings } from "../../i18n/index.ts";
import type { PageId } from "../../app/nav-model.ts";
import {
  useDataSource,
  useGateway,
  type ReleaseProject,
  type ReleaseWallView,
} from "../../gateway/index.ts";
import type { PedestalMood } from "../../components/three/scenes/pedestal.ts";
import { useConveyor } from "./use-conveyor.ts";
import { ReleaseRecordsSection } from "./release-records-section.tsx";
import "./release.css";

/* 展台(S-IX-2):three.js 装饰层懒加载,不挡展柜首屏 */
const PedestalCanvas = lazy(() => import("../../components/three/PedestalCanvas.tsx"));

const copy = strings.release;

/**
 * Release 项目卡片墙(C-RECIPE-3,美术方案 v0.4.0 §6 展柜纪律):
 * - 展柜模块:内容唯一主角;不使用绿/琥珀状态色,中性灰阶为主,
 *   异常(漂移/缺依赖/检测未通过)才用红(§6.1);
 * - 预览图:项目带 bakePreview 定位(DEV fixture 接线)时,卡片显示烘焙
 *   封面、详情内嵌 T2 转盘(TurntablePlayer);读取失败/无定位时渲染
 *   诚实的占位说明,不显示破图或伪造缩略图;
 * - 操作纪律:恢复快照/重新派生/上传交接未接入,本切片不渲染死按钮,
 *   以 futureNote 明示;点击卡片只看详情。
 *
 * 取数:gateway.modelProduction.releaseWall();加载/失败/未接入/空墙四态诚实。
 */

/** 烘焙预览寻址(T2,DEV 接线):vite dev 的 /@fs/ 直读工程产物目录;
 *  正式实现由资产协议替换(见 model-production-port ReleaseProject.bakePreview) */
const bakePreviewEnabled = import.meta.env.DEV;

function bakeUrlFor(projectRoot: string): (rel: string) => string {
  const base = `/@fs/${projectRoot}/.vua/bridge/preview`;
  return (rel: string) => encodeURI(`${base}/${rel}`);
}

/** 展柜色彩纪律(§6.1):异常红,健康/中性事实灰 */
function healthBadgeTone(health: NonNullable<ReleaseProject["health"]>): "neutral" | "error" {
  return health === "healthy" ? "neutral" : "error";
}

function inspectionOf(project: ReleaseProject): {
  key: keyof typeof copy.inspection;
  tone: "neutral" | "error";
} {
  if (!project.lastInspection) return { key: "none", tone: "neutral" };
  return project.lastInspection.state === "passed"
    ? { key: "passed", tone: "neutral" }
    : { key: "failed", tone: "error" };
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : formatDateTime(iso);
}

function ProjectCard({
  project,
  selected,
  onSelect,
  onMenu,
}: {
  project: ReleaseProject;
  selected: boolean;
  onSelect: () => void;
  /** 成品卡右键菜单(S-XII):由页面组装动作项 */
  onMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const inspection = inspectionOf(project);
  // 封面读取失败(产物未烘焙/路径不可达):回退诚实占位,不挂破图
  const [coverBroken, setCoverBroken] = useState(false);
  const coverUrl =
    bakePreviewEnabled && project.bakePreview !== undefined && !coverBroken
      ? bakeUrlFor(project.bakePreview.projectRoot)(`${project.bakePreview.commandId}/cover.png`)
      : null;
  return (
    <button
      type="button"
      className="vua-release-card"
      data-selected={selected || undefined}
      onClick={onSelect}
      onContextMenu={onMenu}
    >
      <span
        className="vua-release-card__preview"
        data-has-cover={coverUrl !== null || undefined}
        aria-hidden="true"
      >
        {coverUrl !== null ? (
          <img
            className="vua-release-card__cover"
            src={coverUrl}
            alt=""
            onError={() => setCoverBroken(true)}
          />
        ) : (
          <span className="vua-caption vua-text-secondary">{copy.previewPlaceholder}</span>
        )}
      </span>
      <span className="vua-release-card__title">{project.title}</span>
      <span className="vua-release-card__badges">
        <Badge tone={inspection.tone}>{copy.inspection[inspection.key]}</Badge>
        {project.health ? (
          <Badge tone={healthBadgeTone(project.health)}>{copy.health[project.health]}</Badge>
        ) : null}
        <Badge tone="neutral">{format(copy.snapshotsLine, { count: project.snapshotCount })}</Badge>
      </span>
      <span className="vua-caption vua-text-secondary">
        {copy.metaUpdatedAt} · {formatTime(project.updatedAt)}
      </span>
    </button>
  );
}

function ProjectDetail({ project }: { project: ReleaseProject }) {
  const inspection = inspectionOf(project);
  const bake = bakePreviewEnabled ? project.bakePreview : undefined;
  const bakeUrlForMemo = useMemo(
    () => (bake !== undefined ? bakeUrlFor(bake.projectRoot) : null),
    [bake],
  );
  const [bakeStatus, setBakeStatus] = useState<TurntableStatus>("loading");
  const meta: Array<{ label: string; value: string }> = [];
  if (project.recipeTitle) meta.push({ label: copy.metaRecipe, value: project.recipeTitle });
  if (project.unityVersion) meta.push({ label: copy.metaUnity, value: project.unityVersion });
  if (project.platforms.length > 0) {
    meta.push({ label: copy.metaPlatforms, value: project.platforms.join(" / ") });
  }
  if (project.lastInspection) {
    meta.push({
      label: copy.inspection[inspection.key],
      value: formatTime(project.lastInspection.at),
    });
  }
  meta.push({ label: copy.metaUpdatedAt, value: formatTime(project.updatedAt) });
  return (
    <div className="vua-page__stack">
      <h2 className="vua-caption vua-text-secondary">{copy.detailTitle}</h2>
      <p className="vua-text-secondary">{project.title}</p>
      {bake !== undefined && bakeUrlForMemo !== null ? (
        <section>
          <h3 className="vua-caption vua-text-secondary">{copy.bakePreviewTitle}</h3>
          <div className="vua-release__bake-stage">
            <TurntablePlayer
              manifestPath={`${bake.commandId}/manifest.json`}
              urlFor={bakeUrlForMemo}
              onStatus={setBakeStatus}
            />
            {bakeStatus === "failed" ? (
              <span className="vua-release__bake-failed vua-caption vua-text-secondary">
                {copy.bakePreviewFailed}
              </span>
            ) : null}
          </div>
        </section>
      ) : null}
      <div className="vua-page__actions">
        <Badge tone={inspection.tone}>{copy.inspection[inspection.key]}</Badge>
        {project.health ? (
          <Badge tone={healthBadgeTone(project.health)}>{copy.health[project.health]}</Badge>
        ) : null}
        <Badge tone="neutral">{format(copy.snapshotsLine, { count: project.snapshotCount })}</Badge>
      </div>
      <dl className="vua-release-detail">
        {meta.map((item) => (
          <div key={item.label} className="vua-release-detail__row">
            <dt className="vua-caption vua-text-secondary">{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      <p className="vua-caption vua-text-secondary">{copy.futureNote}</p>
    </div>
  );
}

/** 展台氛围:由选中项目 health 映射(诚实纪律:展台为示意工艺品,不代表真实模型) */
function pedestalMoodOf(project: ReleaseProject | null): PedestalMood {
  if (project === null || project.health === undefined) return "none";
  return project.health === "healthy" ? "healthy" : "attention";
}

export function ReleasePage({
  onNavigate,
}: {
  onNavigate?: ((target: PageId) => void) | undefined;
}) {
  const gateway = useGateway();
  const isFixture = useDataSource() === "fixture";
  const [wall, setWall] = useState<ReleaseWallView | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /* 选中切换计数:驱动展台 flourish(经控制通道流入,不重建场景) */
  const [flourishKey, setFlourishKey] = useState(0);
  const conveyor = useConveyor<HTMLDivElement>();

  useEffect(() => {
    let alive = true;
    setLoadFailed(false);
    void gateway.modelProduction
      .releaseWall()
      .then((view) => {
        if (alive) setWall(view);
      })
      .catch(() => {
        if (alive) setLoadFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [gateway, reloadNonce]);

  const projects = wall?.kind === "wall" ? wall.projects : null;
  const selected = projects?.find((project) => project.id === selectedId) ?? null;
  /** 成品卡右键菜单(S-XII):查看/收起详情;恢复/派生/上传未接入,不列死按钮 */
  const [cardMenu, setCardMenu] = useState<ContextMenuState | null>(null);

  const selectProject = (id: string) => {
    setSelectedId(selectedId === id ? null : id);
    setFlourishKey((key) => key + 1);
  };

  const openProjectMenu = (project: ReleaseProject, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    const collapsing = selectedId === project.id;
    setCardMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          id: collapsing ? "collapse" : "viewDetails",
          label: collapsing ? copy.contextMenu.collapse : copy.contextMenu.viewDetails,
          onSelect: () => selectProject(project.id),
        },
      ],
    });
  };

  /* 传送带按卡宽步进:前后按钮与拖拽/滚轮共用同一轨道 */
  const { ref: conveyorRef, scrollByCard } = conveyor;

  return (
    <div className="vua-page">
      <section className="vua-page__hero">
        <h1 className="vua-title">
          {strings.nav.pages.release}
          {isFixture ? (
            <>
              {" "}
              <Badge tone="warning">{strings.common.fixtureBadge}</Badge>
            </>
          ) : null}
        </h1>
      </section>

      {loadFailed ? (
        <Card>
          <EmptyState
            title={copy.loadFailed}
            description={copy.loadFailedDescription}
            action={
              <Button variant="primary" onClick={() => setReloadNonce((nonce) => nonce + 1)}>
                {copy.retry}
              </Button>
            }
          />
        </Card>
      ) : wall === null ? (
        <Card>
          <div className="vua-page__stack">
            <Skeleton width="40%" />
            <Skeleton width="80%" />
            <Skeleton width="60%" />
          </div>
        </Card>
      ) : wall.kind === "not-connected" ? (
        <Card>
          <EmptyState title={copy.notConnectedTitle} description={copy.notConnectedDescription} />
        </Card>
      ) : projects !== null && projects.length === 0 ? (
        <Card>
          <EmptyState title={copy.emptyTitle} description={copy.emptyDescription} />
        </Card>
      ) : (
        <>
          {/* 传送带(S-IX-2):横向 scroll-snap + coverflow 轮盘变形;
           *  滚轮纵转横/拖拽/前后按钮均可滚动,点击卡片选中上台 */}
          <div className="vua-release-conveyor">
            <Button
              variant="subtle"
              className="vua-release-conveyor__nav"
              aria-label={copy.conveyor.prev}
              onClick={() => scrollByCard(-1)}
            >
              <Icon name="arrow-left" size={16} />
            </Button>
            <div
              className="vua-release-conveyor__track"
              ref={conveyorRef}
              role="list"
              aria-label={copy.conveyor.aria}
            >
              {(projects ?? []).map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  selected={selectedId === project.id}
                  onSelect={() => selectProject(project.id)}
                  onMenu={(event) => openProjectMenu(project, event)}
                />
              ))}
            </div>
            <Button
              variant="subtle"
              className="vua-release-conveyor__nav"
              aria-label={copy.conveyor.next}
              onClick={() => scrollByCard(1)}
            >
              <Icon name="arrow-right" size={16} />
            </Button>
          </div>
          <div className="vua-release__stage">
            {/* 立体展台:选中项目以示意工艺品上台;预览提取未接入(诚实说明常驻) */}
            <div className="vua-release__pedestal">
              <Suspense fallback={null}>
                <PedestalCanvas
                  mood={pedestalMoodOf(selected)}
                  flourishKey={flourishKey}
                />
              </Suspense>
              <p className="vua-caption vua-text-secondary vua-release__pedestal-note">
                {copy.pedestalNote}
              </p>
            </div>
            <Card>
              {selected === null ? (
                <p className="vua-caption vua-text-secondary">{copy.detailEmpty}</p>
              ) : (
                /* key=项目 id:切换项目时重置烘焙播放器状态 */
                <ProjectDetail key={selected.id} project={selected} />
              )}
            </Card>
          </div>
        </>
      )}
      {/* 构建记录节(P2,record.list/record.get 读面):独立于展柜数据源
       *  (releaseWall 与生产链读面端口不同),四态外始终渲染;失败≠空 */}
      <ReleaseRecordsSection onNavigate={onNavigate} />
      {cardMenu !== null ? <ContextMenu menu={cardMenu} onClose={() => setCardMenu(null)} /> : null}
    </div>
  );
}
