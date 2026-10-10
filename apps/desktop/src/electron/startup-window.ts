import { BrowserWindow, type WebPreferences } from "electron";

/** A presentation-only window; no Gateway, account or installation work runs here. */
export async function createStartupWindow(options: {
  rendererUrl?: string;
  rendererFile: string;
  preferences: WebPreferences;
}): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 480, height: 320, useContentSize: true, frame: false, thickFrame: false, show: false,
    resizable: false, maximizable: false, minimizable: false,
    backgroundColor: "#ffffff", title: "VUA", webPreferences: options.preferences,
  });
  window.center();
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", event => event.preventDefault());
  window.once("ready-to-show", () => { if (!window.isDestroyed()) window.show(); });
  if (options.rendererUrl) {
    const url = new URL(options.rendererUrl);
    url.searchParams.set("surface", "splash");
    await window.loadURL(url.toString());
  } else await window.loadFile(options.rendererFile, { query: { surface: "splash" } });
  return window;
}
