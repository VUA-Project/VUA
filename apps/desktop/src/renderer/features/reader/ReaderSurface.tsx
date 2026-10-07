/**
 * 准备阅读器表面(三类引导架构 2026-10-05 裁决:三类引导各得其所)。
 * 经 ?surface=reader 在应用初始化最早阶段分流渲染:普通不透明可缩放阅读
 * 窗口——不初始化主壳 Gateway、DEV scenario、路由与业务 store;无自定义
 * chrome(系统窗框承担最小化/还原/关闭),无 Esc 关闭(普通窗口行为)。
 *
 * 复用(首玩交付计划 §2.A):GuideOverlayView 的内容/定位/阅读恢复/键盘
 * 纪律原样共用——阅读位置经同一 localStorage 键跨窗口连续,旧的置顶覆盖层
 * 阅读记录即迁移为本窗口的初始落点;插图与图注、主题切换、定位单次消费
 * 全部来自引导模型,不另立第二套内容。
 * 定位请求:窗口缺席时经加载查询首帧投递(GuideOverlayView 自行解析);
 * 已开窗的定位经 Main 的 vua:reader:guide-target 事件到达,本面常驻暂存
 * 转发(与 DesktopOverlaySurface 同纪律),应用后按 nonce 回执清除。
 * 关闭只关呈现:安装任务与游戏进程不属于本窗口的生命周期。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  GuideOverlayView,
  shouldClearGuideRequest,
  type GuideRequest,
} from "../overlay/GuideOverlayView.tsx";
import "../overlay/overlay.css";
import "./reader.css";
import { strings } from "../../i18n/index.ts";

export function ReaderSurface() {
  const [guideRequest, setGuideRequest] = useState<GuideRequest | null>(null);
  const guideRequestNonce = useRef(0);

  useEffect(() => {
    const events = window.vua?.window.readerTargetEvents;
    if (!events) return;
    return events.subscribe((target) => {
      guideRequestNonce.current += 1;
      setGuideRequest({ target, nonce: guideRequestNonce.current });
    });
  }, []);

  // 定位请求应用回执:只清除已被应用的那一条(之后到达的新请求保留)
  const ackGuideRequest = useCallback((nonce: number) => {
    setGuideRequest((current) =>
      shouldClearGuideRequest(current, nonce) ? null : current,
    );
  }, []);

  // 任务栏/系统窗框标题:浏览器预览无 preload 也同样成立,不依赖窗口层
  useEffect(() => {
    document.title = strings.app.readerWindowTitle;
  }, []);

  return (
    <div className="vua-reader">
      {/* 复用覆盖层的滚动容器语义:GuideOverlayView 以最近的
          .vua-overlay__body 祖先为滚动/定位基准 */}
      <main className="vua-overlay__body vua-reader__body">
        <GuideOverlayView guideRequest={guideRequest} onGuideRequestApplied={ackGuideRequest} />
      </main>
    </div>
  );
}
