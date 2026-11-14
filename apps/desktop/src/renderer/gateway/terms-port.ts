import {
  isProductTermsV01, isTermsAcceptedV01, isTermsUseCheckV01, isTermsProductId,
  type ProductTermsV01, type TermsPresetId, type TermsUseCheckV01,
} from "@vua/contracts";
import type { GatewayClient, GatewayClientError } from "./gateway-client.ts";
import { registerTaskIdentity } from "./task-identity.ts";

/** VN3 terms read from products' public license links ([terms v0.1](../../../../../docs/protocols/terms-v0.1.md)). */
export interface TermsPort {
  /** The product's captured links, documents and A–X items, from local evidence. */
  product(productId: string): Promise<ProductTermsV01>;
  /** Decides one use preset for products together; the strictest item decides and unknown never passes. */
  checkUse(presetId: TermsPresetId, productIds: readonly string[]): Promise<TermsUseCheckV01>;
  /** Reads the product's description again and fetches its public VN3 documents. */
  refreshProduct(productId: string, title: string): Promise<{ readonly taskId: string }>;
  /** Read the public documents linked from product descriptions already recorded in this library. */
  refreshLibrary?(title: string): Promise<{ readonly taskId: string }>;
}

export function createTermsPort(client: GatewayClient, capture?: (id: string) => Promise<{ readonly ok: boolean }>): TermsPort {
  const fail = (response: { readonly error: GatewayClientError }) =>
    new Error(response.error.kind === "application" ? response.error.error.code : response.error.kind);
  return {
    async product(productId) {
      const response = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "terms.getProduct", params: { schemaVersion: "0.1", productId } });
      if (!response.ok) throw fail(response);
      if (!isProductTermsV01(response.value)) throw new Error("terms_invalid");
      return response.value;
    },
    async checkUse(presetId, productIds) {
      const response = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "terms.checkUse", params: { schemaVersion: "0.1", presetId, productIds: [...productIds] } });
      if (!response.ok) throw fail(response);
      if (!isTermsUseCheckV01(response.value)) throw new Error("terms_invalid");
      return response.value;
    },
    async refreshProduct(productId, title) {
      if (!isTermsProductId(productId)) throw new Error("terms_invalid");
      if (capture && !(await capture(productId)).ok) throw new Error("terms_capture_failed");
      const response = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "terms.refreshProduct", params: { schemaVersion: "0.1", productId } });
      if (!response.ok) throw fail(response);
      if (!isTermsAcceptedV01(response.value)) throw new Error("terms_invalid");
      registerTaskIdentity(response.value.taskId, { title, originPage: "warehouse", notifyOnComplete: false });
      return { taskId: response.value.taskId };
    },
    async refreshLibrary(title) {
      const response = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "terms.refreshLibrary", params: { schemaVersion: "0.1" } });
      if (!response.ok) throw fail(response);
      if (!isTermsAcceptedV01(response.value)) throw new Error("terms_invalid");
      registerTaskIdentity(response.value.taskId, { title, originPage: "warehouse", notifyOnComplete: false });
      return { taskId: response.value.taskId };
    },
  };
}
