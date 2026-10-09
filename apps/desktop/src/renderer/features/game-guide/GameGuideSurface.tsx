/**
 * 游戏引导表面(三类引导架构 §4):经 ?surface=game-guide 在应用
 * 初始化最早阶段分流渲染;不初始化主壳 Gateway、DEV scenario、路由与
 * 业务 store。小型透明置顶窗——跟随开启时由 Main 按游戏窗口观察自动
 * 落位/显隐,跟随关闭或游戏缺席时玩家仍可手动拖到游戏画面上。
 *
 * 纪律(guidance §4):
 * - 一次只呈现一步:在哪开菜单、改什么、应看到什么、不符时怎么办;
 *   确认/跳过记录引导进度(玩家自己的记录),不主张 VUA 检查或更改了
 *   游戏设置;
 * - 「跟随 VRChat 窗口」开关缺省开启(用户裁决),渲染层只持久化
 *   (localStorage)与推送 Main,显隐/移动的强制执行在 Main;跟随
 *   开启时轮询跟随状态,仅在观察非 ready 时如实提示(缺席/等待/
 *   通道缺席三态分立),ready 时不占版面;
 * - 透明度滑杆就地调节背景不透明度(缺省 50%,用户裁决),偏好本地
 *   持久化,与进度分键;
 * - 隐藏是显式动作(窗内按钮/Esc),隐藏不销毁——位置与进度保留,
 *   顶栏「游戏引导」重开恢复;本会话内手动隐藏优先(当前游戏会话
 *   不再自动弹出,显式重开才恢复);隐藏不取消任何任务、不停止游戏;
 * - 教程世界步诚实降级:按语言核对的世界清单待作者实测,先给游戏内
 *   搜索路线,不虚构世界编号;
 * - 拖拽条移动窗口(frameless);自动显示由 Main showInactive,不夺
 *   游戏焦点。
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Icon } from "@vua/design-system";
import type { GameGuideFollowStatusV1 } from "@vua/contracts";
import { Button } from "../../components/primitives/Button.tsx";
import { format, strings } from "../../i18n/index.ts";
import {
  GAME_GUIDE_STEPS,
  decideGameGuideStep,
  gameGuideComplete,
  loadGameGuideFollowing,
  loadGameGuideOpacity,
  loadGameGuideProgress,
  normalizeGameGuideOpacity,
  restartGameGuide,
  saveGameGuideFollowing,
  saveGameGuideOpacity,
  saveGameGuideProgress,
  type GameGuideDecision,
  type GameGuideProgressV1,
} from "./game-guide-model.ts";
import "./game-guide.css";

const copy = strings.gameGuide;

export function GameGuideSurface() {
  const [progress, setProgress] = useState<GameGuideProgressV1>(() => loadGameGuideProgress() ?? restartGameGuide());
  const [opacity, setOpacity] = useState<number>(() => loadGameGuideOpacity());
  const [following, setFollowing] = useState<boolean>(() => loadGameGuideFollowing().enabled);
  const [followStatus, setFollowStatus] = useState<GameGuideFollowStatusV1 | null>(null);
  const complete = gameGuideComplete(progress);
  // 完成态后重复决定不推进(decideGameGuideStep 钳制),呈现步恒合法
  const stepIndex = Math.min(progress.current, GAME_GUIDE_STEPS.length - 1);
  const stepId = GAME_GUIDE_STEPS[stepIndex]!;
  const stepCopy = copy.steps[stepId];

  const decide = useCallback((decision: GameGuideDecision) => {
    setProgress((current) => {
      const next = decideGameGuideStep(current, decision);
      saveGameGuideProgress(next);
      return next;
    });
  }, []);

  const restart = useCallback(() => {
    const next = restartGameGuide();
    saveGameGuideProgress(next);
    setProgress(next);
  }, []);

  const hide = useCallback(() => {
    void window.vua?.window.hideGameGuide?.().catch(() => {});
  }, []);

  // Esc = 显式隐藏(隐藏不销毁,顶栏重开恢复;进度已实时落盘)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hide]);

  const changeOpacity = useCallback((value: number) => {
    const next = normalizeGameGuideOpacity(value);
    setOpacity(next);
    saveGameGuideOpacity(next);
  }, []);

  // 挂载即把持久化的跟随偏好推送 Main(强制执行在 Main;本窗口可能晚于
  // 上次开关操作重建)
  useEffect(() => {
    void window.vua?.window.setGameGuideFollowing?.(loadGameGuideFollowing().enabled).catch(() => {});
  }, []);

  const changeFollowing = useCallback((enabled: boolean) => {
    setFollowing(enabled);
    saveGameGuideFollowing(enabled);
    void window.vua?.window.setGameGuideFollowing?.(enabled).catch(() => {});
  }, []);

  // 跟随开启时轮询跟随状态(1s):仅在观察非 ready 时如实提示;跟随关闭
  // 不呈现也不轮询。状态读取失败保持上一次读数,不伪造 ready
  useEffect(() => {
    if (!following) {
      setFollowStatus(null);
      return;
    }
    let cancelled = false;
    const poll = () => {
      window.vua?.window.getGameGuideFollowStatus?.()
        .then((status) => {
          if (!cancelled) setFollowStatus(status);
        })
        .catch(() => {});
    };
    poll();
    const timer = window.setInterval(poll, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [following]);

  return (
    <div className="vua-game-guide">
      <div className="vua-game-guide__panel" style={{ "--vua-guide-opacity": opacity } as CSSProperties}>
        <header className="vua-game-guide__titlebar">
          <h1 className="vua-game-guide__title">{copy.title}</h1>
          <div className="vua-game-guide__titlebar-actions">
            <label className="vua-game-guide__opacity" title={copy.opacityLabel}>
              <Icon name="gauge" size={16} />
              <input
                type="range"
                min={20}
                max={100}
                value={Math.round(opacity * 100)}
                aria-label={copy.opacityLabel}
                onChange={(e) => changeOpacity(Number(e.target.value) / 100)}
              />
            </label>
            <button
              type="button"
              className="vua-game-guide__chrome"
              aria-label={copy.hide}
              title={copy.hide}
              onClick={hide}
            >
              <Icon name="minimize" size={16} />
            </button>
          </div>
        </header>
        <div className="vua-game-guide__followbar">
          <label className="vua-game-guide__follow" title={copy.followLabel}>
            <input
              type="checkbox"
              checked={following}
              aria-label={copy.followLabel}
              onChange={(e) => changeFollowing(e.target.checked)}
            />
            <span>{copy.followLabel}</span>
          </label>
          {following && followStatus !== null && followStatus.observation !== "ready" ? (
            <p className="vua-game-guide__follow-status" role="status">
              {followStatus.observation === "absent"
                ? copy.followStatusAbsent
                : followStatus.observation === "waiting"
                  ? copy.followStatusWaiting
                  : copy.followStatusUnknown}
            </p>
          ) : null}
        </div>
        <main className="vua-game-guide__body">
          {complete ? (
            <div className="vua-game-guide__step" data-complete>
              <h2 className="vua-game-guide__step-title">{copy.allDoneTitle}</h2>
              <p className="vua-game-guide__paragraph">{copy.allDone}</p>
              <Button variant="default" onClick={restart}>{copy.restart}</Button>
            </div>
          ) : (
            <div className="vua-game-guide__step">
              <p className="vua-game-guide__counter">
                {format(strings.onboarding.steps.counter, {
                  current: stepIndex + 1,
                  total: GAME_GUIDE_STEPS.length,
                })}
              </p>
              <h2 className="vua-game-guide__step-title">{stepCopy.title}</h2>
              {stepCopy.body.map((paragraph) => (
                <p key={paragraph} className="vua-game-guide__paragraph">{paragraph}</p>
              ))}
              <div className="vua-game-guide__actions">
                <Button variant="default" onClick={() => decide("skipped")}>{copy.skip}</Button>
                <Button variant="primary" onClick={() => decide("confirmed")}>{copy.confirm}</Button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
