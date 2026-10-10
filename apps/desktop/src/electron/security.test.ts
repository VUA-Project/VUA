import { describe, expect, it, vi } from "vitest";
import {
  classifyNavigationTarget,
  installCookiePersistencePolicy,
  installLocalContentNavigationPolicy,
  installRemoteContentNavigationPolicy,
  installRemoteContentSessionPolicy,
  isAllowedLocalSender,
  isAllowedRemoteOrigin,
  isCookieDomainAllowed,
  localWindowWebPreferences,
  sessionCookiePersistence,
} from "./security.js";

describe("Electron local window security", () => {
  it("keeps Node and Electron out of the renderer", () => {
    expect(localWindowWebPreferences("C:/vua/preload.js")).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    });
  });

  it("rejects remote callers", () => {
    expect(isAllowedLocalSender("https://booth.pm/", "http://127.0.0.1:5173")).toBe(false);
    expect(isAllowedLocalSender("http://127.0.0.1:5173/", "http://127.0.0.1:5173")).toBe(true);
  });
});

describe("remote content origin allowlist (F4-2)", () => {
  const allowed = ["https://booth.pm"];

  it("admits the allowlisted host and its subdomains over https", () => {
    expect(isAllowedRemoteOrigin("https://booth.pm/items/1", allowed)).toBe(true);
    expect(isAllowedRemoteOrigin("https://shop.booth.pm/", allowed)).toBe(true);
  });

  it("rejects unrelated hosts, plain-http impersonation, and non-web schemes", () => {
    expect(isAllowedRemoteOrigin("https://booth.pm.evil.test/", allowed)).toBe(false);
    expect(isAllowedRemoteOrigin("https://notbooth.pm/", allowed)).toBe(false);
    expect(isAllowedRemoteOrigin("http://booth.pm/", allowed)).toBe(false);
    expect(isAllowedRemoteOrigin("file:///C:/Windows/system32/config.SAM", allowed)).toBe(false);
    expect(isAllowedRemoteOrigin("javascript:alert(1)", allowed)).toBe(false);
    expect(isAllowedRemoteOrigin("not a url", allowed)).toBe(false);
  });

  it("rejects an empty allowlist", () => {
    expect(isAllowedRemoteOrigin("https://booth.pm/", [])).toBe(false);
  });
});

describe("U9 navigation target classification", () => {
  const allowed = ["https://booth.pm"];

  it("classifies web targets with allowlist verdict", () => {
    expect(classifyNavigationTarget("https://booth.pm/items/1", allowed)).toEqual({
      kind: "web",
      allowed: true,
    });
    expect(classifyNavigationTarget("https://shop.booth.pm/", allowed)).toEqual({
      kind: "web",
      allowed: true,
    });
    expect(classifyNavigationTarget("https://example.test/checkout", allowed)).toEqual({
      kind: "web",
      allowed: false,
    });
    expect(classifyNavigationTarget("http://booth.pm/", allowed)).toEqual({
      kind: "web",
      allowed: false,
    });
  });

  it("classifies the allowlisted external protocols including the Unity Hub handoff", () => {
    for (const url of ["mailto:a@b.test", "steam://open/friends", "vrchat://launch", "discord://rpc", "unityhub://2022.3.22f1/887be4894c44"]) {
      expect(classifyNavigationTarget(url, allowed).kind).toBe("external-protocol");
    }
  });

  it("rejects pseudo protocols and unknown schemes unconditionally", () => {
    expect(classifyNavigationTarget("javascript:alert(1)", allowed).kind).toBe("pseudo-protocol");
    expect(classifyNavigationTarget("data:text/html,x", allowed).kind).toBe("pseudo-protocol");
    expect(classifyNavigationTarget("blob:https://booth.pm/x", allowed).kind).toBe("pseudo-protocol");
    expect(classifyNavigationTarget("file:///C:/Windows/system32/config.SAM", allowed).kind).toBe(
      "pseudo-protocol",
    );
    expect(classifyNavigationTarget("not a url", allowed).kind).toBe("pseudo-protocol");
    expect(classifyNavigationTarget("vscode://open/file", allowed).kind).toBe("unknown-scheme");
  });
});

describe("remote content navigation policy (F4-2 + U9 four-way)", () => {
  function fakeWebContents() {
    let openHandler:
      | ((details: { url: string; userGesture: boolean }) => { action: "deny" | "allow" })
      | null = null;
    let navigateHandler: ((event: { preventDefault: () => void }, url: string) => void) | null = null;
    let redirectHandler: ((event: { preventDefault: () => void; isMainFrame: boolean }, url: string) => void) | null = null;
    const loadURL = vi.fn();
    return {
      webContents: {
        setWindowOpenHandler: vi.fn((handler) => {
          openHandler = handler;
        }),
        on: vi.fn((eventName: string, handler: never) => {
          if (eventName === "will-navigate") navigateHandler = handler;
          if (eventName === "will-redirect") redirectHandler = handler;
        }),
        loadURL,
      },
      loadURL,
      open: (url: string, userGesture = true) => openHandler!({ url, userGesture }),
      navigate: (url: string) => {
        const preventDefault = vi.fn();
        navigateHandler!({ preventDefault }, url);
        return preventDefault.mock.calls.length > 0;
      },
      redirect: (url: string, isMainFrame = true) => {
        const preventDefault = vi.fn();
        redirectHandler!({ preventDefault, isMainFrame }, url);
        return preventDefault.mock.calls.length > 0;
      },
    };
  }

  it("hands in-allowlist popup targets to the current embedded view and denies the native window", () => {
    const harness = fakeWebContents();
    const openExternal = vi.fn();
    installRemoteContentNavigationPolicy(harness.webContents as never, {
      allowedOrigins: ["https://booth.pm"],
      openExternal,
    });

    const result = harness.open("https://shop.booth.pm/items/9");
    expect(result).toEqual({ action: "deny" });
    // U9(1) 清单内直行:目标转当前内嵌视图,不再交系统浏览器
    expect(harness.loadURL).toHaveBeenCalledWith("https://shop.booth.pm/items/9");
    expect(openExternal).not.toHaveBeenCalled();
  });
  it("requires confirmation for off-list main-frame redirects, without intercepting subframe resources", async () => {
    const harness = fakeWebContents();
    const confirm = vi.fn().mockResolvedValue(true);
    installRemoteContentNavigationPolicy(harness.webContents as never, { allowedOrigins: ["https://booth.pm"], openExternal: vi.fn(), confirmNavigation: confirm });
    expect(harness.redirect("https://shop.booth.pm/")).toBe(false);
    expect(harness.redirect("https://cdn.example.test/frame", false)).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(harness.redirect("https://example.test/search")).toBe(true);
    await vi.waitFor(() => expect(harness.loadURL).toHaveBeenCalledWith("https://example.test/search"));
    expect(confirm).toHaveBeenCalledWith("https://example.test/search", "origin_not_allowed");
  });

  it("keeps pseudo-protocol and unknown-scheme popup targets unconditionally denied", () => {
    const harness = fakeWebContents();
    const openExternal = vi.fn();
    const onViolation = vi.fn();
    installRemoteContentNavigationPolicy(harness.webContents as never, {
      allowedOrigins: ["https://booth.pm"],
      openExternal,
      onViolation,
    });

    // U9(2) 伪协议窗口无条件拒;U9(3) 未知协议默认拒绝;均无确认层介入
    for (const url of ["javascript:alert(1)", "data:text/html,x", "vscode://open/file"]) {
      expect(harness.open(url)).toEqual({ action: "deny" });
      expect(onViolation).toHaveBeenCalledWith(url, "popup_denied");
    }
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("routes off-allowlist popup targets through the confirm layer into the current view", () => {
    const harness = fakeWebContents();
    const openExternal = vi.fn();
    const onViolation = vi.fn();
    let resolveConfirm: ((ok: boolean) => void) | null = null;
    installRemoteContentNavigationPolicy(harness.webContents as never, {
      allowedOrigins: ["https://booth.pm"],
      openExternal,
      onViolation,
      confirmNavigation: (url, reason) => {
        expect(url).toBe("https://example.test/checkout");
        expect(reason).toBe("origin_not_allowed");
        return new Promise<boolean>((resolve) => {
          resolveConfirm = resolve;
        });
      },
    });

    // 弹窗面:目标 deny+上报,确认前不导航(A-1 确认在前)
    expect(harness.open("https://example.test/checkout")).toEqual({ action: "deny" });
    expect(onViolation).toHaveBeenCalledWith("https://example.test/checkout", "origin_not_allowed");
    expect(harness.loadURL).not.toHaveBeenCalled();
    resolveConfirm!(true);
    return vi.waitFor(() => expect(harness.loadURL).toHaveBeenCalledWith("https://example.test/checkout"));
  });

  it("keeps off-allowlist navigation blocked until the confirm layer approves it", async () => {
    const harness = fakeWebContents();
    let resolveConfirm: ((ok: boolean) => void) | null = null;
    installRemoteContentNavigationPolicy(harness.webContents as never, {
      allowedOrigins: ["https://booth.pm"],
      openExternal: vi.fn(),
      confirmNavigation: () =>
        new Promise<boolean>((resolve) => {
          resolveConfirm = resolve;
        }),
    });

    // 清单外 will-navigate:先 preventDefault;确认后才在本视图导航
    expect(harness.navigate("https://example.test/items/2")).toBe(true);
    expect(harness.loadURL).not.toHaveBeenCalled();
    resolveConfirm!(true);
    await vi.waitFor(() => expect(harness.loadURL).toHaveBeenCalledWith("https://example.test/items/2"));

    // 确认被拒:目标不放行
    expect(harness.navigate("https://other.test/items/3")).toBe(true);
    resolveConfirm!(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.loadURL).toHaveBeenCalledTimes(1);
  });

  it("opens external protocols only through the confirm layer (gesture gate equivalent)", async () => {
    const harness = fakeWebContents();
    const openExternal = vi.fn();
    const confirmNavigation = vi.fn(() => Promise.resolve(true));
    installRemoteContentNavigationPolicy(harness.webContents as never, {
      allowedOrigins: ["https://booth.pm"],
      openExternal,
      confirmNavigation,
    });

    // U9(3)/U9(4):协议启动经确认层;确认点击即用户显式手势
    harness.open("steam://open/friends", true);
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledWith("steam://open/friends"));
    expect(confirmNavigation).toHaveBeenCalledWith("steam://open/friends", "external_protocol");

    // 自动触发形态同样只能经确认层执行(Electron 无手势字段,等效更严):
    // 确认被拒则不执行
    const openExternalRefused = vi.fn();
    installRemoteContentNavigationPolicy(harness.webContents as never, {
      allowedOrigins: ["https://booth.pm"],
      openExternal: openExternalRefused,
      confirmNavigation: () => Promise.resolve(false),
    });
    harness.open("vrchat://launch", false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(openExternalRefused).not.toHaveBeenCalled();
  });

  it("falls back to refusal for external protocols when no confirm layer is injected", () => {
    const harness = fakeWebContents();
    const openExternal = vi.fn();
    const onViolation = vi.fn();
    installRemoteContentNavigationPolicy(harness.webContents as never, {
      allowedOrigins: ["https://booth.pm"],
      openExternal,
      onViolation,
    });

    // 无确认层注入:外部协议不执行(保守降级)
    harness.open("steam://open/friends", true);
    expect(openExternal).not.toHaveBeenCalled();
    expect(onViolation).toHaveBeenCalledWith("steam://open/friends", "popup_denied");
  });

  it("falls back to refusal when no confirm layer is injected", () => {
    const harness = fakeWebContents();
    const onViolation = vi.fn();
    installRemoteContentNavigationPolicy(harness.webContents as never, {
      allowedOrigins: ["https://booth.pm"],
      openExternal: vi.fn(),
      onViolation,
    });

    // 无确认层注入:清单外目标不放行也不导航(保守降级,violation 照常)
    expect(harness.open("https://example.test/checkout")).toEqual({ action: "deny" });
    expect(harness.navigate("https://example.test/items/2")).toBe(true);
    expect(harness.loadURL).not.toHaveBeenCalled();
  });
});

describe("local shell navigation policy (U9 four-way)", () => {
  function fakeLocalWebContents() {
    let openHandler:
      | ((details: { url: string; userGesture: boolean }) => { action: "deny" | "allow" })
      | null = null;
    let navigateHandler: ((event: { preventDefault: () => void }, url: string) => void) | null = null;
    return {
      webContents: {
        setWindowOpenHandler: vi.fn((handler) => {
          openHandler = handler;
        }),
        on: vi.fn((eventName: string, handler: never) => {
          if (eventName === "will-navigate") navigateHandler = handler;
        }),
      },
      open: (url: string, userGesture = true) => openHandler!({ url, userGesture }),
      navigate: (url: string) => {
        const preventDefault = vi.fn();
        navigateHandler!({ preventDefault }, url);
        return preventDefault.mock.calls.length > 0;
      },
    };
  }

  function baseOptions() {
    return {
      rendererUrl: "http://127.0.0.1:5173" as string | undefined,
      allowedOrigins: ["https://booth.pm"] as readonly string[],
      navigateCurrentView: vi.fn(),
      openExternal: vi.fn(),
      confirmNavigation: vi.fn(() => Promise.resolve(true)),
    };
  }

  it("hands http(s) popup targets to the embedded view instead of the system browser", () => {
    const harness = fakeLocalWebContents();
    const options = baseOptions();
    installLocalContentNavigationPolicy(harness.webContents as never, options);

    // 清单内直行转内嵌视图(U9(1),不再 shell.openExternal)
    harness.open("https://booth.pm/items/1");
    expect(options.navigateCurrentView).toHaveBeenCalledWith("https://booth.pm/items/1");
    expect(options.openExternal).not.toHaveBeenCalled();

    // 清单外:确认在前,确认后转内嵌视图
    harness.open("https://example.test/page");
    expect(options.confirmNavigation).toHaveBeenCalledWith(
      "https://example.test/page",
      "origin_not_allowed",
    );
  });

  it("requires confirmation before handing off to external applications", async () => {
    const harness = fakeLocalWebContents();
    const options = baseOptions();
    installLocalContentNavigationPolicy(harness.webContents as never, options);

    harness.open("mailto:someone@test.dev", true);
    await vi.waitFor(() =>
      expect(options.openExternal).toHaveBeenCalledWith("mailto:someone@test.dev"),
    );
    expect(options.confirmNavigation).toHaveBeenCalledWith("mailto:someone@test.dev", "external_protocol");

    // 确认被拒:不交系统打开(U9(4) 等效——确认点击即用户显式手势)
    const refusedOpenExternal = vi.fn();
    installLocalContentNavigationPolicy(harness.webContents as never, {
      ...options,
      openExternal: refusedOpenExternal,
      confirmNavigation: vi.fn(() => Promise.resolve(false)),
    });
    harness.open("steam://open/friends", true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refusedOpenExternal).not.toHaveBeenCalled();

    // 伪协议窗口无条件拒(U9(2))
    harness.open("file:///C:/Windows/system32/config.SAM");
    expect(options.navigateCurrentView).not.toHaveBeenCalledWith(
      "file:///C:/Windows/system32/config.SAM",
    );
    expect(options.openExternal).toHaveBeenCalledTimes(1);
  });

  it("keeps blocking local-shell navigation that leaves the local renderer origin", () => {
    const harness = fakeLocalWebContents();
    const options = baseOptions();
    installLocalContentNavigationPolicy(harness.webContents as never, options);

    expect(harness.navigate("https://booth.pm/items/1")).toBe(true);
    expect(harness.navigate("http://127.0.0.1:5173/page")).toBe(false);
  });
});

describe("remote content session policy (F4-2)", () => {
  it("denies every permission request and cancels downloads, reporting both", () => {
    let permissionHandler: ((webContents: unknown, permission: string, callback: (allow: boolean) => void, details: { requestingUrl: string }) => void) | null = null;
    let downloadHandler: ((event: { preventDefault: () => void }, item: { getURL: () => string }) => void) | null = null;
    const fakeSession = {
      setPermissionRequestHandler: vi.fn((handler) => {
        permissionHandler = handler;
      }),
      on: vi.fn((eventName: string, handler: never) => {
        if (eventName === "will-download") downloadHandler = handler;
      }),
    };

    const onViolation = vi.fn();
    installRemoteContentSessionPolicy(fakeSession as never, { onViolation });

    const allow = vi.fn();
    permissionHandler!({}, "media", allow, { requestingUrl: "https://booth.pm/items/1" });
    expect(allow).toHaveBeenCalledWith(false);
    expect(onViolation).toHaveBeenCalledWith("https://booth.pm/items/1", "permission_denied");

    const preventDefault = vi.fn();
    downloadHandler!({ preventDefault }, { getURL: () => "https://booth.pm/file.zip" });
    expect(preventDefault).toHaveBeenCalled();
    expect(onViolation).toHaveBeenCalledWith("https://booth.pm/file.zip", "download_denied");
  });
});

describe("cookie persistence policy (login session survival, isolated partition)", () => {
  const allowed = ["https://booth.pm"];
  const nowSeconds = 1_700_000_000;

  it("admits allowlisted hosts (dot-domain subdomain semantics) and rejects foreign hosts", () => {
    expect(isCookieDomainAllowed("booth.pm", allowed)).toBe(true);
    expect(isCookieDomainAllowed(".accounts.booth.pm", allowed)).toBe(true);
    expect(isCookieDomainAllowed("booth.pm.evil.test", allowed)).toBe(false);
    expect(isCookieDomainAllowed("", allowed)).toBe(false);
  });

  it("builds bounded persistence only for allowlisted session cookies", () => {
    // 会话 Cookie:补 180 天到期,url 按安全旗标选择协议
    expect(
      sessionCookiePersistence(
        { domain: ".booth.pm", path: "/", name: "session", session: true, secure: true },
        allowed,
        nowSeconds,
      ),
    ).toEqual({ url: "https://booth.pm/", expirationDate: nowSeconds + 180 * 24 * 60 * 60 });
    // 已持久 Cookie:不动
    expect(
      sessionCookiePersistence(
        { domain: "booth.pm", path: "/", name: "kept", session: false, secure: true },
        allowed,
        nowSeconds,
      ),
    ).toBeNull();
    // 清单外来源:不动
    expect(
      sessionCookiePersistence(
        { domain: "tracker.example", path: "/", name: "t", session: true, secure: true },
        allowed,
        nowSeconds,
      ),
    ).toBeNull();
  });

  it("rewrites allowlisted session cookies through the session API and ignores the rest", () => {
    let changedHandler: ((event: unknown, cookie: Record<string, unknown>, cause: string, removed: boolean) => void) | null = null;
    const set = vi.fn(() => Promise.resolve());
    const fakeSession = {
      cookies: {
        on: vi.fn((_eventName: string, handler: never) => {
          changedHandler = handler;
        }),
        set,
      },
    };
    installCookiePersistencePolicy(fakeSession as never, allowed, () => nowSeconds);

    // 清单内会话 Cookie:按原旗标重写 + 有界到期
    changedHandler!(
      {},
      {
        name: "session", value: "token", domain: ".booth.pm", path: "/",
        session: true, secure: true, httpOnly: true, sameSite: "lax",
      },
      "explicit",
      false,
    );
    expect(set).toHaveBeenCalledWith({
      url: "https://booth.pm/",
      name: "session",
      value: "token",
      domain: ".booth.pm",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      expirationDate: nowSeconds + 180 * 24 * 60 * 60,
    });

    // 移除事件/已持久 Cookie/清单外来源:不重写
    set.mockClear();
    changedHandler!({}, { name: "x", domain: "booth.pm", path: "/", session: true }, "expired", true);
    changedHandler!({}, { name: "x", domain: "booth.pm", path: "/", session: false }, "overwrite", false);
    changedHandler!({}, { name: "x", domain: "evil.test", path: "/", session: true }, "explicit", false);
    expect(set).not.toHaveBeenCalled();
  });
});
