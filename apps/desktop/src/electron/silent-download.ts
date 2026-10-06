import type { Session } from "electron";

/**
 * 静默下载编排器(N5,用户裁决 2026-10-05:Steam 式——不打开页面,右键即下)。
 *
 * 数据面:BDL v0.4 捕获的稳定直链 `https://booth.pm/downloadables/{id}`;
 * 传输面:分区会话 `session.downloadURL` 经 will-download 管道接管——
 * 暂存、download-events、逐 attempt 九态任务(fold_download_task)、完成
 * 后的采纳列表全部复用既有机器,本模块只做发起与限速。
 *
 * 限速(用户裁决 2026-10-05):BOOTH 对爬虫的公开守则是 6s/页,文件下载的
 * 速率限制未知——按最保守形态:全局串行,相邻发起间隔 ≥ minIntervalMs
 * (默认 6000ms)。每个文件的发起 = 一次 booth.pm 源站请求(302 到签名
 * CDN 由 Chromium 跟随),间隔即源站礼貌。传输失败经下载任务面如实呈现,
 * 本模块不重试不吞错。
 */
export interface SilentDownloadQueueOptions {
  readonly partitionSession: Session;
  /** 相邻发起的最小间隔(默认 6000ms;BOOTH 爬虫守则) */
  readonly minIntervalMs?: number;
  readonly log?: (line: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  /** 商品自动采纳钩子(人审 E18 修复 2026-10-06,Steam 式"下载即入库"):
   *  该商品入队的全部文件落定后回调,携带**成功**文件的 downloadId 批,
   *  调用方据此发 warehouse.importDownloads;有失败文件时同样回调成功批,
   *  失败事实由下载任务面如实呈现 */
  readonly onProductSettled?: (
    productId: string,
    completedDownloadIds: readonly string[],
  ) => void;
}

export interface SilentDownloadQueue {
  /** 入队一批文件(同一商品);返回受理工 */
  enqueue(productId: string, downloadableIds: readonly number[]): number;
  /** 队列中未发起的数量(诊断面) */
  pending(): number;
  /** 下载事件汇回执:main 的 downloadSink 收到终态事件时按 sourceUrl 回喂,
   *  借此把 downloadId 与 downloadableId 关联并推进商品落定 */
  notifySettled(sourceUrl: string, downloadId: string, kind: "completed" | "failed" | "cancelled"): void;
}

export function createSilentDownloadQueue(options: SilentDownloadQueueOptions): SilentDownloadQueue {
  const minIntervalMs = options.minIntervalMs ?? 6_000;
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());

  interface Entry {
    readonly productId: string;
    readonly downloadableId: number;
  }
  const queue: Entry[] = [];
  let running = false;
  let lastInitiatedAt = 0;

  /** 发起后的在途跟踪:url → 条目;商品聚合:remaining / 成功 downloadId 批 */
  const inFlight = new Map<string, { productId: string; downloadableId: number }>();
  const products = new Map<
    string,
    { remaining: Set<number>; completed: string[] }
  >();

  function settle(url: string, downloadId: string, ok: boolean): void {
    const tracked = inFlight.get(url);
    if (tracked === undefined) return;
    inFlight.delete(url);
    const group = products.get(tracked.productId);
    if (group === undefined) return;
    group.remaining.delete(tracked.downloadableId);
    if (ok) group.completed.push(downloadId);
    if (group.remaining.size > 0) return;
    products.delete(tracked.productId);
    options.onProductSettled?.(tracked.productId, group.completed);
  }

  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const entry = queue.shift();
        if (entry === undefined) return;
        // 全局串行 + 源站礼貌间隔:首个发起前不等待
        const sinceLast = now() - lastInitiatedAt;
        if (lastInitiatedAt > 0 && sinceLast < minIntervalMs) {
          await sleep(minIntervalMs - sinceLast);
        }
        lastInitiatedAt = now();
        const url = `https://booth.pm/downloadables/${entry.downloadableId}`;
        inFlight.set(url, entry);
        const group = products.get(entry.productId);
        if (group !== undefined) group.remaining.add(entry.downloadableId);
        else products.set(entry.productId, { remaining: new Set([entry.downloadableId]), completed: [] });
        try {
          // 经 will-download 管道:暂存/事件/任务/采纳全在既有面
          options.partitionSession.downloadURL(url);
          log(
            JSON.stringify({
              channel: "silent-download",
              productId: entry.productId,
              downloadableId: entry.downloadableId,
              initiated: true,
            }),
          );
        } catch (error) {
          // downloadURL 触发失败(会话已销毁等):如实记录,不重试
          log(
            JSON.stringify({
              channel: "silent-download",
              productId: entry.productId,
              downloadableId: entry.downloadableId,
              error: String(error),
            }),
          );
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    enqueue(productId, downloadableIds) {
      const fresh = downloadableIds.filter((id) => Number.isInteger(id) && id > 0);
      for (const downloadableId of fresh) {
        queue.push({ productId, downloadableId });
      }
      if (fresh.length > 0) void drain();
      return fresh.length;
    },
    pending() {
      return queue.length;
    },
    notifySettled(sourceUrl, downloadId, kind) {
      settle(sourceUrl, downloadId, kind === "completed");
    },
  };
}
