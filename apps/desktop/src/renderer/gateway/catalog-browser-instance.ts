import { createGatewayClient } from "./gateway-client.ts";
import { createEmptyCatalogBrowser } from "./empty-gateway.ts";
import { createLiveCatalogBrowser } from "./catalog-browser-live.ts";
import type { CatalogBrowserPort } from "./catalog-browser-port.ts";

/**
 * 目录浏览端口装配(与 electron-gateway 的 live 装配同一模式):
 * - 桌面壳内(window.vua 在场):catalog.list / catalog.detail / catalog.status
 *   经 typed client 走 Kernel → AMF/BDL 真实链路(bdl-queries v0.3 冻结面);
 *   BDL 未落观测数据时用户看到"空目录 + health unknown"——空态即终态,
 *   不谎报 not-connected;
 * - 纯浏览器打开(无 preload 宿主):not-connected 诚实空态,live 模块
 *   不发起任何请求。本函数是唯一替换点,页面零重写。
 */
export function createCatalogBrowser(): CatalogBrowserPort {
  return typeof window !== "undefined" && window.vua !== undefined
    ? createLiveCatalogBrowser(createGatewayClient(window.vua))
    : createEmptyCatalogBrowser();
}
