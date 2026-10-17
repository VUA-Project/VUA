/** The album: one spread per finished Avatar. A page turns over the spine like a photo album; with
 * reduced motion, or on a narrow window where the pages stack, the next spread fades in; in
 * resource-saving mode the album cuts straight to the next spread. All motion is scripted. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { Icon } from "@vua/design-system";
import { useEffectsOn } from "../RoomCanvas.tsx";
import { format, strings } from "../../../i18n/index.ts";
import { ALBUM_MOTION, dragProgress, durationOf, easingOf, turnCompletes, turnTo, type Turn, type TurnDirection } from "./release-model.ts";

const copy = strings.releaseRoom;
type Motion = "turn" | "fade" | "cut";

export interface AlbumSpread {
  readonly key: string;
  readonly tab: string;
  readonly left: (live: boolean) => ReactNode;
  readonly right: (live: boolean) => ReactNode;
}

/** Durations and easing as the tokens set them now. */
function motionTokens() {
  const style = getComputedStyle(document.documentElement);
  return {
    turn: durationOf(style.getPropertyValue(ALBUM_MOTION.turnDuration), 560),
    fade: durationOf(style.getPropertyValue(ALBUM_MOTION.fadeDuration), 300),
    ease: easingOf(style.getPropertyValue(ALBUM_MOTION.easing)),
  };
}

function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const list = matchMedia(query);
    const update = () => setReduced(list.matches);
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, []);
  return reduced;
}

function Page({ side, children, inert }: { side: "left" | "right"; children: ReactNode; inert?: boolean }) {
  return <section className="vua-album__page" data-side={side} inert={inert || undefined} aria-hidden={inert || undefined}>
    <span className="vua-album__ornament" data-place="top" data-skin-slot={`album-page-${side}-top`} />
    {children}
    <span className="vua-album__ornament" data-place="bottom" data-skin-slot={`album-page-${side}-bottom`} />
  </section>;
}

/** The open album at one spread, or with one leaf turning from `turn.from` to `turn.to`. */
export function AlbumBook({ spreads, index, turn, progress, bookRef, onCorner, onStep }: {
  spreads: readonly AlbumSpread[]; index: number; turn: Turn | null; progress: number;
  bookRef?: RefObject<HTMLDivElement | null>; onCorner?: (direction: TurnDirection, event: PointerEvent<HTMLButtonElement>) => void;
  /** Keyboard activation of a page corner. */
  onStep?: (steps: number) => void;
}) {
  const current = spreads[index];
  if (!current) return null;
  const style = { "--turn": progress } as CSSProperties;
  if (turn === null) {
    return <div className="vua-album__book" ref={bookRef} style={style}>
      <Page side="left">{current.left(true)}</Page>
      <Page side="right">{current.right(true)}</Page>
      {onCorner && index > 0 && <button type="button" className="vua-album__dogear" data-side="left" aria-label={copy.previous}
        onPointerDown={event => onCorner("prev", event)} onClick={() => onStep?.(-1)} />}
      {onCorner && index < spreads.length - 1 && <button type="button" className="vua-album__dogear" data-side="right" aria-label={copy.next}
        onPointerDown={event => onCorner("next", event)} onClick={() => onStep?.(1)} />}
    </div>;
  }
  const target = spreads[turn.to] ?? current;
  const next = turn.direction === "next";
  return <div className="vua-album__book" ref={bookRef} style={style} data-turning={turn.direction}>
    <Page side="left" inert>{(next ? current : target).left(false)}</Page>
    <Page side="right" inert>{(next ? target : current).right(false)}</Page>
    <div className="vua-album__leaf" data-direction={turn.direction} aria-hidden="true">
      <div className="vua-album__face" data-face="front" inert>
        <Page side={next ? "right" : "left"}>{next ? current.right(false) : current.left(false)}</Page>
      </div>
      <div className="vua-album__face" data-face="back" inert>
        <Page side={next ? "left" : "right"}>{next ? target.left(false) : target.right(false)}</Page>
      </div>
    </div>
  </div>;
}

/** An index tab: the spread being viewed grows out of the album and settles back when the reader moves on.
 * Scripted with the Web Animations API, so Windows' animation setting does not flatten it; resource-saving mode sets the size at once. */
function AlbumTab({ active, title, number, onSelect }: { active: boolean; title: string; number: number; onSelect: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const effects = useEffectsOn();
  const shown = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    const element = button.current; if (!element) return;
    const scale = (on: boolean) => on ? `scale(${ALBUM_MOTION.tabScale})` : "scale(1)";
    const first = shown.current === null; shown.current = active;
    if (first || !effects || typeof element.animate !== "function") { element.style.transform = scale(active); return; }
    const style = getComputedStyle(document.documentElement);
    const animation = element.animate([{ transform: getComputedStyle(element).transform === "none" ? scale(!active) : getComputedStyle(element).transform }, { transform: scale(active) }],
      { duration: durationOf(style.getPropertyValue(ALBUM_MOTION.fadeDuration), 300), easing: style.getPropertyValue(ALBUM_MOTION.easing).trim() || "ease-out", fill: "forwards" });
    animation.onfinish = () => { element.style.transform = scale(active); animation.cancel(); };
    return () => animation.cancel();
  }, [active, effects]);
  return <button ref={button} type="button" aria-current={active || undefined} title={title} onClick={onSelect}>
    <span>{String(number).padStart(2, "0")}</span><span>{title}</span></button>;
}

export function ReleaseAlbum({ spreads, index, onIndex }: { spreads: readonly AlbumSpread[]; index: number; onIndex: (index: number) => void }) {
  const effects = useEffectsOn();
  const reduced = useReducedMotion();
  const root = useRef<HTMLElement>(null);
  const book = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [faded, setFaded] = useState(0);
  const progress = useRef(0);
  const frame = useRef(0);
  const drag = useRef<{ pointer: number; startX: number; width: number } | null>(null);
  const chosen = useRef(onIndex);
  chosen.current = onIndex;
  const motion: Motion = !effects ? "cut" : reduced || narrow ? "fade" : "turn";

  useEffect(() => {
    const element = root.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setNarrow((entry?.contentRect.width ?? ALBUM_MOTION.narrowWidth) < ALBUM_MOTION.narrowWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const paint = (value: number) => { progress.current = value; book.current?.style.setProperty("--turn", String(value)); };
  /** Runs `step` from 0 to 1 over `duration`, then `done`; resource-saving mode jumps to the end. */
  const play = useCallback((duration: number, step: (t: number) => void, done: () => void) => {
    cancelAnimationFrame(frame.current);
    if (document.documentElement.dataset.effects === "off" || duration <= 0) { step(1); done(); return; }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      step(t);
      if (t < 1) frame.current = requestAnimationFrame(tick); else done();
    };
    frame.current = requestAnimationFrame(tick);
  }, []);
  const settle = useCallback((to: number, done: () => void) => {
    const tokens = motionTokens();
    const from = progress.current;
    play(tokens.turn * Math.abs(to - from), t => paint(from + (to - from) * tokens.ease(t)), done);
  }, [play]);
  const finish = useCallback((done: Turn, completed: boolean) => {
    if (completed) chosen.current(done.to);
    setTurn(null); paint(0);
  }, []);

  const go = (target: number) => {
    if (turn !== null) return;
    const next = turnTo(index, target, spreads.length);
    if (!next) return;
    if (motion === "turn") { paint(0); setTurn(next); return; }
    onIndex(target);
    if (motion === "fade") setFaded(count => count + 1);
  };
  // A turn started by a button or key plays once its leaf is on screen; a dragged turn follows the pointer.
  useLayoutEffect(() => {
    if (turn === null || drag.current !== null) return;
    settle(1, () => finish(turn, true));
  }, [turn, settle, finish]);
  // The next spread fades in, scripted so it plays the same whatever the system's animation setting.
  useLayoutEffect(() => {
    const element = book.current;
    if (faded === 0 || !element) return;
    const tokens = motionTokens();
    play(tokens.fade, t => { element.style.opacity = String(ALBUM_MOTION.fadeFrom + (1 - ALBUM_MOTION.fadeFrom) * tokens.ease(t)); },
      () => { element.style.removeProperty("opacity"); });
  }, [faded, play]);

  const onCorner = (direction: TurnDirection, event: PointerEvent<HTMLButtonElement>) => {
    // Without a turning leaf the corner's click turns the page.
    if (motion !== "turn") return;
    const target = turnTo(index, index + (direction === "next" ? 1 : -1), spreads.length);
    if (!target) return;
    const width = book.current?.getBoundingClientRect().width ?? 1;
    root.current?.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, startX: event.clientX, width };
    paint(0); setTurn(target);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId || turn === null) return;
    paint(dragProgress(turn.direction, current.startX, event.clientX, current.width));
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId || turn === null) return;
    drag.current = null;
    // A tap on the corner turns the page; a drag completes past the configured share of the way.
    const complete = Math.abs(event.clientX - current.startX) < ALBUM_MOTION.tapPixels || turnCompletes(progress.current);
    const active = turn;
    settle(complete ? 1 : 0, () => finish(active, complete));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true']")) return;
    if (event.key === "ArrowRight" || event.key === "PageDown") { event.preventDefault(); go(index + 1); }
    if (event.key === "ArrowLeft" || event.key === "PageUp") { event.preventDefault(); go(index - 1); }
  };

  return <section ref={root} className="vua-album" data-narrow={narrow || undefined} aria-label={copy.albumLabel} aria-roledescription="carousel"
    onKeyDown={onKeyDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
    <div className="vua-album__binder">
      <AlbumBook spreads={spreads} index={index} turn={turn} progress={progress.current} bookRef={book} onCorner={onCorner} onStep={steps => go(index + steps)} />
      {spreads.length > 1 && <ol className="vua-album__tabs" aria-label={copy.albumLabel}>
        {spreads.map((spread, at) => <li key={spread.key}><AlbumTab active={at === index} title={spread.tab} number={at + 1} onSelect={() => go(at)}/></li>)}
      </ol>}
    </div>
    <nav className="vua-album__nav" aria-label={copy.albumLabel}>
      <button type="button" onClick={() => go(index - 1)} disabled={index === 0 || turn !== null} aria-label={copy.previous}><Icon name="arrow-left" size={16} /></button>
      <span aria-live="polite">{format(copy.pageOf, { page: index + 1, total: spreads.length })}</span>
      <button type="button" onClick={() => go(index + 1)} disabled={index >= spreads.length - 1 || turn !== null} aria-label={copy.next}><Icon name="arrow-right" size={16} /></button>
      {spreads.length > 1 && <small className="vua-text-secondary">{copy.turnHint}</small>}
    </nav>
  </section>;
}
