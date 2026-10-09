import type { VuaDesktopApiV2 } from "@vua/contracts";

declare global {
  interface Window {
    readonly vua?: VuaDesktopApiV2;
  }
  /** 构建期注入(vite.config.mts define;scripts/build-info.mjs 为事实源) */
  const __VUA_BUILD_INFO__: {
    readonly version: string;
    readonly commit: string;
    readonly dirty: boolean;
    readonly builtAt: string;
  };
}

export {};
