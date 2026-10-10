import type { RemoteContentEventV1, RemoteContentViewStateV1 } from "./desktop-gateway.js";

/** Candidate desktop-browser v0.1: fixed public entries, never page contents or credentials. */
export const DESKTOP_BROWSER_SITES_V1 = [
  { id: "vrchat-wiki", name: "VRChat Wiki", url: "https://wiki.vrchat.com/", purpose: "knowledge" },
  { id: "booth", name: "BOOTH", url: "https://booth.pm/", purpose: "assets" },
  { id: "vrcfinder", name: "VRCFinder", url: "https://vrcfinder.net/", purpose: "assets" },
  { id: "boothplorer", name: "BOOTHPLORER", url: "https://boothplorer.com/", purpose: "assets" },
  { id: "yorimichi", name: "Yorimichi", url: "https://yorimichi.cc/", purpose: "assets" },
  { id: "polyseek", name: "PolySeek", url: "https://polyseek.jp/", purpose: "assets" },
  { id: "vrc-style", name: "VRC STYLE", url: "https://vrc-style.com/", purpose: "assets" },
  { id: "avatar-network", name: "Avatar Network", url: "https://avatar-network.herokuapp.com/", purpose: "assets" },
  { id: "avatar-catalog", name: "Avatar Catalog", url: "https://avatar-catalog.com/", purpose: "assets" },
  { id: "vrc-db", name: "VRC DB", url: "https://vrc-db.com/", purpose: "assets" },
] as const;
export type DesktopBrowserSiteIdV1 = typeof DESKTOP_BROWSER_SITES_V1[number]["id"];
export function desktopBrowserSite(value: unknown): typeof DESKTOP_BROWSER_SITES_V1[number] | null {
  return DESKTOP_BROWSER_SITES_V1.find(site => site.id === value) ?? null;
}

/** Display metadata only: account handoff query/fragment/authority secrets stay in Main. */
export function desktopBrowserDisplayUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    return url.toString();
  } catch { return ""; }
}

/** CSS viewport pixels; Main applies zoom and clamps them to its own content bounds. */
export interface DesktopBrowserViewportV1 {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export function isDesktopBrowserViewportV1(value: unknown): value is DesktopBrowserViewportV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 4) return false;
  return ["x", "y", "width", "height"].every(key =>
    typeof record[key] === "number" && Number.isFinite(record[key]) && record[key] >= 0 && record[key] <= 32_768);
}
export type DesktopBrowserLoadEventV1 =
  | { readonly kind: "loading"; readonly viewId: string; readonly loading: boolean }
  | { readonly kind: "load-failed"; readonly viewId: string; readonly code: number };
export type DesktopBrowserEventV1 = RemoteContentEventV1 | DesktopBrowserLoadEventV1;
export interface DesktopBrowserApiV1 {
  open(site: DesktopBrowserSiteIdV1): Promise<RemoteContentViewStateV1>;
  navigate(viewId: string, site: DesktopBrowserSiteIdV1): Promise<RemoteContentViewStateV1>;
  goBack(viewId: string): Promise<RemoteContentViewStateV1>;
  goForward(viewId: string): Promise<RemoteContentViewStateV1>;
  reload(viewId: string): Promise<RemoteContentViewStateV1>;
  close(viewId: string): Promise<void>;
  /** Also lays out retained RemoteContentApiV1 views. Null temporarily hides the view. */
  setViewport(viewId: string, viewport: DesktopBrowserViewportV1 | null): Promise<void>;
  events: { subscribe(listener: (event: DesktopBrowserEventV1) => void): () => void };
}
