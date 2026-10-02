import type {
  CatalogSyncPageRequestV01,
  CatalogSyncPageResultV01,
} from "@vua/contracts";

/**
 * 账号库同步运行器（N5 S1，计划 D4）：用分区会话逐页抓取 BOOTH 账号库，
 * 把每页归档 HTML 原样投递给 provider `catalog.ingestLibraryPage`，按回执
 * 的 `nextPageUrl` 续页，直到末页/上限/中止。
 *
 * 边界（与 download-ingest 同风格，全部依赖注入，模块不 import Electron）：
 * - 会话与凭据留在注入的 fetch 闭包内（Main 侧用 RemoteContentManager 的
 *   分区会话构造）；本模块只见 URL/HTML 文本，Cookie 永不经过这里；
 * - 礼貌限速：页间默认 `pageDelayMs`（1500ms）等待，`maxPages`（默认 50）
 *   兜底——只翻账号自己的库分页，不做整站遍历；
 * - 诚实结果：HTTP 非 200 / 投递失败 / 契约错误立即停并如实报告错误码，
 *   不把部分完成伪装成成功；`aborted` 只由显式 stop() 产生；
 * - 每页的 `fetchedAt` 在抓取后立刻取自注入时钟，`runId` 贯穿全run（provider
 *   侧用它折叠九态任务）。
 */

export interface CatalogSyncFetchOutcome {
  readonly status: number;
  readonly body: string;
  readonly finalUrl: string;
}

export type CatalogSyncFetch = (url: string) => Promise<CatalogSyncFetchOutcome>;

export interface CatalogSyncInvokeError {
  readonly code?: string;
}

export interface CatalogSyncInvokeResult {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: CatalogSyncInvokeError;
}

export type CatalogSyncInvoke = (
  params: CatalogSyncPageRequestV01,
) => Promise<CatalogSyncInvokeResult>;

export interface CatalogSyncRunnerOptions {
  readonly fetch: CatalogSyncFetch;
  readonly invoke: CatalogSyncInvoke;
  /** 页间等待（默认 1500ms，礼貌限速） */
  readonly pageDelayMs?: number;
  /** 单次运行页数上限（默认 50） */
  readonly maxPages?: number;
  /** 诊断通道（默认 stderr 单行 JSON；测试注入捕获） */
  readonly log?: (line: string) => void;
  /** 可注入时钟与睡眠（测试用） */
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
}

export type CatalogSyncRunStatus =
  | "completed"
  | "failed"
  | "aborted"
  | "page_limit_reached";

export interface CatalogSyncRunResult {
  readonly status: CatalogSyncRunStatus;
  readonly runId: string;
  readonly pages: number;
  readonly parsedCount: number;
  readonly upsertedCount: number;
  readonly rejectedCount: number;
  /** 停止时观察到的下一页（completed 时恒为 null） */
  readonly nextPageUrl: string | null;
  readonly error?: { readonly code: string };
}

export interface CatalogSyncRun {
  readonly runId: string;
  readonly result: Promise<CatalogSyncRunResult>;
  stop(): void;
}

/**
 * 默认起始页 = 已购素材库(账号库三类型之一,真机验证 2026-10-02:库页位于
 * accounts.booth.pm,而非早先假设的 booth.pm/en/library——后者未登录 404
 * 掩盖了错误路径)。gifts 与 free_downloads 两库经 start.startUrl 指定。
 */
export const CATALOG_SYNC_DEFAULT_START_URL = "https://accounts.booth.pm/library?page=1";

export function startCatalogSync(
  options: CatalogSyncRunnerOptions,
  start?: {
    readonly runId?: string;
    readonly startUrl?: string;
    readonly libraryType?: "bought" | "gifts" | "free_downloads";
  },
): CatalogSyncRun {
  const pageDelayMs = options.pageDelayMs ?? 1_500;
  const maxPages = options.maxPages ?? 50;
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const now = options.now ?? (() => new Date());
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const runId = start?.runId ?? `catalog-sync-${now().toISOString()}`;
  let stopped = false;

  const result = (async (): Promise<CatalogSyncRunResult> => {
    let url: string | null = start?.startUrl ?? CATALOG_SYNC_DEFAULT_START_URL;
    let pageNumber = 0;
    // 完成页计数：只有抓取+投递都成功的页才计入（中止/失败时报的是
    // 已完成的部分，不是尝试到的序号）。
    let pages = 0;
    let parsedCount = 0;
    let upsertedCount = 0;
    let rejectedCount = 0;

    while (url !== null && !stopped) {
      pageNumber += 1;
      if (pageNumber > maxPages) {
        return {
          status: "page_limit_reached",
          runId,
          pages,
          parsedCount,
          upsertedCount,
          rejectedCount,
          nextPageUrl: url,
        };
      }
      if (pageNumber > 1) {
        await sleep(pageDelayMs);
        if (stopped) break;
      }

      const fetchedAt = now().toISOString();
      let outcome: CatalogSyncFetchOutcome;
      try {
        outcome = await options.fetch(url);
      } catch (error) {
        log(JSON.stringify({ channel: "catalog-sync", runId, fetchError: String(error), url }));
        return failure("fetch_error", url);
      }
      if (outcome.status !== 200) {
        log(
          JSON.stringify({
            channel: "catalog-sync",
            runId,
            httpStatus: outcome.status,
            url,
          }),
        );
        return failure("http_status", url);
      }

      let invokeResult: CatalogSyncInvokeResult;
      try {
        invokeResult = await options.invoke({
          schemaVersion: "0.2",
          sourceUrl: url,
          html: outcome.body,
          fetchedAt,
          pageNumber,
          runId,
          ...(start?.libraryType === undefined
            ? {}
            : { libraryType: start.libraryType }),
        });
      } catch (error) {
        log(JSON.stringify({ channel: "catalog-sync", runId, invokeError: String(error), url }));
        return failure("invoke_error", url);
      }
      if (!invokeResult.ok) {
        const code = invokeResult.error?.code ?? "ingest_error";
        log(JSON.stringify({ channel: "catalog-sync", runId, ingestError: code, url }));
        return failure(code, url);
      }

      const value = invokeResult.value as Partial<CatalogSyncPageResultV01> | undefined;
      pages += 1;
      parsedCount += value?.parsedCount ?? 0;
      upsertedCount += value?.upsertedCount ?? 0;
      rejectedCount += value?.rejectedItems?.length ?? 0;
      // 回执缺 nextPageUrl 字段视同末页（保守停止，不猜测续页）。
      // 真实库页的 rel="next" 是相对地址(/library?page=2)——按当前页解析为
      // 绝对地址再抓取;解析不了就诚实失败,不猜协议与主机。
      const rawNext = value?.nextPageUrl ?? null;
      if (rawNext === null) {
        url = null;
      } else {
        try {
          url = new URL(rawNext, url).href;
        } catch {
          log(JSON.stringify({ channel: "catalog-sync", runId, badNextPageUrl: rawNext }));
          return failure("next_page_url_unresolvable", url);
        }
      }
    }

    return {
      status: stopped ? "aborted" : "completed",
      runId,
      pages,
      parsedCount,
      upsertedCount,
      rejectedCount,
      nextPageUrl: null,
    };

    function failure(code: string, atUrl: string): CatalogSyncRunResult {
      return {
        status: "failed",
        runId,
        pages,
        parsedCount,
        upsertedCount,
        rejectedCount,
        nextPageUrl: atUrl,
        error: { code },
      };
    }
  })();

  return {
    runId,
    result,
    stop(): void {
      stopped = true;
    },
  };
}
