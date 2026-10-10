import { describe, expect, it } from "vitest";
import { DESKTOP_BROWSER_SITES_V1, desktopBrowserSite, desktopBrowserDisplayUrl, isDesktopBrowserViewportV1 } from "./desktop-browser.js";

describe("desktop browser fixed entries and geometry", () => {
  it("keeps the Wiki in host knowledge and all nine material entries in AMF", () => {
    expect(desktopBrowserSite("vrchat-wiki")).toMatchObject({ purpose: "knowledge", url: "https://wiki.vrchat.com/" });
    expect(DESKTOP_BROWSER_SITES_V1.filter(site => site.purpose === "assets").map(site => new URL(site.url).hostname)).toEqual([
      "booth.pm", "vrcfinder.net", "boothplorer.com", "yorimichi.cc", "polyseek.jp", "vrc-style.com", "avatar-network.herokuapp.com", "avatar-catalog.com", "vrc-db.com",
    ]);
    for (const input of ["https://booth.pm/", "booth.pm", "file:///C:/", null, {}, "constructor"]) expect(desktopBrowserSite(input)).toBeNull();
  });
  it("accepts bounded CSS geometry including hidden zero area, rejects malformed input", () => {
    expect(isDesktopBrowserViewportV1({ x: 176, y: 124, width: 824, height: 676 })).toBe(true);
    expect(isDesktopBrowserViewportV1({ x: 176, y: 124, width: 0, height: 0 })).toBe(true);
    for (const input of [null, [], {}, { x: 0, y: 0, width: Infinity, height: 1 }, { x: -1, y: 0, width: 1, height: 1 },
      { x: 0, y: 0, width: "1", height: 1 }, { x: 0, y: 0, width: 32769, height: 1 }, { x: 0, y: 0, width: 1, height: 1, url: "file:///C:/" }]) expect(isDesktopBrowserViewportV1(input)).toBe(false);
  });
  it("returns origin/path display metadata without query, fragment or authority credentials", () => {
    expect(desktopBrowserDisplayUrl("https://person:secret@accounts.pixiv.net/login?code=private#token=private")).toBe("https://accounts.pixiv.net/login");
    expect(desktopBrowserDisplayUrl("https://wiki.vrchat.com/wiki/Main_Page")).toBe("https://wiki.vrchat.com/wiki/Main_Page");
    for (const input of ["file:///C:/private", "data:text/html,private", "not a URL"]) expect(desktopBrowserDisplayUrl(input)).toBe("");
  });
});
