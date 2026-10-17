import { useEffect, useRef, useState } from "react";
import { format, strings } from "../../i18n/index.ts";
import { useSceneMode } from "../three/useSceneMode.ts";
import "./turntable.css";

/**
 * Unity 烘焙转盘播放器(共享组件):读取 BridgePreviewBake 产出的 manifest.json,
 * 全部帧先 decode 进内存(带进度条),再用 canvas 切帧播放——避免 <img> 换 src
 * 的即时解码卡顿;时间驱动帧步进(3s/圈),60 帧下每秒 20 次换帧。
 * 指针拖拽手动转,自动旋转仅在 sceneMode === "animated"(非资源节约/非减少动态)
 * 时开启。烘焙未完成时 fetch 404,走 failed 诚实态,由调用方卡片层给提示。
 *
 * 使用方:预览实验室(dev/preview-lab)与出厂页烘焙预览(DEV 接线)。
 */

export type TurntableStatus = "loading" | "ready" | "failed";

/** BridgePreviewBake PreviewManifest(schemaVersion 1)字段镜像 */
export interface BakeManifest {
  schemaVersion: number;
  commandId: string;
  avatarName: string;
  bakedAt: string;
  basis: string;
  frames: number;
  width: number;
  height: number;
  framePattern: string;
  cover: string;
  triangles: number;
  materialSlots: number;
  skinnedMeshRenderers: number;
  bones: number;
}

type Phase =
  | { state: "manifest" }
  | { state: "frames"; manifest: BakeManifest; loaded: number; coverUrl: string }
  | { state: "ready"; manifest: BakeManifest }
  | { state: "failed" };

/** "frames/frame_{0:D2}.png" + 3 → "frames/frame_03.png";不识别的模式回退默认 */
function frameFile(pattern: string, index: number): string {
  const padded = String(index).padStart(2, "0");
  return pattern.includes("{0:D2}")
    ? pattern.replace("{0:D2}", padded)
    : `frames/frame_${padded}.png`;
}

function wrap(index: number, count: number): number {
  return ((index % count) + count) % count;
}

/** 自动旋转一圈的秒数;60 帧下 = 每秒 20 次换帧 */
const REVOLUTION_SECONDS = 3;
/** 拖拽灵敏度:每 8px 换一帧 */
const DRAG_PIXELS_PER_FRAME = 8;

const copy = strings.previewLab;

export function TurntablePlayer({
  manifestPath,
  urlFor,
  onStatus,
  manifest: given,
}: {
  /** 相对 urlFor 基座的 manifest.json 路径 */
  manifestPath: string;
  urlFor: (rel: string) => string;
  onStatus: (status: TurntableStatus) => void;
  /** A manifest the caller already holds, e.g. frames read through the Gateway as data URLs. */
  manifest?: BakeManifest;
}) {
  const mode = useSceneMode();
  const [phase, setPhase] = useState<Phase>({ state: "manifest" });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const framesRef = useRef<HTMLImageElement[]>([]);
  const frameRef = useRef(0);
  /** 旋转相位(秒),拖拽结束后自动旋转从当前帧继续而不是跳变 */
  const phaseRef = useRef(0);
  const dragRef = useRef<{ pointerId: number; startX: number; startIndex: number } | null>(
    null,
  );
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;

  const frameCount =
    phase.state === "frames" || phase.state === "ready" ? phase.manifest.frames : 0;

  const draw = (index: number) => {
    const canvas = canvasRef.current;
    const frames = framesRef.current;
    if (!canvas || frames.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = frames[wrap(index, frames.length)];
    // 个别帧解码失败时跳过(画面停在上一帧),不阻塞整体播放
    if (!img || img.naturalWidth === 0) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };

  // 加载:manifest → 逐帧 decode 计数(进度条)→ ready
  useEffect(() => {
    let cancelled = false;
    statusRef.current("loading");
    setPhase({ state: "manifest" });
    framesRef.current = [];
    (given !== undefined
      ? Promise.resolve(given)
      : fetch(urlFor(manifestPath)).then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json() as Promise<BakeManifest>;
        }))
      .then((manifest) => {
        if (cancelled) return;
        const base = manifestPath.slice(0, manifestPath.lastIndexOf("/") + 1);
        const frameUrls = Array.from({ length: manifest.frames }, (_, i) =>
          urlFor(base + frameFile(manifest.framePattern, i)),
        );
        const coverUrl = urlFor(base + manifest.cover);
        setPhase({ state: "frames", manifest, loaded: 0, coverUrl });
        const images = frameUrls.map((url) => {
          const img = new Image();
          img.src = url;
          return img;
        });
        let loaded = 0;
        let failed = 0;
        const settle = (ok: boolean) => {
          if (cancelled) return;
          loaded += 1;
          if (!ok) failed += 1;
          if (loaded < images.length) {
            setPhase({ state: "frames", manifest, loaded, coverUrl });
            return;
          }
          if (failed === images.length) {
            setPhase({ state: "failed" });
            statusRef.current("failed");
            return;
          }
          framesRef.current = images;
          frameRef.current = 0;
          phaseRef.current = 0;
          setPhase({ state: "ready", manifest });
          statusRef.current("ready");
        };
        // decode() 等到整帧解码完成才计数,保证播放时 drawImage 不再现解码卡顿
        for (const img of images) img.decode().then(() => settle(true), () => settle(false));
      })
      .catch(() => {
        if (cancelled) return;
        setPhase({ state: "failed" });
        statusRef.current("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [manifestPath, urlFor, given]);

  // ready 后:画首帧;animated 模式下时间驱动自动旋转(static/off 只留拖拽)
  useEffect(() => {
    if (phase.state !== "ready") return;
    draw(frameRef.current);
    if (mode !== "animated") return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (dragRef.current === null && frameCount > 0) {
        phaseRef.current += dt;
        const index =
          Math.floor((phaseRef.current / REVOLUTION_SECONDS) * frameCount) % frameCount;
        if (index !== frameRef.current) {
          frameRef.current = index;
          draw(index);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, phase.state, frameCount]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (phase.state !== "ready") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startIndex: frameRef.current,
    };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || frameCount === 0) return;
    // 向右拖 = 顺帧序
    const delta = Math.round((event.clientX - drag.startX) / DRAG_PIXELS_PER_FRAME);
    const index = wrap(drag.startIndex + delta, frameCount);
    if (index === frameRef.current) return;
    frameRef.current = index;
    // 旋转相位对齐当前帧,松手后从这里继续转
    phaseRef.current = (index / frameCount) * REVOLUTION_SECONDS;
    draw(index);
  };
  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  return (
    <div
      className="vua-turntable"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      {phase.state === "frames" && (
        <>
          <img
            className="vua-turntable__poster"
            src={phase.coverUrl}
            alt={phase.manifest.avatarName}
            draggable={false}
          />
          <div
            className="vua-turntable__progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={phase.manifest.frames}
            aria-valuenow={phase.loaded}
          >
            <div className="vua-turntable__progress-track">
              <div
                className="vua-turntable__progress-fill"
                style={{
                  width: `${Math.round((phase.loaded / phase.manifest.frames) * 100)}%`,
                }}
              />
            </div>
            <div className="vua-turntable__progress-text">
              {format(copy.loadingFrames, {
                loaded: phase.loaded,
                total: phase.manifest.frames,
              })}
            </div>
          </div>
        </>
      )}
      {phase.state === "ready" && (
        <>
          <canvas
            ref={canvasRef}
            className="vua-turntable__canvas"
            width={phase.manifest.width}
            height={phase.manifest.height}
          />
          <span className="vua-turntable__hint">{copy.dragHint}</span>
          <span className="vua-turntable__meta">
            {format(copy.bakedMeta, {
              frames: phase.manifest.frames,
              width: phase.manifest.width,
              height: phase.manifest.height,
              triangles: phase.manifest.triangles,
            })}
          </span>
        </>
      )}
    </div>
  );
}
