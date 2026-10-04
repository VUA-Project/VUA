import { installLocaleSync } from "./i18n/locale-sync.ts";
import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ShowcasePage } from "./dev/ShowcasePage.tsx";
import { TutorialSurface } from "./features/tutorial/TutorialSurface.tsx";
import { DesktopOverlaySurface } from "./features/overlay/DesktopOverlaySurface.tsx";
import { VrOverlaySurface } from "./features/overlay/VrOverlaySurface.tsx";
import { ReaderSurface } from "./features/reader/ReaderSurface.tsx";
import { GameGuideSurface } from "./features/game-guide/GameGuideSurface.tsx";
import { currentLocale } from "./i18n/index.ts";
import "@vua/design-system/tokens.css";
import "@vua/design-system/base.css";
import "./app-shell.css";

/**
 * 表面分流(应用初始化最早阶段):教程伴随窗口只渲染 TutorialSurface,
 * 桌面/VR 覆盖层只渲染各自的 OverlaySurface(切片五 F7a,与 tutorial 同级),
 * 准备阅读器只渲染 ReaderSurface(三类引导裁决 2026-10-05:普通阅读窗口),
 * 均不初始化主壳 Gateway、DEV scenario、路由与业务 store(G4 P0 边界);
 * 其余表面进入应用壳。窗口路由由创建窗口的一方决定,渲染器不接受
 * 来自任意来源的跳转(Electron Main 对 will-navigate 白名单校验)。
 */
const surface = new URLSearchParams(window.location.search).get("surface");

/**
 * DEV 视图分流(G2-A):?dev=showcase 只渲染组件状态展台,不初始化应用壳;
 * ?dev=preview-lab 渲染预览实验室(本地演示工程 spike,经 /@fs/ 读用户侧
 * Unity 工程,需本机 vite 配置 fs.allow 放行——按本仓纪律不携带机器
 * 绝对路径)。import.meta.env.DEV 守卫,生产构建中 devView 恒为 null,
 * 分支被 Rollup 剔除(与 resolve-scenario 同一防线模式,check-leak 验证);
 * preview-lab 懒加载,three 不进主 chunk。
 */
const devView = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get("dev")
  : null;

const PreviewLabPage = import.meta.env.DEV
  ? lazy(() =>
      import("./dev/PreviewLabPage.tsx").then((m) => ({
        default: m.PreviewLabPage,
      })),
    )
  : null;

// html lang 与当前语言表同步(C-I18N;辅助技术与拼写检查依赖)
document.documentElement.lang = currentLocale;
const stopLocaleSync = installLocaleSync(currentLocale);
if (import.meta.hot) import.meta.hot.dispose(stopLocaleSync);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {surface === "tutorial" ? (
      <TutorialSurface />
    ) : surface === "overlay-desktop" ? (
      <DesktopOverlaySurface />
    ) : surface === "overlay-vr" ? (
      <VrOverlaySurface />
    ) : surface === "reader" ? (
      <ReaderSurface />
    ) : surface === "game-guide" ? (
      <GameGuideSurface />
    ) : devView === "showcase" ? (
      <ShowcasePage />
    ) : devView === "preview-lab" && PreviewLabPage !== null ? (
      <Suspense fallback={null}>
        <PreviewLabPage />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
