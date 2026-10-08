/**
 * 目录缩略图 URL 适配。
 *
 * Electron 迁移:旧 Tauri vuaimg 自定义协议(Rust 侧白名单校验 + 落盘缓存)
 * 按裁决不继承;远程图片直连原 URL,浏览器/Electron 网络栈自身 HTTP 缓存
 * 兜底,语义等价。域名白名单与磁盘缓存随 F4(Warehouse 远程素材)切片
 * 以 Electron 机制重建。
 */
export function catalogImageUrl(url: string): string {
  // N5(2026-10-03):vua-img 协议本地缓存(Electron 侧 image-cache.ts;
  // 只代理 booth.pximg.net,命中磁盘直回)。非该域 URL 原样返回
  if (url.startsWith('https://booth.pximg.net/')) {
    return `vua-img://${encodeURIComponent(url)}`;
  }
  return url;
}
