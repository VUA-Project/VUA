import type {
  AppErrorV01,
  ApplicationEventV01,
  DesktopGatewayRequestV1,
  DesktopGatewaySuccessValueV1,
} from "@vua/contracts";
import type { Unsubscribe } from "./types.ts";

/**
 * 类型化 Gateway client(F2):Renderer 侧唯一的 IPC 取数与事件入口。
 * - 三类失败被显式区分:unavailable(无宿主/Provider 不可达)、
 *   request_rejected(信封或方法被 Kernel 拒绝)、application(应用错误,
 *   携带契约 AppErrorV01 原值);页面据此呈现诚实断连/失败态;
 * - 值形状由 Kernel 路由保证;端口侧用字段存在性收窄,不匹配按不可用处理。
 */
export type GatewayClientError =
  | { readonly kind: "unavailable" }
  | { readonly kind: "request_rejected" }
  | { readonly kind: "application"; readonly error: AppErrorV01 };

export type GatewayResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: GatewayClientError };

export interface GatewayClient {
  invoke(request: DesktopGatewayRequestV1): Promise<GatewayResult<DesktopGatewaySuccessValueV1>>;
  subscribe(listener: (event: ApplicationEventV01) => void): Unsubscribe;
}

export interface DesktopGatewayHost {
  readonly aiTools?: import("@vua/contracts").DesktopAiToolsApiV01;
  readonly distribution?: import("@vua/contracts").DesktopDistributionApiV01;
  gateway: { invoke(request: DesktopGatewayRequestV1): Promise<unknown> };
  events: { subscribe(listener: (event: ApplicationEventV01) => void): Unsubscribe };
}

export function createGatewayClient(host: DesktopGatewayHost | undefined): GatewayClient {
  return {
    async invoke(request) {
      if (host === undefined) return { ok: false, error: { kind: "unavailable" } };
      try {
        const response = (await host.gateway.invoke(request)) as
          | { ok: true; value: DesktopGatewaySuccessValueV1 }
          | {
              ok: false;
              error:
                | { code: "invalid_request" | "unsupported_method" | "internal"; messageKey: string }
                | { code: "application"; application: AppErrorV01 };
            };
        if (response.ok) return { ok: true, value: response.value };
        if (response.error.code === "application") {
          return { ok: false, error: { kind: "application", error: response.error.application } };
        }
        return { ok: false, error: { kind: "request_rejected" } };
      } catch {
        return { ok: false, error: { kind: "unavailable" } };
      }
    },
    subscribe(listener) {
      return host?.events.subscribe(listener) ?? (() => {});
    },
  };
}
