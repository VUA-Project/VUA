import { useEffect, useRef, useState } from "react";
import { strings } from "../../i18n/index.ts";
import { bootProgress } from "../../app/boot-progress.ts";
import { storageKeys } from "../../app/storage-keys.ts";
import { BOOT_PROGRESS_CAP_MS, splashShouldExit } from "./boot-progress-model.ts";
import { SPLASH_FADE_MS, buildSplashRays, splashVisibleMs } from "./boot-splash-model.ts";
import logo from "./vua-level-dark.png";
import "./boot-splash.css";

function flattenStartupMotion(): boolean {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  try { return localStorage.getItem(storageKeys.effects) === "off"; }
  catch { return false; }
}

/** Real renderer/Gateway/provider/paint readiness, independent of its native presentation. */
export function BootGate({ onDone }: { onDone: () => void }) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    const started = performance.now();
    const flattened = flattenStartupMotion();
    const budgetMs = splashVisibleMs(flattened);
    let finished = false;
    const check = () => {
      if (finished || !splashShouldExit({ elapsedMs: performance.now() - started, budgetMs, flattened, allReached: bootProgress.allReached() })) return;
      finished = true;
      onDoneRef.current();
    };
    const budgetTimer = window.setTimeout(check, budgetMs + 1);
    const capTimer = window.setTimeout(check, BOOT_PROGRESS_CAP_MS + 1);
    const unsubscribe = bootProgress.subscribe(check);
    return () => {
      finished = true;
      unsubscribe();
      window.clearTimeout(budgetTimer);
      window.clearTimeout(capTimer);
    };
  }, []);
  return null;
}

/** Plays once; Main owns the lifetime of the small, frameless native startup window. */
export function BootSplash({ onDone }: { onDone?: () => void }) {
  const [flattened] = useState(flattenStartupMotion);
  const [leaving, setLeaving] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 480, height: 320 });
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const observer = new ResizeObserver(() => setSize({ width: surface.clientWidth, height: surface.clientHeight }));
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => onDone?.(), flattened ? 0 : SPLASH_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving, onDone, flattened]);
  return (
    <div className={`vua-boot-splash${leaving ? " vua-boot-splash--leaving" : ""}`} role="status" aria-label={strings.bootSplash.starting}>
      {onDone ? <BootGate onDone={() => setLeaving(true)} /> : null}
      <div className="vua-boot-splash__surface" ref={surfaceRef} data-static={flattened || undefined}>
        <div className="vua-boot-splash__rays" aria-hidden="true">
          {buildSplashRays(size.width, size.height).map((ray, index) => (
            <div className="vua-boot-splash__ray-track" key={index} style={{ left: ray.left, top: ray.top }}>
              <div className="vua-boot-splash__ray" style={{ top: -ray.thickness / 2, width: ray.length, height: ray.thickness, animationDelay: `${ray.delayMs}ms` }} />
            </div>
          ))}
        </div>
        <div className="vua-boot-splash__content" aria-hidden="true">
          <img className="vua-boot-splash__logo" src={logo} alt="" width={992} height={992} draggable={false} />
          <div className="vua-boot-splash__loader" />
        </div>
      </div>
    </div>
  );
}
