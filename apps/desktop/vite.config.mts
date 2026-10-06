import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { buildInfo } from "./scripts/build-info.mjs";

export default defineConfig({
  plugins: [react()],
  base: "./",
  // 构建期事实注入(Phase A):开屏/设置页显示真实版本与提交号,
  // 生产构建同路径(check:leak 的临时生产构建也走这里)
  define: { __VUA_BUILD_INFO__: JSON.stringify(buildInfo) },
  // @vua/contracts 以 CJS dist 经 pnpm link 进入 workspace:vite 默认不预构建链接包,
  // 浏览器按 ESM 解析 CJS 时命名导出全部丢失(renderer 首帧崩溃、黑屏)。
  // 强制预构建做一次 CJS→ESM 互操作。production build 由 rolldown 处理,不受影响。
  // Workspace dist changes do not update the lockfile hash. Rebuild the dev cache
  // on startup so newly added contract exports cannot resolve to stale code.
  optimizeDeps: { include: ["@vua/contracts"], force: true },
  build: { outDir: "dist/renderer", emptyOutDir: true },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
