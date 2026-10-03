import { app, net, protocol } from "electron";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * 目录图片本地缓存(N5,2026-10-03 用户反馈"图片经常重新加载"):
 * vua-img:// 协议服务 booth.pximg.net 的图片——命中本地磁盘直接回,
 * 未命中经 net.fetch 抓取后落盘再回。只代理 booth.pximg.net 前缀,
 * 不是通用代理。缓存无过期(v0.1):BOOTH 缩略图不可变(pximg URL 含
 * 内容 UUID),手动清目录即重置。
 */
const ALLOWED_PREFIX = "https://booth.pximg.net/";
const MAX_CACHE_BYTES = 20 * 1024 * 1024; // 单图上限 20MB(防御;缩略图 ~50KB)

function cacheDir(): string {
  return path.join(app.getPath("userData"), "img-cache");
}

function cachePathFor(url: string): string {
  const hash = createHash("sha256").update(url).digest("hex");
  return path.join(cacheDir(), hash);
}

export function toCachedImageUrl(original: string): string {
  if (!original.startsWith(ALLOWED_PREFIX)) return original;
  return `vua-img://${encodeURIComponent(original)}`;
}

/** 必须在 app ready 之前调用(Electron 时机要求):注册 scheme 特权 */
export function registerImageCacheScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: "vua-img", privileges: { stream: true, bypassCSP: false } },
  ]);
}

/** ready 之后调用:建缓存目录并挂协议 handler */
export async function registerImageCacheProtocol(): Promise<void> {
  await mkdir(cacheDir(), { recursive: true });
  protocol.handle("vua-img", async (request) => {
    const raw = decodeURIComponent(new URL(request.url).hostname + new URL(request.url).pathname.slice(1));
    if (!raw.startsWith(ALLOWED_PREFIX)) {
      return new Response("forbidden", { status: 403 });
    }
    const file = cachePathFor(raw);
    if (existsSync(file)) {
      const data = await readFile(file);
      return new Response(new Uint8Array(data), {
        headers: { "content-type": "image/jpeg", "cache-control": "immutable" },
      });
    }
    const upstream = await net.fetch(raw);
    if (!upstream.ok) {
      return new Response("upstream error", { status: upstream.status });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.byteLength <= MAX_CACHE_BYTES) {
      void writeFile(file, buffer).catch(() => {});
    }
    return new Response(new Uint8Array(buffer), {
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
        "cache-control": "immutable",
      },
    });
  });
}

/** 诊断:缓存目录大小(字节);测试与设置页展示用 */
export async function imageCacheSize(): Promise<number> {
  let total = 0;
  const dir = cacheDir();
  if (!existsSync(dir)) return 0;
  const { readdir } = await import("node:fs/promises");
  for (const entry of await readdir(dir)) {
    const s = await stat(path.join(dir, entry));
    total += s.size;
  }
  return total;
}
