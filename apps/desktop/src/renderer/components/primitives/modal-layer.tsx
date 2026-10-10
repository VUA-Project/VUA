import { createContext, useContext, useId, useLayoutEffect, useRef } from "react";

/** Shared modal ownership includes body portals (the remote-browser toolbar). */
export const ModalOwnerContext = createContext<string | null>(null);
export function useModalOwner(): string | undefined {
  return useContext(ModalOwnerContext) ?? undefined;
}
interface Layer {
  id: string;
  parent: string | null;
  panel: HTMLElement;
  overlay: HTMLElement;
  close: () => void;
  previous: HTMLElement | null;
}
const layers: Layer[] = [];
const isolated = new Map<HTMLElement, { inert: boolean; aria: string | null }>();
let observer: MutationObserver | null = null;
let queued = false;
function top(): Layer | undefined {
  const depth = (layer: Layer): number => {
    const parent = layers.find((candidate) => candidate.id === layer.parent);
    return parent ? depth(parent) + 1 : 0;
  };
  return [...layers].sort((a, b) => depth(a) - depth(b)).at(-1);
}
function portals(layer: Layer): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-vua-modal-owner]")]
    .filter((element) => element.dataset.vuaModalOwner === layer.id);
}
function browserShell(layer: Layer): HTMLElement[] {
  return portals(layer).some(element => element.matches('[data-vua-browser-active="true"]'))
    ? [...document.querySelectorAll<HTMLElement>(".vua-shell__header, .vua-shell__sidebar")] : [];
}
function roots(layer: Layer): HTMLElement[] { return [layer.panel, ...portals(layer), ...browserShell(layer)]; }
/** Leaving a browser-backed import must dismiss its modal before entering Settings. */
export function closeBrowserModal(): void {
  const layer = top();
  if (layer && browserShell(layer).length > 0) layer.close();
}
function contains(layer: Layer, node: Node | null): boolean {
  return node !== null && roots(layer).some((root) => root.contains(node));
}
function focusable(layer: Layer): HTMLElement[] {
  return roots(layer).flatMap((root) => [...root.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex], [contenteditable="true"]',
  )]).filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") &&
    !element.closest("[inert], [hidden]") && element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== "hidden");
}
function focusFirst(layer: Layer): void {
  const candidates = focusable(layer);
  (candidates.find((element) => element.hasAttribute("autofocus")) ?? candidates[0] ?? layer.panel).focus();
}
function restoreIsolation(): void {
  for (const [element, before] of isolated) {
    element.inert = before.inert;
    if (before.aria === null) element.removeAttribute("aria-hidden");
    else element.setAttribute("aria-hidden", before.aria);
  }
  isolated.clear();
}
function refresh(): void {
  restoreIsolation();
  const layer = top();
  if (!layer) return;
  const allowed = [layer.overlay, ...portals(layer), ...browserShell(layer)];
  const visit = (element: HTMLElement): void => {
    if (allowed.includes(element)) return;
    if (allowed.some((root) => element.contains(root))) {
      for (const child of element.children) if (child instanceof HTMLElement) visit(child);
    } else {
      isolated.set(element, { inert: element.inert, aria: element.getAttribute("aria-hidden") });
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }
  };
  for (const child of document.body.children) if (child instanceof HTMLElement) visit(child);
  if (!contains(layer, document.activeElement) || document.activeElement?.matches(":disabled, [hidden]"))
    focusFirst(layer);
}
function scheduleRefresh(): void {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; refresh(); });
}
function keydown(event: KeyboardEvent): void {
  const layer = top();
  if (!layer) return;
  if (event.key === "Escape") {
    // 层内局部 Esc 语义 opt-out(2026-09-25 文件夹选择器路径输入:Esc =
    // 取消编辑,非关闭弹窗):事件目标位于声明 [data-vua-esc-local] 的
    // 子树时,本层不拦截——目标元素自行经冒泡 onKeyDown 处理;未声明处
    // 行为不变(Esc 恒关顶层弹窗)。焦点管理由使用方负责(取消编辑后
    // 焦点须移出局部区,否则后续 Esc 仍被局部吞掉)
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("[data-vua-esc-local]")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    layer.close();
  } else if (event.key === "Tab") {
    const candidates = focusable(layer);
    const index = candidates.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    if (candidates.length === 0) layer.panel.focus();
    else {
      const next = index < 0 ? (event.shiftKey ? candidates.length - 1 : 0)
        : (index + (event.shiftKey ? -1 : 1) + candidates.length) % candidates.length;
      candidates[next]?.focus();
    }
  }
}
function focusin(event: FocusEvent): void {
  const layer = top();
  if (layer && !contains(layer, event.target as Node)) focusFirst(layer);
}
export function useModalLayer(open: boolean, close: () => void) {
  const id = useId();
  const parent = useContext(ModalOwnerContext);
  const panelRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useLayoutEffect(() => {
    if (!open || !panelRef.current || !overlayRef.current) return;
    const layer: Layer = { id, parent, panel: panelRef.current, overlay: overlayRef.current,
      close: () => closeRef.current(),
      previous: document.activeElement instanceof HTMLElement ? document.activeElement : null };
    layers.push(layer);
    if (!observer) {
      document.addEventListener("keydown", keydown, true);
      document.addEventListener("focusin", focusin, true);
      observer = new MutationObserver(scheduleRefresh);
      observer.observe(document.body, { childList: true, subtree: true, attributes: true,
        attributeFilter: ["disabled", "hidden", "tabindex", "data-vua-modal-owner", "data-vua-browser-active"] });
    }
    scheduleRefresh();
    return () => {
      const wasTop = top() === layer;
      layers.splice(layers.indexOf(layer), 1);
      restoreIsolation();
      if (!layers.length) {
        observer?.disconnect(); observer = null;
        document.removeEventListener("keydown", keydown, true);
        document.removeEventListener("focusin", focusin, true);
      }
      // Restore after the removed modal DOM has gone; StrictMode remounts are
      // handled by checking the new top layer before returning focus.
      queueMicrotask(() => {
        refresh();
        const current = top();
        if (wasTop && layer.previous?.isConnected && !layer.previous.closest("[inert]") &&
          (!current || contains(current, layer.previous))) layer.previous.focus();
      });
    };
  }, [open, id, parent]);
  return { id, panelRef, overlayRef, closeTop: () => { if (top()?.id === id) closeRef.current(); } };
}
