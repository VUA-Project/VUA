import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./browser-frame.css";

type Frame = { x: number; y: number; width: number; height: number; visible: boolean };
const empty: Frame = { x: 0, y: 0, width: 0, height: 0, visible: false };

/** Only the local shell measures layout; the native view receives bounded geometry. */
export function BrowserFrame({ viewId, children, modalOwner, status, hideContent = false }: {
  viewId: string; children: ReactNode; modalOwner?: string | undefined; status?: ReactNode; hideContent?: boolean;
}) {
  const owner = useRef<HTMLSpanElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const portal = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Frame>(empty);
  useLayoutEffect(() => {
    const main = document.querySelector<HTMLElement>(".vua-shell__main");
    const bounds = main ?? document.documentElement;
    let scheduled = 0;
    const measure = () => {
      const rect = bounds.getBoundingClientRect();
      const visible = owner.current?.getClientRects().length !== 0 && !owner.current?.closest("[hidden], [inert]") && !portal.current?.inert;
      const next = { x: rect.x, y: rect.y, width: rect.width, height: rect.height, visible: Boolean(visible) };
      setFrame(previous => Object.keys(next).every(key => previous[key as keyof Frame] === next[key as keyof Frame]) ? previous : next);
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = requestAnimationFrame(() => { scheduled = 0; measure(); });
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(bounds);
    if (owner.current) resize.observe(owner.current);
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "inert"] });
    window.addEventListener("resize", schedule);
    measure();
    return () => { resize.disconnect(); observer.disconnect(); window.removeEventListener("resize", schedule); cancelAnimationFrame(scheduled); };
  }, []);

  useLayoutEffect(() => {
    const browser = window.vua?.desktopBrowser;
    let previous = "";
    const measure = () => {
      const rect = viewport.current?.getBoundingClientRect();
      const value = frame.visible && !hideContent && rect && rect.width > 0 && rect.height > 0
        ? { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: rect.width, height: rect.height } : null;
      const key = JSON.stringify(value);
      if (key === previous) return;
      previous = key;
      void browser?.setViewport(viewId, value).catch(() => { /* The owner handles closed views. */ });
      if (frame.visible) {
        document.body.dataset.vuaBrowserView = viewId;
        document.body.style.setProperty("--vua-browser-left", `${frame.x}px`);
        document.body.style.setProperty("--vua-browser-top", `${frame.y}px`);
      } else if (document.body.dataset.vuaBrowserView === viewId) delete document.body.dataset.vuaBrowserView;
    };
    const resize = new ResizeObserver(measure);
    if (viewport.current) resize.observe(viewport.current);
    measure();
    return () => {
      resize.disconnect();
      void browser?.setViewport(viewId, null).catch(() => {});
      if (document.body.dataset.vuaBrowserView === viewId) delete document.body.dataset.vuaBrowserView;
    };
  }, [viewId, frame, hideContent]);

  return <>
    <span ref={owner} className="vua-browser-owner" aria-hidden="true" />
    {createPortal(<div ref={portal} className="vua-browser-frame" data-module={owner.current?.closest<HTMLElement>("[data-module]")?.dataset.module} data-vua-browser-frame data-vua-browser-active={frame.visible ? "true" : undefined}
      data-vua-modal-owner={modalOwner} hidden={!frame.visible}
      style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}>
      {children}
      <div ref={viewport} className="vua-browser-frame__viewport">{status}</div>
    </div>, document.body)}
  </>;
}
